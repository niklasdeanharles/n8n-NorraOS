import type { NextRequest } from 'next/server';
import { verifyWebhook } from '@/lib/voice/session';
import { say, twiml } from '@/lib/voice/twilio';

/**
 * A voicemail was left.
 *
 * Files the recording as a ticket so it lands in the same queue as everything
 * else. A voicemail that only exists as a URL in a call row is a voicemail
 * nobody listens to.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const providerCallId = params.CallSid ?? '';
  const recordingUrl = params.RecordingUrl ?? '';

  const { data: call } = await supabase
    .from('calls')
    .select('id, organization_id, conversation_id, agent_id, from_e164')
    .eq('provider_call_id', providerCallId)
    .maybeSingle();

  if (call) {
    await supabase
      .from('calls')
      .update({ status: 'voicemail', recording_url: recordingUrl || null, ended_reason: 'voicemail' })
      .eq('id', call.id);

    await supabase.from('tickets').insert({
      organization_id: call.organization_id,
      conversation_id: call.conversation_id,
      agent_id: call.agent_id,
      subject: `Sprachnachricht von ${call.from_e164 ?? 'unbekannt'}`,
      description: recordingUrl ? `Aufnahme: ${recordingUrl}` : 'Aufnahme nicht verfügbar.',
      status: 'open',
      priority: 'normal',
      source: 'agent_escalation',
    });
  }

  return twiml(say('Vielen Dank für Ihre Nachricht. Auf Wiederhören.', { voice: 'alice', language: 'de-DE' }));
}
