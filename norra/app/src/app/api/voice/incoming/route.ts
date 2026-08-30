import type { NextRequest } from 'next/server';
import { parseBusinessHours, isOpen } from '@/lib/voice/hours';
import { callbackUrl, verifyWebhook } from '@/lib/voice/session';
import { dial, gather, hangup, record, reject, say, twiml } from '@/lib/voice/twilio';

/**
 * A call arrives.
 *
 * This is the one URL a customer pastes into their provider. Everything else --
 * which agent answers, what it says first, what happens after hours -- is a row
 * in `phone_numbers`, so setting up a second line never touches code.
 */
export const dynamic = 'force-dynamic';

const DEFAULT_GREETING = 'Guten Tag, Sie sprechen mit dem digitalen Assistenten. Wie kann ich Ihnen helfen?';

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const to = params.To ?? '';
  const from = params.From ?? '';
  const providerCallId = params.CallSid ?? '';
  if (!to || !providerCallId) {
    return twiml(say('Der Anruf konnte nicht zugeordnet werden.', { voice: 'alice', language: 'de-DE' }) + hangup());
  }

  // The dialled number is the tenant. It is globally unique, so this lookup
  // cannot return two organizations.
  const { data: number } = await supabase
    .from('phone_numbers')
    .select(`id, organization_id, agent_id, greeting, voice, language, status, transfer_number,
             voicemail_message, max_call_seconds, recording_enabled, business_hours, timezone,
             after_hours, e164`)
    .eq('e164', to)
    .maybeSingle();

  // An unknown or paused number is answered politely and hung up. Silence would
  // leave the caller listening to nothing, which reads as a broken line.
  if (!number || number.status !== 'active' || !number.agent_id) {
    return twiml(
      say('Diese Nummer ist derzeit nicht belegt. Bitte versuchen Sie es später erneut.', {
        voice: number?.voice ?? 'alice',
        language: number?.language ?? 'de-DE',
      }) + hangup(),
    );
  }

  const voice = { voice: number.voice, language: number.language };
  const open = isOpen(parseBusinessHours(number.business_hours), number.timezone);

  if (!open && number.after_hours !== 'agent') {
    if (number.after_hours === 'reject') return twiml(reject());
    if (number.after_hours === 'transfer' && number.transfer_number) {
      return twiml(
        say('Ich verbinde Sie mit einem Mitarbeiter.', voice) + dial(number.transfer_number, number.e164),
      );
    }
    // Voicemail. The recording is picked up by the recording callback.
    return twiml(
      say(number.voicemail_message || 'Wir sind gerade nicht erreichbar. Bitte hinterlassen Sie eine Nachricht.', voice) +
        record({ action: callbackUrl('/api/voice/recording'), maxLength: 180 }),
    );
  }

  // One conversation per call, keyed by the provider's call id so a retried
  // webhook lands on the same row instead of starting a second conversation.
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .upsert(
      {
        organization_id: number.organization_id,
        agent_id: number.agent_id,
        channel: 'voice',
        external_id: providerCallId,
        end_user_name: from || null,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,channel,external_id' },
    )
    .select('id')
    .single();

  if (conversationError || !conversation) {
    return twiml(say('Es gab ein technisches Problem. Bitte rufen Sie später erneut an.', voice) + hangup());
  }

  const { data: call, error: callError } = await supabase
    .from('calls')
    .upsert(
      {
        organization_id: number.organization_id,
        phone_number_id: number.id,
        conversation_id: conversation.id,
        agent_id: number.agent_id,
        provider_call_id: providerCallId,
        from_e164: from || null,
        to_e164: to,
        status: 'in_progress',
        answered_at: new Date().toISOString(),
      },
      { onConflict: 'provider_call_id' },
    )
    .select('id')
    .single();

  if (callError || !call) {
    return twiml(say('Es gab ein technisches Problem. Bitte rufen Sie später erneut an.', voice) + hangup());
  }

  await supabase.from('phone_numbers').update({ last_call_at: new Date().toISOString() }).eq('id', number.id);

  const greeting = number.greeting.trim() || DEFAULT_GREETING;
  return twiml(
    gather({
      action: callbackUrl('/api/voice/turn', { call: call.id }),
      language: number.language,
      voice: number.voice,
      prompt: greeting,
    }) +
      // Reached only if the caller says nothing at all.
      say('Ich habe leider nichts verstanden. Auf Wiederhören.', voice) +
      hangup(),
  );
}
