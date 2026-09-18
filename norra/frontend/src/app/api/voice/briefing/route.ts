import type { NextRequest } from 'next/server';
import { verifyWebhook } from '@/lib/voice/session';
import { say, twiml } from '@/lib/voice/twilio';
import { voiceFor } from '@/lib/voice/languages';

/**
 * Der Satz, den der Mitarbeiter hört, bevor verbunden wird.
 *
 * Twilio holt dieses TwiML, wenn die angerufene Seite abhebt, und spielt es
 * **nur ihr** vor — der wartende Anrufer hört nichts davon. Erst danach werden
 * die Leitungen zusammengeschaltet.
 *
 * Das ist Retells „Agentic Human Handoff" mit den Mitteln, die eine Telefonie-
 * API ohnehin hat: kein Media-Stream, keine zweite Infrastruktur, ein
 * `<Number url="…">`.
 *
 * **Das Briefing steht in der Datenbank, nicht im Query-Parameter.** Ein
 * Parameter wäre ein Satz, den jemand mit einer gültigen Signatur frei wählen
 * könnte; hier wird er aus der Anrufzeile gelesen, in die ihn der Agent-Lauf
 * geschrieben hat.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { supabase } = verified;

  const callId = new URL(request.url).searchParams.get('call');
  if (!callId) return twiml('');

  const { data: call } = await supabase
    .from('calls')
    .select('id, transfer_briefing, phone_number_id, from_e164, language, voice')
    .eq('id', callId)
    .maybeSingle();

  const briefing = call?.transfer_briefing?.trim();
  // Ohne hinterlegtes Briefing wird nichts gesagt und sofort verbunden. Eine
  // erfundene Ansage wäre schlechter als gar keine.
  if (!briefing) return twiml('');

  const { data: number } = await supabase
    .from('phone_numbers')
    .select('voice, language')
    .eq('id', call?.phone_number_id ?? '')
    .maybeSingle();

  // Dieselbe Stimme, in der das Gespräch geführt wurde. Der Mitarbeiter hört
  // sonst ein deutsches Briefing über einen englischen Anrufer — und weiß
  // nicht, dass er gleich Englisch sprechen muss.
  return twiml(say(briefing, voiceFor(call ?? null, number)));
}
