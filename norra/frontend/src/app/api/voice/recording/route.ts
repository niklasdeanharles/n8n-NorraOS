import type { NextRequest } from 'next/server';
import { N8N_WEBHOOKS, callN8nWebhook } from '@/lib/n8n/client';
import { verifyWebhook } from '@/lib/voice/session';
import { say, twiml } from '@/lib/voice/twilio';

/**
 * A voicemail was left.
 *
 * Files the recording as a ticket so it lands in the same queue as everything
 * else. A voicemail that only exists as a URL in a call row is a voicemail
 * nobody listens to.
 *
 * Danach — und ausdrücklich erst danach — wird die Verschriftung angestoßen.
 * Das Ticket muss im Posteingang liegen, auch wenn n8n gerade steht oder die
 * Abschrift scheitert: ein Link, den jemand anhören muss, ist immer noch
 * besser als eine Nachricht, von der niemand erfährt.
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

    const { data: ticket } = await supabase
      .from('tickets')
      .insert({
        organization_id: call.organization_id,
        conversation_id: call.conversation_id,
        agent_id: call.agent_id,
        subject: `Sprachnachricht von ${call.from_e164 ?? 'unbekannt'}`,
        description: recordingUrl ? `Aufnahme: ${recordingUrl}` : 'Aufnahme nicht verfügbar.',
        status: 'open',
        priority: 'normal',
        source: 'agent_escalation',
      })
      .select('id')
      .single();

    // Ohne Aufnahme gibt es nichts zu verschriften, und ohne Ticket nichts, wo
    // die Abschrift hingehörte. Beides zu prüfen ist billiger als ein Lauf in
    // n8n, der erst am Ende merkt, dass er nichts zu tun hatte.
    if (recordingUrl && ticket) {
      void callN8nWebhook(N8N_WEBHOOKS.voicemailTranscribe, {
        organization_id: call.organization_id,
        call_id: call.id,
        ticket_id: ticket.id,
        recording_url: recordingUrl,
      }).catch(() => {
        // Der Anrufer hat längst aufgelegt, und Twilio wiederholt diesen
        // Callback, wenn er nicht schnell antwortet. Ein Fehlschlag hier darf
        // deshalb weder warten noch die Antwort scheitern lassen: das Ticket
        // trägt den Link zur Aufnahme und ist vollständig genug.
      });
    }
  }

  return twiml(say('Vielen Dank für Ihre Nachricht. Auf Wiederhören.', { voice: 'alice', language: 'de-DE' }));
}
