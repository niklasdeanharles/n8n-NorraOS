import type { NextRequest } from 'next/server';
import { callbackUrl, verifyWebhook } from '@/lib/voice/session';
import { gather, hangup, say, twiml } from '@/lib/voice/twilio';
import { hintsFrom } from '@/lib/voice/keyterms';
import { voiceFor } from '@/lib/voice/languages';

/**
 * Was passiert, nachdem durchgestellt wurde — und was, wenn niemand abnimmt.
 *
 * Ein `<Dial>` ohne `action` ist eine Einbahnstraße: hebt die angerufene Seite
 * nicht ab, hört der Anrufer das Freizeichen aufhören und danach nichts mehr.
 * Genau das unterscheidet eine Telefonanlage von einem Empfang. Ein Mensch am
 * Empfang sagt in diesem Moment „Frau Vogel geht gerade nicht ran — kann ich
 * ihr etwas ausrichten?"
 *
 * Twilio postet hierher, wenn das Gespräch zu Ende ist **oder** gar nicht erst
 * zustande kam. `DialCallStatus` sagt, welcher der beiden Fälle vorliegt.
 */
export const dynamic = 'force-dynamic';

/** Die Stati, bei denen ein Gespräch tatsächlich stattgefunden hat. */
const CONNECTED = new Set(['completed', 'answered']);

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const callId = new URL(request.url).searchParams.get('call');
  if (!callId) return twiml(hangup());

  const { data: call } = await supabase
    .from('calls')
    .select('id, organization_id, conversation_id, phone_number_id, transferred_to, language, voice, agent:agents(voice_config)')
    .eq('id', callId)
    .maybeSingle();

  const { data: number } = await supabase
    .from('phone_numbers')
    .select('voice, language')
    .eq('id', call?.phone_number_id ?? '')
    .maybeSingle();

  // Wurde das Gespräch auf Englisch geführt, kommt auch die Nachfrage auf
  // Englisch. Ein Rückfall auf die Vorgabe der Leitung wäre genau hier am
  // auffälligsten: der Anrufer wartet, und dann spricht ihn jemand anders an.
  const voice = voiceFor(call ?? null, number);
  const status = params.DialCallStatus ?? '';

  // Verbunden und wieder aufgelegt: hier ist nichts mehr zu tun. Die Zeile
  // steht schon auf `transferred`, und die Statusrückmeldung schließt den
  // Anruf ab.
  if (CONNECTED.has(status)) return twiml(hangup());

  if (!call) return twiml(hangup());

  /**
   * Die Zeile zurücknehmen.
   *
   * `status: 'transferred'` wurde gesetzt, als das TwiML geschrieben wurde —
   * zu einem Zeitpunkt, an dem niemand wissen konnte, ob jemand abhebt. Jetzt
   * weiß es jemand. Eine Zeile, die „weitergeleitet" behauptet, obwohl es
   * nicht dazu kam, ist später in der Auswertung eine Lüge, die keiner mehr
   * nachprüft.
   */
  await supabase
    .from('calls')
    .update({ status: 'in_progress', transferred_to: null, transfer_briefing: null, ended_reason: null })
    .eq('id', call.id);

  const wanted = call.transferred_to ? 'Die gewünschte Person' : 'Der Mitarbeiter';
  const line = `${wanted} ist gerade nicht erreichbar. Soll ich etwas ausrichten?`;

  /**
   * Der Satz kommt auch in die Historie, nicht nur ans Ohr.
   *
   * Der nächste Zug lädt die bisherigen Nachrichten und gibt sie dem Modell
   * mit. Ohne diese Zeile führte der Agent das Gespräch fort, als wäre nie
   * durchgestellt worden — und fragte womöglich ein zweites Mal, ob er
   * verbinden soll. Mit ihr weiß er, dass der Versuch gescheitert ist, und
   * `take_message` liegt nahe.
   */
  if (call.conversation_id) {
    await supabase.from('messages').insert({
      organization_id: call.organization_id,
      conversation_id: call.conversation_id,
      role: 'assistant',
      content: line,
    });
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', call.conversation_id);
  }

  return twiml(
    gather({
      action: callbackUrl('/api/voice/turn', { call: call.id }),
      language: voice.language,
      voice: voice.voice,
      prompt: line,
      hints: hintsFrom(call.agent?.voice_config),
    }) +
      say('Ich habe leider nichts verstanden. Auf Wiederhören.', voice) +
      hangup(),
  );
}
