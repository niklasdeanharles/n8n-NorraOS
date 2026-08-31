import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/**
 * Signs the conversation identity carried between the browser and the widget
 * API — the "signed conversation token" the architecture doc promises.
 *
 * A widget visitor is not a Supabase user, so there is no session and no RLS.
 * This is the entire trust boundary: whoever holds a valid token gets to act
 * as that conversation and nothing else. Payload fields are therefore fixed at
 * mint time and never taken from the request again — a client-supplied
 * organization or agent id would let a forged-but-unsigned request read
 * another tenant's conversation.
 *
 * Format is a compact JWT-shaped string (base64url(payload).base64url(sig))
 * rather than an actual JWT library: one HMAC and one comparison is the whole
 * mechanism, and it matches the pattern already used for Twilio signatures.
 */

export type WidgetTokenPayload = {
  /** conversation id */
  c: string;
  /** organization id */
  o: string;
  /** agent id */
  a: string;
  /** expiry, unix seconds */
  e: number;
};

const TTL_SECONDS = 60 * 60 * 12;

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function sign(payload: string): string {
  const { N8N_WEBHOOK_SECRET } = serverEnv();
  // Reuses the webhook secret's trust root under a distinct HMAC key rather
  // than a second secret an operator would have to remember to set: the two
  // purposes never need independent rotation from each other.
  return base64url(createHmac('sha256', `widget:${N8N_WEBHOOK_SECRET}`).update(payload).digest());
}

export function mintWidgetToken(conversationId: string, organizationId: string, agentId: string): string {
  const payload: WidgetTokenPayload = {
    c: conversationId,
    o: organizationId,
    a: agentId,
    e: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body)}`;
}

export function verifyWidgetToken(token: string): WidgetTokenPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as WidgetTokenPayload).c !== 'string' ||
    typeof (payload as WidgetTokenPayload).o !== 'string' ||
    typeof (payload as WidgetTokenPayload).a !== 'string' ||
    typeof (payload as WidgetTokenPayload).e !== 'number'
  ) {
    return null;
  }
  const typed = payload as WidgetTokenPayload;
  if (typed.e < Math.floor(Date.now() / 1000)) return null;
  return typed;
}
