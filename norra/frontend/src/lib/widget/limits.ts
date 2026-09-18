import { createHash } from 'node:crypto';
import type { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The two guards on the one surface strangers can reach.
 *
 * Everything else in the app sits behind a Supabase session or a signed
 * webhook. The widget does not: a visitor on a customer's website has no
 * account and never will, and the agent id they need is sitting in the embed
 * script on that same page. So the limits here are not defence in depth —
 * they are the depth.
 */

/**
 * How many sessions one address may mint, and how many turns one conversation
 * may take.
 *
 * Chosen from what a person does, not from what a server survives: someone
 * reloading a page a few times is normal, a page minting ten sessions a minute
 * is not; a fast typer manages maybe fifteen turns a minute, and a real
 * conversation runs perhaps forty turns before it is a phone call instead.
 */
export const LIMITS = {
  /** New conversations per IP. */
  session: { limit: 10, windowSeconds: 60 },
  /** Turns per conversation, short window — catches a script hammering one token. */
  turnBurst: { limit: 15, windowSeconds: 60 },
  /** Turns per conversation, long window — catches a slow drip that a short window never sees. */
  turnTotal: { limit: 120, windowSeconds: 3600 },
} as const;

/**
 * An address, reduced to something that identifies without storing.
 *
 * An IP is personal data, and a rate-limit table is the last place it should
 * sit in the clear: it is written on every anonymous request and read by
 * nobody. A truncated salted hash keeps buckets distinct while making the
 * table useless to anyone who reads it.
 */
function hashBucket(prefix: string, value: string): string {
  const digest = createHash('sha256').update(`${prefix}:${value}`).digest('base64url');
  return `${prefix}:${digest.slice(0, 22)}`;
}

/**
 * The client's address, as far as the platform will tell us.
 *
 * On Vercel the left-most entry of `x-forwarded-for` is the client; anything
 * to the right was added by a proxy. Missing means we cannot distinguish
 * callers, so everyone shares one bucket — deliberately strict rather than
 * open, because the case only arises off-platform.
 */
export function callerAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

/**
 * Counts one hit against a bucket and says whether to continue.
 *
 * A database that will not answer must not become a way through: if the call
 * fails, the request is refused. That is the opposite of the usual "fail open"
 * instinct, and it is right here — an outage that lets the limit lapse is an
 * outage that bills the customer.
 */
async function take(
  supabase: Supabase,
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('take_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return false;
  return data === true;
}

/** One more widget session from this address? */
export async function allowSession(supabase: Supabase, request: Request): Promise<boolean> {
  return await take(supabase, hashBucket('session', callerAddress(request)), LIMITS.session);
}

/**
 * One more turn in this conversation?
 *
 * Keyed by conversation rather than by address: the token already names the
 * conversation, and a visitor behind a corporate NAT shares an address with
 * everyone else in the building.
 */
export async function allowTurn(supabase: Supabase, conversationId: string): Promise<boolean> {
  // Burst first: it is the cheaper rejection and the one that fires under an
  // actual flood.
  if (!(await take(supabase, `turn:${conversationId}`, LIMITS.turnBurst))) return false;
  return await take(supabase, `turnh:${conversationId}`, LIMITS.turnTotal);
}

/**
 * May this page embed this agent?
 *
 * An empty list means any origin, so every agent configured before this
 * existed keeps working and the restriction is opt-in. A request with no
 * `Origin` header is allowed through when the list is empty and refused when
 * it is not — a browser always sends it on a cross-origin POST, so its absence
 * on a restricted agent is not a browser.
 */
export function originAllowed(allowed: string[] | null, origin: string | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.includes(origin);
}
