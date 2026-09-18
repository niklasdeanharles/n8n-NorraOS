'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import type { CampaignStatus } from '@/types/database';
import { DAY_LABELS, WEEK } from '@/lib/voice/hours';

export type CampaignFormState = { error: string | null; ok?: string };

const E164 = /^\+[1-9][0-9]{6,14}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Ziffern, Leerzeichen und Striche, wie Menschen sie schreiben, in das eine Format, das ein Netz akzeptiert. */
function normalizeE164(input: string): string {
  const trimmed = input.trim().replace(/[\s./-]/g, '');
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  if (trimmed.startsWith('0')) return `+49${trimmed.slice(1)}`;
  return trimmed;
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Die Kampagne braucht einen Namen.').max(200),
  goal: z.string().trim().min(1, 'Ohne Ziel weiß der Agent nicht, warum er anruft.').max(2000),
  openingLine: z.string().trim().max(500),
  agentId: z.string().uuid('Bitte einen Agenten wählen.'),
  phoneNumberId: z.string().uuid('Bitte eine Nummer wählen, von der aus angerufen wird.'),
  timezone: z.string().trim().min(1).max(64),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  retryAfterMinutes: z.coerce.number().int().min(15).max(10080),
  maxConcurrent: z.coerce.number().int().min(1).max(50),
});

/**
 * Liest das Anrufzeitfenster aus dem Formular.
 *
 * Ein Tag ohne Haken heißt: an dem Tag wird nicht angerufen. Das ist die
 * sichere Lesart — ein vergessener Haken schweigt, statt zu wählen.
 */
type CallingWindow = Record<string, [string, string]>;

function readCallingWindow(formData: FormData): { window: CallingWindow } | { error: string } {
  const window: CallingWindow = {};
  for (const day of WEEK) {
    if (formData.get(`day-${day}`) !== 'on') continue;
    const from = String(formData.get(`from-${day}`) ?? '').trim();
    const to = String(formData.get(`to-${day}`) ?? '').trim();
    if (!TIME.test(from) || !TIME.test(to)) {
      return { error: `${DAY_LABELS[day]}: Uhrzeiten im Format 09:00 angeben.` };
    }
    if (from >= to) {
      return { error: `${DAY_LABELS[day]}: Der Beginn muss vor dem Ende liegen — sonst ruft die Kampagne nie jemanden an.` };
    }
    window[day] = [from, to];
  }
  return { window };
}

export async function createCampaign(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    goal: formData.get('goal'),
    openingLine: formData.get('openingLine') ?? '',
    agentId: formData.get('agentId'),
    phoneNumberId: formData.get('phoneNumberId'),
    timezone: formData.get('timezone') ?? 'Europe/Berlin',
    maxAttempts: formData.get('maxAttempts') ?? 3,
    retryAfterMinutes: formData.get('retryAfterMinutes') ?? 240,
    maxConcurrent: formData.get('maxConcurrent') ?? 5,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const parsedWindow = readCallingWindow(formData);
  if ('error' in parsedWindow) return { error: parsedWindow.error };
  const window = parsedWindow.window;
  if (Object.keys(window).length === 0) {
    return { error: 'Ohne einen einzigen Anruftag würde die Kampagne laufen und nie jemanden erreichen.' };
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Kampagnen anlegen — ein Anruf kostet Geld und trifft Fremde.' };

  const { data: created, error } = await supabase
    .from('call_campaigns')
    .insert({
      organization_id: actor.organizationId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      opening_line: parsed.data.openingLine,
      agent_id: parsed.data.agentId,
      phone_number_id: parsed.data.phoneNumberId,
      timezone: parsed.data.timezone,
      calling_window: window,
      max_attempts: parsed.data.maxAttempts,
      retry_after_minutes: parsed.data.retryAfterMinutes,
      max_concurrent: parsed.data.maxConcurrent,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error || !created) return { error: error?.message ?? 'Kampagne konnte nicht angelegt werden.' };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'create',
    entityType: 'campaign',
    entityId: created.id,
    entityLabel: parsed.data.name,
    changes: { goal: parsed.data.goal, calling_window: window },
  });

  revalidatePath('/campaigns');
  return { error: null, ok: 'Kampagne als Entwurf angelegt. Jetzt Nummern hinzufügen.' };
}

