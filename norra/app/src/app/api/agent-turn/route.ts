import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { callN8nWebhook, N8N_WEBHOOKS } from '@/lib/n8n/client';

/**
 * The one proxy between the browser and n8n.
 *
 * It persists the user's message, hands the turn to the n8n agent-turn workflow
 * and pipes the streamed response straight back. It deliberately contains no
 * Claude call and no vector search -- that lives in n8n, where it can be
 * debugged and changed without a deploy.
 *
 * The assistant's reply is written by n8n, not here: buffering the stream just
 * to persist it would defeat the point of streaming, and n8n already has the
 * final text.
 */

// Streaming responses must not be statically rendered or cached.
export const dynamic = 'force-dynamic';

/** How many prior turns to hand the agent as context. */
const HISTORY_LIMIT = 20;

const requestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1, 'message must not be empty').max(10_000),
});

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
  const { conversationId, message } = parsed.data;

  // RLS scopes this to the caller's organization, so an id from another tenant
  // simply returns nothing -- no explicit organization check needed here.
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id, organization_id, agent_id')
    .eq('id', conversationId)
    .single();

  if (conversationError || !conversation) {
    return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
  }
  if (!conversation.agent_id) {
    return NextResponse.json({ error: 'conversation has no agent assigned' }, { status: 409 });
  }

  const { error: insertError } = await supabase.from('messages').insert({
    organization_id: conversation.organization_id,
    conversation_id: conversation.id,
    role: 'user',
    content: message,
  });
  if (insertError) {
    return NextResponse.json({ error: 'could not persist message' }, { status: 500 });
  }

  // Fetched here rather than in n8n on purpose: a fresh conversation has no
  // prior messages, and a Supabase node returning zero rows would stop the
  // workflow before the agent ever ran.
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('seq', { ascending: false })
    .limit(HISTORY_LIMIT);

  const history = (recentMessages ?? []).reverse();

  let upstream: Response;
  try {
    upstream = await callN8nWebhook(
      N8N_WEBHOOKS.agentTurn,
      {
        organization_id: conversation.organization_id,
        agent_id: conversation.agent_id,
        conversation_id: conversation.id,
        message,
        history,
      },
      { signal: request.signal },
    );
  } catch {
    return NextResponse.json({ error: 'agent backend unreachable' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // n8n's error body can carry workflow internals, so it is logged upstream
    // rather than forwarded to the browser.
    return NextResponse.json({ error: 'agent run failed' }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops nginx and similar proxies from buffering the stream into one blob.
      'x-accel-buffering': 'no',
    },
  });
}
