import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio webhook plumbing: signature validation and TwiML.
 *
 * No SDK. The two things we need from it -- an HMAC and some XML -- are a dozen
 * lines each, and a telephony SDK in the request path of every call turn is a
 * dependency we would have to keep patched for no gain.
 */

/**
 * Rebuilds the URL Twilio signed.
 *
 * It must match byte for byte what Twilio requested, and behind a proxy
 * `request.url` is the internal one. The public base is therefore configuration
 * rather than something we infer from headers -- a spoofable `X-Forwarded-Host`
 * would let a caller pick the string their forged signature was built over.
 */
export function signedUrl(publicBaseUrl: string, request: Request): string {
  const incoming = new URL(request.url);
  const base = new URL(publicBaseUrl);
  base.pathname = incoming.pathname;
  base.search = incoming.search;
  return base.toString();
}

/**
 * Validates `X-Twilio-Signature` over the request URL and form body.
 *
 * The scheme: HMAC-SHA1 of the URL followed by every POST parameter, sorted by
 * name, key and value concatenated with no separator.
 */
export function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): boolean {
  if (!args.signature) return false;

  let payload = args.url;
  for (const key of Object.keys(args.params).sort()) {
    payload += key + args.params[key];
  }

  const expected = createHmac('sha1', args.authToken).update(Buffer.from(payload, 'utf8')).digest();

  let received: Buffer;
  try {
    received = Buffer.from(args.signature, 'base64');
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through the exception path.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Reads a Twilio form post into a plain record, which is what signing needs. */
export async function readTwilioForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}

/** XML text escaping. Everything below builds TwiML through this, never around it. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export type SayOptions = { voice: string; language: string };

export function say(text: string, options: SayOptions): string {
  if (!text.trim()) return '';
  return `<Say voice="${xml(options.voice)}" language="${xml(options.language)}">${xml(text)}</Say>`;
}

/**
 * Asks the caller to speak and posts the transcript to `action`.
 *
 * `speechTimeout="auto"` lets Twilio decide the caller has stopped rather than
 * cutting them off after a fixed pause -- the difference between a natural
 * conversation and one that talks over people.
 */
export function gather(args: {
  action: string;
  language: string;
  prompt?: string;
  voice: string;
  hints?: string;
}): string {
  const inner = args.prompt ? say(args.prompt, { voice: args.voice, language: args.language }) : '';
  const hints = args.hints ? ` hints="${xml(args.hints)}"` : '';
  return (
    `<Gather input="speech" action="${xml(args.action)}" method="POST"` +
    ` language="${xml(args.language)}" speechTimeout="auto" speechModel="phone_call"${hints}>` +
    `${inner}</Gather>`
  );
}

export function dial(number: string, callerId?: string): string {
  const attrs = callerId ? ` callerId="${xml(callerId)}"` : '';
  return `<Dial${attrs}>${xml(number)}</Dial>`;
}

export function hangup(): string {
  return '<Hangup/>';
}

export function reject(reason: 'rejected' | 'busy' = 'rejected'): string {
  return `<Reject reason="${reason}"/>`;
}

export function record(args: { action: string; maxLength: number }): string {
  return (
    `<Record action="${xml(args.action)}" method="POST" maxLength="${args.maxLength}"` +
    ` playBeep="true" trim="trim-silence"/>`
  );
}

export function redirect(url: string): string {
  return `<Redirect method="POST">${xml(url)}</Redirect>`;
}