/**
 * Nimmt eine Liste, wie sie aus einer Tabelle kommt: eine Zeile je Ziel,
 * Nummer zuerst, danach optional Name und Vorgang.
 *
 * Doppelte Nummern werden übersprungen statt abgelehnt — wer 500 Zeilen
 * einfügt, soll nicht wegen einer Dublette von vorn anfangen. Was übersprungen
 * wurde, steht in der Rückmeldung.
 */
export async function addTargets(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const campaignId = String(formData.get('campaignId') ?? '');
  if (!campaignId) return { error: 'Kampagne fehlt.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Anrufziele hinzufügen.' };

  const rows: Array<{ e164: string; name: string | null; note: string | null }> = [];
  const rejected: string[] = [];
  for (const line of String(formData.get('targets') ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawNumber, rawName, rawNote] = trimmed.split(/[;,\t]/).map((part) => part?.trim() ?? '');
    const e164 = normalizeE164(rawNumber ?? '');
    if (!E164.test(e164)) {
      rejected.push(trimmed.slice(0, 40));
      continue;
    }
    rows.push({ e164, name: rawName || null, note: rawNote || null });
  }

  if (rows.length === 0) {
    return { error: rejected.length > 0 ? `Keine gültige Nummer dabei. Zuerst gescheitert: „${rejected[0]}”` : 'Keine Zeilen eingegeben.' };
  }
  if (rows.length > 5000) return { error: 'Höchstens 5000 Nummern auf einmal.' };

  // Dubletten in der Kampagne sind ein Doppelanruf, und den merkt sich der
  // Angerufene. Der Unique-Index fängt sie ohnehin; `upsert` mit ignoreDuplicates
  // macht daraus ein Überspringen statt eines Abbruchs mitten in der Liste.
  const { data: inserted, error } = await supabase
    .from('campaign_targets')
    .upsert(
      rows.map((row) => ({
        organization_id: actor.organizationId,
        campaign_id: campaignId,
        e164: row.e164,
        display_name: row.name,
        context: row.note ? { notiz: row.note } : {},
      })),
      { onConflict: 'campaign_id,e164', ignoreDuplicates: true },
    )
    .select('id');

  if (error) return { error: error.message };

  const added = inserted?.length ?? 0;
  const skipped = rows.length - added;
  const parts = [`${added} Nummer${added === 1 ? '' : 'n'} übernommen`];
  if (skipped > 0) parts.push(`${skipped} bereits vorhanden`);
  if (rejected.length > 0) parts.push(`${rejected.length} unlesbar`);

  revalidatePath('/campaigns');
  return { error: null, ok: `${parts.join(', ')}.` };
}

export async function setCampaignStatus(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const campaignId = String(formData.get('campaignId') ?? '');
  const raw = String(formData.get('status') ?? '');
  const STATES: CampaignStatus[] = ['draft', 'running', 'paused', 'done'];
  const status = STATES.find((candidate) => candidate === raw);
  if (!campaignId || !status) return { error: 'Unbekannter Zustand.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können eine Kampagne starten oder anhalten.' };

  // Eine Kampagne ohne offene Ziele zu starten sähe aus wie Arbeit und wäre
  // keine. Die Prüfung steht hier und nicht in der Datenbank, weil sie von der
  // Zielliste abhängt und nicht von der Kampagnenzeile.
  if (status === 'running') {
    const { count } = await supabase
      .from('campaign_targets')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('outcome', 'pending');
    if (!count) return { error: 'Kein offenes Anrufziel. Erst Nummern hinzufügen, dann starten.' };
  }

  const { error } = await supabase
    .from('call_campaigns')
    .update({
      status,
      ...(status === 'running' ? { started_at: new Date().toISOString() } : {}),
      ...(status === 'done' ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq('id', campaignId);

  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'campaign',
    entityId: campaignId,
    entityLabel: campaignId,
    changes: { status: { from: null, to: status } },
  });

  revalidatePath('/campaigns');
  return { error: null, ok: status === 'running' ? 'Kampagne läuft. Der Zeitplan greift beim nächsten Durchlauf.' : 'Zustand geändert.' };
}
