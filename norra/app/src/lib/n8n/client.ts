import { serverEnv } from '@/lib/env';

/** Webhook paths on the n8n instance. Must match the workflow JSON in norra/n8n-workflows. */
export const N8N_WEBHOOKS = {
  agentTurn: 'webhook/norra/agent-turn',
  kbIngest: 'webhook/norra/kb-ingest',
} as const;

export type N8nWebhook = (typeof N8N_WEBHOOKS)[keyof typeof N8N_WEBHOOKS];

/**
 * Calls an n8n webhook with the shared Header-Auth secret.
 *
 * Returns the raw Response so streaming callers can hand the body straight to
 * the browser without buffering it.
 */
export async function callN8nWebhook(
  path: N8nWebhook,
  payload: unknown,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  const { N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET } = serverEnv();
  const url = new URL(path, N8N_WEBHOOK_URL.endsWith('/') ? N8N_WEBHOOK_URL : `${N8N_WEBHOOK_URL}/`);

  return await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Matches the Header Auth credential on the n8n webhook node.
      'x-norra-secret': N8N_WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
    signal: init?.signal,
    // Never let a CDN or the fetch cache sit in front of an agent turn.
    cache: 'no-store',
  });
}
