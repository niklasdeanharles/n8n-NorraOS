import type { NextRequest } from 'next/server';
import { callbackUrl, verifyWebhook } from '@/lib/voice/session';
import { gather, hangup, say, twiml } from '@/lib/voice/twilio';
import { hintsFrom } from '@/lib/voice/keyterms';

/**
 * Ein ausgehender Anruf wurde angenommen.
 *
 * Twilio holt dieses TwiML ab, sobald am anderen Ende jemand abhebt. Gewählt
 * hat `outbound-call` in n8n; hier entsteht nur der erste gesprochene Satz und
 * die Übergabe an `/api/voice/turn` — von da an läuft ein ausgehender Anruf
 * exakt wie ein eingehender.
 *
 * **Die Zielzeile ist der Mandant.** Sie steht im Query-Parameter, den n8n beim
 * Wählen gesetzt hat; alles Weitere wird daraus gelesen, nicht aus dem
 * Request-Body. Twilio schickt `To` und `From`, aber wessen Kampagne das war,
 * weiß nur die Datenbank.
 */
export const dynamic = 'force-dynamic';

const FALLBACK_VOICE = { voice: 'alice', language: 'de-DE' };

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const targetId = new URL(request.url).searchParams.get('target');
  const providerCallId = params.CallSid ?? '';
  if (!targetId || !providerCallId) return twiml(hangup());

  const { data: target } = await supabase
    .from('campaign_targets')
    .select(
      'id, organization_id, campaign_id, e164, display_name, contact_id, campaign:call_campaigns(agent_id, phone_number_id, opening_line, status)',
    )
    .eq('id', targetId)
    .maybeSingle();

  const campaign = target?.campaign;
  if (!target || !campaign?.agent_id || !campaign.phone_number_id) return twiml(hangup());

  // Eine pausierte Kampagne nimmt kein Gespräch mehr auf. Zwischen Wählen und
  // Abheben liegen Sekunden, in denen jemand auf "Pause" gedrückt haben kann —
  // und das hier ist der letzte Punkt, an dem das noch zählt.
  if (campaign.status !== 'running') {
    return twiml(say('Entschuldigen Sie bitte die Störung. Auf Wiederhören.', FALLBACK_VOICE) + hangup());
  }

  const { data: number } = await supabase
    .from('phone_numbers')
    .select('id, voice, language, agent:agents(voice_config)')
    .eq('id', campaign.phone_number_id)
    .eq('organization_id', target.organization_id)
    .maybeSingle();

  const voice = {
    voice: number?.voice ?? FALLBACK_VOICE.voice,
    language: number?.language ?? FALLBACK_VOICE.language,
    hints: hintsFrom(number?.agent?.voice_config),
  };

  // Eine Konversation pro Anruf, wie beim eingehenden auch — `external_id` ist
  // die CallSid, damit ein wiederholtes Webhook nichts doppelt anlegt.
  const { data: conversation } = await supabase
    .from('conversations')
    .upsert(
      {
        organization_id: target.organization_id,
        agent_id: campaign.agent_id,
        channel: 'voice',
        external_id: providerCallId,
        contact_id: target.contact_id,
        end_user_name: target.display_name,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,channel,external_id' },
    )
    .select('id')
    .single();

  if (!conversation) {
    return twiml(say('Es gab ein technisches Problem. Auf Wiederhören.', voice) + hangup());
  }

  const { data: call } = await supabase
    .from('calls')
    .upsert(
      {
        organization_id: target.organization_id,
        phone_number_id: campaign.phone_number_id,
        conversation_id: conversation.id,
        agent_id: campaign.agent_id,
        campaign_target_id: target.id,
        contact_id: target.contact_id,
        provider_call_id: providerCallId,
        direction: 'outbound',
        to_e164: target.e164,
        from_e164: params.From ?? null,
        status: 'in_progress',
        answered_at: new Date().toISOString(),
      },
      { onConflict: 'provider_call_id' },
    )
    .select('id')
    .single();

  if (!call) return twiml(say('Es gab ein technisches Problem. Auf Wiederhören.', voice) + hangup());

  await supabase
    .from('campaign_targets')
    .update({ last_call_id: call.id })
    .eq('id', target.id)
    .eq('organization_id', target.organization_id);

  // Wer anruft, schuldet dem Angerufenen als Erstes einen Grund. Ohne den
  // Eröffnungssatz beginnt das Gespräch mit einer Frage an jemanden, der nicht
  // weiß, warum sein Telefon geklingelt hat.
  const opening = campaign.opening_line.trim() || defaultOpening(target.display_name);

  return twiml(
    gather({ action: callbackUrl('/api/voice/turn', { call: call.id }), ...voice, prompt: opening }) +
      say('Ich habe leider nichts verstanden. Auf Wiederhören.', voice) +
      hangup(),
  );
}

function defaultOpening(name: string | null): string {
  const greeting = name ? `Guten Tag, ${name}.` : 'Guten Tag.';
  return `${greeting} Ich rufe im Auftrag Ihres Dienstleisters an. Haben Sie kurz Zeit?`;
}
