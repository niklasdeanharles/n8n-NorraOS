import type { NextRequest } from 'next/server';
import { verifyWebhook } from '@/lib/voice/session';
import type { AnsweredBy, TargetOutcome } from '@/types/database';

/**
 * Twilio hat erkannt, wer abgenommen hat.
 *
 * Kommt nur bei ausgehenden Anrufen und nur, wenn `outbound-call` beim Wählen
 * `AsyncAmd` gesetzt hat. Asynchron heißt: der Anruf läuft bereits, während die
 * Erkennung noch rechnet — dieses Ergebnis trifft also mitten im Gespräch ein.
 *
 * Deshalb wird hier **nicht** aufgelegt. Das Auflegen wäre ein REST-Aufruf an
 * Twilio, für den diese App keine Zugangsdaten hat und auch keine bekommen
 * soll — sie prüft Signaturen, sie steuert keine Anrufe. Stattdessen wird das
 * Ergebnis festgehalten, und `/api/voice/turn` weigert sich beim nächsten Zug,
 * einen Agentenlauf auf ein Band zu schicken. Das kostet höchstens einen
 * gesprochenen Satz und braucht kein zweites Geheimnis.
 */
export const dynamic = 'force-dynamic';

/** Twilios Werte auf unsere. Alles Unbekannte ist `unknown`, nicht `human`. */
const ANSWERED_BY: Record<string, AnsweredBy> = {
  human: 'human',
  machine_start: 'machine',
  machine_end_beep: 'machine',
  machine_end_silence: 'machine',
  machine_end_other: 'machine',
  fax: 'fax',
  unknown: 'unknown',
};

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const providerCallId = params.CallSid;
  if (!providerCallId) return new Response(null, { status: 204 });

  const answeredBy = ANSWERED_BY[params.AnsweredBy ?? ''] ?? 'unknown';

  const { data: call } = await supabase
    .from('calls')
    .select('id, organization_id, conversation_id, campaign_target_id')
    .eq('provider_call_id', providerCallId)
    .maybeSingle();

  if (!call) return new Response(null, { status: 204 });

  await supabase
    .from('calls')
    .update({ answered_by: answeredBy })
    .eq('id', call.id)
    .eq('organization_id', call.organization_id);

  // Ein Mensch am Hörer ist der Normalfall und braucht nichts weiter.
  if (answeredBy === 'human' || !call.campaign_target_id) return new Response(null, { status: 204 });

  // Ein Band ist kein Fehlschlag, sondern ein eigenes Ergebnis: die Nummer
  // stimmt, der Zeitpunkt nicht. Als `failed` gezählt würde es die Kampagne
  // schlechter aussehen lassen, als sie ist — und die Wiederholung verhindern.
  const outcome: TargetOutcome = answeredBy === 'fax' ? 'failed' : 'voicemail';

  await supabase
    .from('campaign_targets')
    .update({ outcome })
    .eq('id', call.campaign_target_id)
    .eq('organization_id', call.organization_id);

  return new Response(null, { status: 204 });
}
