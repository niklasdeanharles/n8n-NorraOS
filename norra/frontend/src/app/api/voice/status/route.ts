import type { NextRequest } from 'next/server';
import { verifyWebhook } from '@/lib/voice/session';
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
    .select('id, conversation_id, status, turn_count')
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

  return new Response(null, { status: 204 });
}
