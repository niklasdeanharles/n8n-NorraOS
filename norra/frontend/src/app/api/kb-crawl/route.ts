import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import { N8N_WEBHOOKS, callN8nWebhook } from '@/lib/n8n/client';

/**
 * Seiten einer Website in die Wissensbasis.
 *
 * Dünn wie alle Proxy-Routen: prüft wer fragt, reicht durch, gibt zurück was
 * n8n sagt. Das Holen, Entkernen und Einbetten passiert dort — hier steht
 * keine Zeile davon, und das ist Absicht.
 *
 * **Eine Liste von Seiten, keine Startseite mit Tiefensuche.** Ein Crawler,
 * der Links folgt, liest irgendwann das Impressum, den Blog von 2017 und die
 * Seite eines fremden Anbieters im iframe. Wer die Seiten benennt, bekommt die
 * Wissensbasis, die er meint.
 */
export const dynamic = 'force-dynamic';

const schema = z.object({
  urls: z
    .array(z.string().trim().url('Jede Zeile muss eine vollständige Adresse sein, mit https:// davor.'))
    .min(1, 'Mindestens eine Adresse angeben.')
    .max(50, 'Höchstens 50 Seiten auf einmal.'),
  agentId: z.string().uuid().nullish(),
});

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (actor.role !== 'admin') {
    return NextResponse.json({ error: 'Nur Admins können die Wissensbasis füllen.' }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' }, { status: 400 });
  }

  // Nur `http(s)`. Der Workflow filtert das ein zweites Mal — hier steht es,
  // damit der Nutzer einen Satz liest statt einer stillen Auslassung.
  const bad = parsed.data.urls.find((url) => !/^https?:\/\//.test(url));
  if (bad) return NextResponse.json({ error: `„${bad}” ist keine Web-Adresse.` }, { status: 400 });

  try {
    const upstream = await callN8nWebhook(N8N_WEBHOOKS.kbCrawl, {
      organization_id: actor.organizationId,
      agent_id: parsed.data.agentId ?? '',
      urls: parsed.data.urls,
    });
    if (!upstream.ok) throw new Error(`n8n antwortete ${upstream.status}`);
    const result = (await upstream.json().catch(() => ({}))) as { requested?: number; indexed?: number };
    return NextResponse.json({
      requested: result.requested ?? parsed.data.urls.length,
      indexed: result.indexed ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Der Crawl konnte nicht gestartet werden.' },
      { status: 502 },
    );
  }
}
