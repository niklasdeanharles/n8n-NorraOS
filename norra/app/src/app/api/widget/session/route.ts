import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { mintWidgetToken } from '@/lib/widget/token';

/**
 * Starts (or resumes) a widget conversation for one agent.
 *
 * Public and unauthenticated on purpose: a website visitor is not a Supabase
 * user. The only thing that stands in for auth is that this route decides
 * which agent and organization the conversation belongs to — a visitor names
 * an agent id, never an organization id, and every later turn carries only the
 * token this route mints. Nothing downstream ever reads a tenant id from the
 * request body again.
 */
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  agentId: z.string().uuid(),
  // A page reload should resume the same conversation rather than start a
  // fresh one every time; the client persists this and sends it back.
  conversationId: z.string().uuid().optional(),
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
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: agent } = await supabase
    .from('agents')
    .select('id, organization_id, name, status, channels')
    .eq('id', parsed.data.agentId)
    .maybeSingle();

  // Same response whether the agent doesn't exist, isn't live, or isn't on the
  // web channel: an operator debugs this from the console, not from an error
  // message an anonymous visitor could use to enumerate agent ids.
  if (!agent || agent.status !== 'live' || !agent.channels.includes('web')) {
    return NextResponse.json({ error: 'agent not available' }, { status: 404 });
  }

  if (parsed.data.conversationId) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('id', parsed.data.conversationId)
      .eq('agent_id', agent.id)
      .eq('channel', 'web')
      .maybeSingle();

    if (existing && existing.status !== 'closed') {
      return NextResponse.json({
        conversationId: existing.id,
        token: mintWidgetToken(existing.id, agent.organization_id, agent.id),
        agentName: agent.name,
      });
    }
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({ organization_id: agent.organization_id, agent_id: agent.id, channel: 'web' })
    .select('id')
    .single();

  if (error || !conversation) {
    return NextResponse.json({ error: 'could not start conversation' }, { status: 500 });
  }

  return NextResponse.json({
    conversationId: conversation.id,
    token: mintWidgetToken(conversation.id, agent.organization_id, agent.id),
    agentName: agent.name,
  });
}
