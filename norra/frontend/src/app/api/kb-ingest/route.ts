import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { callN8nWebhook, N8N_WEBHOOKS } from '@/lib/n8n/client';

/**
 * Creates the document row, then hands the text to the n8n kb-ingest workflow,
 * which chunks, embeds and writes to knowledge_base_chunks.
 *
 * The row is created here rather than in n8n so the document is visible in the
 * UI as `pending` the moment it is submitted, even if the workflow is down.
 */
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(500_000),
  agentId: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 403 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'only admins may curate the knowledge base' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid request' }, { status: 400 });
  }

  // Content hash, so re-submitting an unchanged document is caught by the
  // unique index rather than silently duplicating every chunk.
  const checksum = createHash('sha256').update(parsed.data.content).digest('hex');

  const { data: document, error: insertError } = await supabase
    .from('knowledge_base_documents')
    .insert({
      organization_id: profile.organization_id,
      agent_id: parsed.data.agentId ?? null,
      title: parsed.data.title,
      source_type: 'text',
      checksum,
      status: 'pending',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (insertError || !document) {
    const duplicate = insertError?.code === '23505';
    return NextResponse.json(
      { error: duplicate ? 'Dieses Dokument ist unverändert bereits vorhanden.' : 'Dokument konnte nicht angelegt werden.' },
      { status: duplicate ? 409 : 500 },
    );
  }

  try {
    const upstream = await callN8nWebhook(N8N_WEBHOOKS.kbIngest, {
      organization_id: profile.organization_id,
      document_id: document.id,
      agent_id: parsed.data.agentId ?? '',
      title: parsed.data.title,
      content: parsed.data.content,
    });

    if (!upstream.ok) throw new Error(`n8n responded ${upstream.status}`);
  } catch (error) {
    // The row stays as a failed document rather than vanishing, so the failure
    // is visible in the UI instead of looking like the upload never happened.
    await supabase
      .from('knowledge_base_documents')
      .update({ status: 'failed', error: error instanceof Error ? error.message : 'ingest failed' })
      .eq('id', document.id);

    return NextResponse.json({ error: 'Ingestion konnte nicht gestartet werden.', documentId: document.id }, { status: 502 });
  }

  return NextResponse.json({ documentId: document.id, status: 'processing' }, { status: 202 });
}
