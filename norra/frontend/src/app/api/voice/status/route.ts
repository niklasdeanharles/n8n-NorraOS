import type { NextRequest } from 'next/server';
import { verifyWebhook } from '@/lib/voice/session';
import { N8N_WEBHOOKS, callN8nWebhook } from '@/lib/n8n/client';
import type { CallStatus } from '@/types/database';

/**
 * The call ended.
 *
 * Twilio posts this whatever the outcome, including the outcomes no other
 * webhook sees: the caller hung up mid-sentence, the line was busy, nobody
 * answered the transfer. Without it every abandoned call would sit in the
 * console as still running.
 */
export const dynamic = 'force-dynamic';

/** Provider status -> ours. Anything unmapped is recorded as failed, not dropped. */
const STATUS: Record<string, CallStatus> = {
  completed: 'completed',
  busy: 'busy',
  'no-answer': 'no_answer',
  failed: 'failed',
  canceled: 'no_answer',
};

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const providerCallId = params.CallSid;
  if (!providerCallId) return new Response(null, { status: 204 });

  const { data: call } = await supabase
    .from('calls')
    .select('id, organization_id, conversation_id, status, turn_count')
    .eq('provider_call_id', providerCallId)
    .maybeSingle();

  if (!call) return new Response(null, { status: 204 });

  const duration = Number.parseInt(params.CallDuration ?? '', 10);
  // A transfer is already a final state and a better description of what
  // happened than "completed".
  const status = call.status === 'transferred' ? 'transferred' : (STATUS[params.CallStatus ?? ''] ?? 'failed');

  await supabase
    .from('calls')
    .update({
      status,
      ended_at: new Date().toISOString(),
      duration_seconds: Number.isFinite(duration) ? duration : null,
      recording_url: params.RecordingUrl ?? null,
    })
    .eq('id', call.id);

  if (call.conversation_id) {
    // A call nobody spoke on is closed rather than resolved: there is nothing to
    // resolve, and counting it as deflected would flatter the numbers.
    const outcome = call.turn_count === 0 ? 'closed' : 'resolved';
    const stamp = new Date().toISOString();
    await supabase
      .from('conversations')
      .update(
        outcome === 'closed'
          ? { status: 'closed', closed_at: stamp }
          : { status: 'resolved', resolved_at: stamp },
      )
      .eq('id', call.conversation_id)
      // A human who took the call over, or an escalation, outranks this.
      .in('status', ['open', 'pending']);
  }

  // Die Nachbereitung läuft in n8n und darf dauern -- der Anrufer hat längst
  // aufgelegt. Twilio wartet trotzdem nicht darauf: dieser Callback wird
  // wiederholt, wenn er nicht schnell antwortet, und jede Wiederholung wäre
  // eine zweite Nachbereitung desselben Gesprächs.
  //
  // Ein Gespräch ohne einen einzigen Zug hat nichts nachzubereiten. Es gleich
  // hier auf `skipped` zu setzen ist ehrlicher, als es auf `pending` stehen zu
  // lassen, wo es aussähe wie eine Nachbereitung, die nie ankam.
  if (call.turn_count === 0) {
    await supabase.from('calls').update({ wrapup_status: 'skipped' }).eq('id', call.id);
    return new Response(null, { status: 204 });
  }

  void callN8nWebhook(N8N_WEBHOOKS.callWrapup, {
    organization_id: call.organization_id,
    call_id: call.id,
  }).catch(() => {
    // Ein Fehlschlag hier ist kein Grund, den Statuscallback scheitern zu
    // lassen: der Anruf selbst ist korrekt abgeschlossen. Die Zeile bleibt auf
    // `pending` und ist damit auffindbar, statt still als erledigt zu gelten.
  });

  return new Response(null, { status: 204 });
}
