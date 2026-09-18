import type { NextRequest } from 'next/server';
import { parseBusinessHours, isOpen, closureFor, localDate } from '@/lib/voice/hours';
import { callbackUrl, verifyWebhook } from '@/lib/voice/session';
import { dial, gather, hangup, record, reject, say, twiml } from '@/lib/voice/twilio';
import { hintsFrom } from '@/lib/voice/keyterms';
import { languageLabel } from '@/lib/voice/languages';

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
             voicemail_message, max_call_seconds, recording_enabled, recording_notice, business_hours, timezone,
             after_hours, e164, agent:agents(voice_config)`)
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

  /**
   * Schließtage stehen über den Öffnungszeiten.
   *
   * `business_hours` kennt nur die Woche. Am ersten Weihnachtstag steht dort
   * „Donnerstag, acht bis achtzehn" und stimmt trotzdem nicht. Deshalb wird
   * zuerst gefragt, ob heute überhaupt einer ist — und erst dann, wie spät.
   *
   * Nur die Zeilen, die heute noch gelten können: `ends_on >= heute` schneidet
   * die Weihnachtsferien der letzten fünf Jahre weg, bevor sie über die Leitung
   * gehen.
   */
  const { data: closures } = await supabase
    .from('closure_days')
    .select('starts_on, ends_on, label, message, phone_number_id')
    .eq('organization_id', number.organization_id)
    .gte('ends_on', localDate(number.timezone));
  const closure = closureFor(closures ?? [], number.id, number.timezone);

  const open = closure === null && isOpen(parseBusinessHours(number.business_hours), number.timezone);

  /**
   * Der Hinweis vor dem Mitschnitt.
   *
   * In Deutschland ist es strafbar, das nicht öffentlich gesprochene Wort ohne
   * Einwilligung aufzuzeichnen (§ 201 StGB), und eine Einwilligung setzt
   * voraus, dass jemand vorher Bescheid weiß. Die Datenbank lässt
   * `recording_enabled` deshalb gar nicht erst ohne hinterlegte Ansage zu; hier
   * wird sie gesprochen.
   *
   * Sie steht **vor** allem anderen, auch vor der Begrüßung: nach dem ersten
   * Satz des Anrufers wäre sie zu spät.
   */
  const notice =
    number.recording_enabled && number.recording_notice
      ? say(number.recording_notice, voice)
      : '';

  /**
   * Die Ansage des Schließtags, wenn einer hinterlegt ist.
   *
   * Sie ersetzt nicht das Verhalten, sie geht ihm voraus: „wir haben
   * Betriebsferien bis zum sechsten Januar" plus Anrufbeantworter ist eine
   * Auskunft, „außerhalb unserer Öffnungszeiten" plus Anrufbeantworter ist
   * keine.
   */
  const closureLine = closure?.message?.trim() ? say(closure.message, voice) : '';

  // An einem Schließtag mit `after_hours: 'agent'` läuft der Agent weiter --
  // er soll ja sagen können, wann wieder offen ist. Ohne Agent hinter der
  // Leitung greift, was für Feierabend eingestellt ist.
  if (!open && number.after_hours !== 'agent') {
    if (number.after_hours === 'reject') return twiml(closureLine + reject());
    if (number.after_hours === 'transfer' && number.transfer_number) {
      return twiml(
        closureLine +
          say('Ich verbinde Sie mit einem Mitarbeiter.', voice) +
          dial({
            number: number.transfer_number,
            callerId: number.e164,
            // Kein Rückfall: außerhalb der Zeiten steht hinter dieser Nummer
            // kein Agent, der eine Nachricht aufnehmen könnte.
            timeout: 25,
          }),
      );
    }
    // Voicemail. The recording is picked up by the recording callback.
    //
    // Hier ist die Ansage kein Formalismus: der Anrufer spricht gleich auf
    // Band, und zwar ohne dass jemand mithört, der ihn darauf hinweisen könnte.
    return twiml(
      notice +
        closureLine +
        say(number.voicemail_message || 'Wir sind gerade nicht erreichbar. Bitte hinterlassen Sie eine Nachricht.', voice) +
        record({ action: callbackUrl('/api/voice/recording'), maxLength: 180 }),
    );
  }

  // The caller, recognised by their number. Doing this before the conversation
  // means both it and the call can point at the contact from the start, so
  // `identify_caller` has something to find on the very first turn.
  //
  // One statement rather than select-then-insert: two lines ringing at once
  // from the same number would otherwise race into a unique violation. A
  // failure here is not fatal — an unrecognised caller is still a caller.
  let contactId: string | null = null;
  if (from) {
    const { data } = await supabase.rpc('touch_contact', {
      p_organization_id: number.organization_id,
      p_e164: from,
    });
    contactId = typeof data === 'string' ? data : null;
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
        contact_id: contactId,
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
        contact_id: contactId,
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

  /**
   * Der Agent muss wissen, dass heute zu ist.
   *
   * Hier läuft er trotz Schließtag — `after_hours: 'agent'` heißt ja, dass er
   * auch außerhalb der Zeiten antworten soll. Ohne diese Zeile sagt er
   * fröhlich „wir haben bis achtzehn Uhr geöffnet", weil in seinen
   * Öffnungszeiten Donnerstag steht. Die Notiz geht als `system` in die
   * Historie, die jeder Zug mitlädt.
   *
   * Nicht als gesprochener Satz und nicht in den System-Prompt: der Prompt
   * gehört dem Betreiber und wird nicht pro Anruf umgeschrieben.
   */
  /**
   * Welche Sprachen diese Leitung noch spricht.
   *
   * Als `system`-Notiz und nicht als Feld im Webhook-Payload: der
   * n8n-Workflow müsste sonst mitgeändert werden, und eine Sprache, die die
   * Datenbank kennt, aber der Workflow noch nicht durchreicht, wäre genau die
   * stille Lücke. Die Historie liest jeder Zug ohnehin.
   *
   * Der Agent bekommt hier keine Erlaubnis, sondern eine Auskunft: die
   * Erlaubnis prüft `/api/voice/turn` ein zweites Mal gegen dieselbe Tabelle.
   */
  const { data: languages } = await supabase
    .from('phone_languages')
    .select('code')
    .eq('organization_id', number.organization_id)
    .eq('phone_number_id', number.id);

  if (languages && languages.length > 0) {
    const list = languages.map((row) => `${languageLabel(row.code)} (${row.code})`).join(', ');
    await supabase.from('messages').insert({
      organization_id: number.organization_id,
      conversation_id: conversation.id,
      role: 'system',
      content:
        `Diese Leitung bedient außer ${languageLabel(number.language)} (${number.language}) auch: ${list}. ` +
        'Spricht der Anrufer eine davon, antworte in dieser Sprache und gib ihren Code im Feld "language" zurück. ' +
        'Andere Sprachen gibt es hier nicht — biete keine an, die nicht in dieser Liste steht.',
    });
  }

  if (closure) {
    await supabase.from('messages').insert({
      organization_id: number.organization_id,
      conversation_id: conversation.id,
      role: 'system',
      content:
        `Hinweis: Heute ist geschlossen (${closure.label}, bis einschließlich ${closure.ends_on}). ` +
        'Sage keine Öffnung für heute zu und nenne stattdessen den ersten Tag danach.',
    });
  }

  const greeting = number.greeting.trim() || DEFAULT_GREETING;
  return twiml(
    notice +
    closureLine +
    gather({
      action: callbackUrl('/api/voice/turn', { call: call.id }),
      language: number.language,
      voice: number.voice,
      prompt: greeting,
      // Schon beim Begrüßungs-Gather, nicht erst ab dem zweiten Zug: der erste
      // Satz eines Anrufers trägt meistens genau das Wort, um das es geht.
      hints: hintsFrom(number.agent?.voice_config),
    }) +
      // Reached only if the caller says nothing at all.
      say('Ich habe leider nichts verstanden. Auf Wiederhören.', voice) +
      hangup(),
  );
}
