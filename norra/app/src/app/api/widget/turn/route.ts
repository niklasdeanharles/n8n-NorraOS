import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { callN8nWebhook, N8N_WEBHOOKS } from '@/lib/n8n/client';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { mintWidgetToken, verifyWidgetToken } from '@/lib/widget/token';

/**
 * One streamed turn from a website visitor.
 *
 * The counterpart to /api/agent-turn for a caller who cannot have a Supabase
 * session. Authentication is the signed token from /api/widget/session: its
 * payload — not the request body — decides which conversation, agent and
 * organization this turn belongs to. A message could name any id it likes and
 * it would simply be ignored.
 */
export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 20;

/**
 * A hard ceiling on how long a conversation can run, independent of any
 * per-request rate limiting. Vercel's serverless functions have no shared
 * memory to count requests against across invocations, so this is enforced
 * against the one thing that is durable: the row count in `messages`. Edge-
 * level abuse protection (a WAF, Cloudflare) is the operator's own layer, not
 * this route's.
 */
const MAX_MESSAGES_PER_CONVERSATION = 400;

const requestSchema = z.object({
  token: z.string().min(1),
  message: z.string().trim().min(1, 'message must not be empty').max(4000),
});

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid request', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const claims = verifyWidgetToken(parsed.data.token);
  if (!claims) {
    return NextResponse.json({ error: 'session expired' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: agent } = await supabase
    .from('agents')
    .select('id, status, channels')
    .eq('id', claims.a)
    .maybeSingle();
  // Re-checked per turn: an operator can turn the web channel off mid-incident
  // and an in-flight visitor should stop being answered, not keep going on a
  // stale grant.
  if (!agent || agent.status !== 'live' || !agent.channels.includes('web')) {
    return NextResponse.json({ error: 'agent not available' }, { status: 404 });
  }

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', claims.c);
  if ((count ?? 0) >= MAX_MESSAGES_PER_CONVERSATION) {
    return NextResponse.json({ error: 'conversation has reached its message limit' }, { status: 429 });
  }

  const { error: insertError } = await supabase.from('messages').insert({
    organization_id: claims.o,
    conversation_id: claims.c,
    role: 'user',
    content: parsed.data.message,
  });
  if (insertError) {
    return NextResponse.json({ error: 'could not persist message' }, { status: 500 });
  }

  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', claims.c)
    .order('seq', { ascending: false })
    .limit(HISTORY_LIMIT);

  const history = (recentMessages ?? []).reverse();

  let upstream: Response;
  try {
    upstream = await callN8nWebhook(
      N8N_WEBHOOKS.agentTurn,
      {
        organization_id: claims.o,
        agent_id: claims.a,
        conversation_id: claims.c,
        message: parsed.data.message,
        history,
      },
      { signal: request.signal },
    );
  } catch {
    return NextResponse.json({ error: 'agent backend unreachable' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'agent run failed' }, { status: 502 });
  }

  // Slides the expiry on every turn so an active conversation never times out
  // mid-chat; a visitor who leaves and comes back after the TTL simply gets a
  // fresh session from /api/widget/session instead.
  const refreshedToken = mintWidgetToken(claims.c, claims.o, claims.a);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-norra-widget-token': refreshedToken,
      // The embed can run on any customer domain; this route identifies its
      // caller by token, not by origin, so it is safe to open widely.
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-norra-widget-token',
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
