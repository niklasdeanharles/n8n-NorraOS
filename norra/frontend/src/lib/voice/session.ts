import { voiceEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { readTwilioForm, signedUrl, verifyTwilioSignature } from '@/lib/voice/twilio';

/**
 * The gate every voice webhook goes through.
 *
 * A caller is not a Supabase auth user, so these routes run with the service
 * role and RLS protects nothing here. Two things stand in for it: the Twilio
 * signature, which proves the request came from the telephony provider, and the
 * rule that the organization is always *derived* from the dialled number --
 * never read out of the request. A body-supplied tenant id is a tenant id the
 * caller chose.
 */

export type VerifiedWebhook =
  | { ok: true; params: Record<string, string>; supabase: ReturnType<typeof createServiceRoleClient> }
  | { ok: false; response: Response };

export async function verifyWebhook(request: Request): Promise<VerifiedWebhook> {
  let env: ReturnType<typeof voiceEnv>;
  try {
    env = voiceEnv();
  } catch {
    // Telephony is not configured on this instance. Say so with a status the
    // provider treats as "stop retrying", not as a transient failure.
    return { ok: false, response: new Response('telephony is not configured', { status: 501 }) };
  }

  const params = await readTwilioForm(request);
  const valid = verifyTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    url: signedUrl(env.NORRA_PUBLIC_URL, request),
    params,
    signature: request.headers.get('x-twilio-signature'),
  });

  if (!valid) {
    return { ok: false, response: new Response('invalid signature', { status: 403 }) };
  }

  return { ok: true, params, supabase: createServiceRoleClient() };
}

/** Absolute callback URL. Twilio needs one, and it must sit under the signed base. */
export function callbackUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(path, voiceEnv().NORRA_PUBLIC_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}
