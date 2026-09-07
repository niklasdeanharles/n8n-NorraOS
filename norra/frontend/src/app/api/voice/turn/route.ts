import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { callN8nWebhook, N8N_WEBHOOKS } from '@/lib/n8n/client';
import type { createServiceRoleClient } from '@/lib/supabase/server';
import { callbackUrl, verifyWebhook } from '@/lib/voice/session';
import { dial, gather, hangup, say, twiml } from '@/lib/voice/twilio';

/**
 * One spoken turn.
 *
 * The provider transcribes what the caller said and posts it here; we persist
 * it, run the same agent the chat uses, and speak the answer back. The workflow
 * is a separate one from `agent-turn` for a single reason: a phone call cannot
 * stream. The caller hears nothing until the sentence is complete, so the whole
 * answer has to arrive before we can reply at all.
 */
export const dynamic = 'force-dynamic';

/** How many prior turns the agent gets as context. Shorter than chat: calls are shorter. */
const HISTORY_LIMIT = 12;

/**
 * A provider drops the call if the webhook takes too long. Better to answer
 * something useful at 12s than to have the line go dead at 15.
 */
const AGENT_TIMEOUT_MS = 12_000;

const agentReplySchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  action: z.enum(['continue', 'transfer', 'hangup']).default('continue'),
  /**
   * The department the agent picked, by name.
   *
   * Deliberately not a number. A number reaching this point would have passed
   * through the model's context, where a prepared document or a crafted caller
   * sentence could have replaced it — and the call would go to a stranger on
   * the customer's bill. The name is looked up in `phone_departments` below;
   * one that is not there transfers nowhere.
   */
  transfer_to: z.string().trim().min(1).max(80).nullish(),
});

export async function POST(request: NextRequest): Promise<Response> {
  const verified = await verifyWebhook(request);
  if (!verified.ok) return verified.response;
  const { params, supabase } = verified;

  const callId = new URL(request.url).searchParams.get('call');
  if (!callId) return twiml(hangup());

  const { data: call } = await supabase
    .from('calls')
    .select('id, organization_id, conversation_id, agent_id, started_at, turn_count, phone_number_id')
    .eq('id', callId)
    .maybeSingle();

  if (!call || !call.conversation_id || !call.agent_id) return twiml(hangup());

  const { data: number } = await supabase
    .from('phone_numbers')
    .select('voice, language, transfer_number, max_call_seconds, e164')
    .eq('id', call.phone_number_id ?? '')
    .maybeSingle();

  const voice = { voice: number?.voice ?? 'alice', language: number?.language ?? 'de-DE' };
  const nextAction = callbackUrl('/api/voice/turn', { call: call.id });

  // A loop on a phone line bills by the minute. The ceiling is configuration,
  // and it is enforced here rather than trusted to the model.
  const elapsedSeconds = (Date.now() - new Date(call.started_at).getTime()) / 1000;
  if (elapsedSeconds > (number?.max_call_seconds ?? 600)) {
    await endCall(supabase, call.id, call.conversation_id, 'max_duration');
    return twiml(
      say('Wir sind an der Zeitgrenze für dieses Gespräch. Ein Mitarbeiter meldet sich bei Ihnen.', voice) + hangup(),
    );
  }

  const spoken = (params.SpeechResult ?? '').trim();
  if (!spoken) {
    // Silence is not an error: ask once more, then let the caller go.
    const attempts = Number(new URL(request.url).searchParams.get('silent') ?? '0');
    if (attempts >= 1) {
      await endCall(supabase, call.id, call.conversation_id, 'no_input');
      return twiml(say('Ich konnte Sie leider nicht verstehen. Auf Wiederhören.', voice) + hangup());
    }
    return twiml(
      gather({
        action: callbackUrl('/api/voice/turn', { call: call.id, silent: '1' }),
        language: voice.language,
        voice: voice.voice,
        prompt: 'Entschuldigung, das habe ich nicht verstanden. Können Sie das bitte wiederholen?',
      }) + hangup(),
    );
  }

  await supabase.from('messages').insert({
    organization_id: call.organization_id,
    conversation_id: call.conversation_id,
    role: 'user',
    content: spoken,
  });

  const { data: recent } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', call.conversation_id)
    .order('seq', { ascending: false })
    .limit(HISTORY_LIMIT);

  const history = (recent ?? []).reverse();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  // What the caller actually waits through, measured on our side of the line.
  // The workflow records the same thing for chat; voice persists its own
  // assistant message, so it has to measure its own.
  const startedAt = Date.now();
  let parsed: z.infer<typeof agentReplySchema> | null = null;
  try {
    const upstream = await callN8nWebhook(
      N8N_WEBHOOKS.voiceTurn,
      {
        organization_id: call.organization_id,
        agent_id: call.agent_id,
        conversation_id: call.conversation_id,
        call_id: call.id,
        caller: params.From ?? null,
        message: spoken,
        history,
      },
      { signal: controller.signal },
    );
    if (upstream.ok) {
      const raw: unknown = await upstream.json();
      // n8n returns a single item wrapped in an array.
      const candidate = Array.isArray(raw) ? raw[0] : raw;
      const result = agentReplySchema.safeParse(candidate);
      if (result.success) parsed = result.data;
    }
  } catch {
    parsed = null;
  } finally {
    clearTimeout(timer);
  }

  await supabase
    .from('calls')
    .update({ turn_count: call.turn_count + 1 })
    .eq('id', call.id);

  // The agent did not answer in time or answered with nothing usable. Handing
  // to a human beats apologising in a loop -- if there is a human to hand to.
  if (!parsed) {
    if (number?.transfer_number) {
      await supabase
        .from('calls')
        .update({ status: 'transferred', transferred_to: number.transfer_number, ended_reason: 'agent_unavailable' })
        .eq('id', call.id);
      await supabase.from('conversations').update({ status: 'escalated', escalated_at: new Date().toISOString() })
        .eq('id', call.conversation_id);
      return twiml(
        say('Einen Moment, ich verbinde Sie mit einem Mitarbeiter.', voice) +
          dial(number.transfer_number, number.e164),
      );
    }
    return twiml(
      gather({
        action: nextAction,
        language: voice.language,
        voice: voice.voice,
        prompt: 'Das dauert gerade länger als gewohnt. Können Sie Ihre Frage bitte noch einmal stellen?',
      }) + hangup(),
    );
  }

  await supabase.from('messages').insert({
    organization_id: call.organization_id,
    conversation_id: call.conversation_id,
    role: 'assistant',
    content: parsed.reply,
    latency_ms: Date.now() - startedAt,
  });
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', call.conversation_id);

  if (parsed.action === 'transfer') {
    // The name from the agent buys exactly one thing: a row in this table,
    // scoped to this tenant. No row, no dial — we fall back to the number an
    // admin configured on the line, or to nothing at all.
    let target = number?.transfer_number ?? null;
    let label: string | null = null;
    if (parsed.transfer_to) {
      const { data: department } = await supabase
        .from('phone_departments')
        .select('name, e164')
        .eq('organization_id', call.organization_id)
        .eq('active', true)
        .ilike('name', parsed.transfer_to)
        .maybeSingle();
      if (department) {
        target = department.e164;
        label = department.name;
      }
    }

    if (target) {
      await supabase
        .from('calls')
        .update({
          status: 'transferred',
          transferred_to: target,
          ended_reason: label ? `department:${label}` : 'agent_handoff',
        })
        .eq('id', call.id);
      return twiml(say(parsed.reply, voice) + dial(target, number?.e164 ?? ''));
    }

    // The agent announced a transfer that cannot happen. Saying its line and
    // hanging up would strand the caller mid-promise, so the call continues and
    // the conversation is marked for a human.
    await supabase
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString() })
      .eq('id', call.conversation_id);
    return twiml(
      gather({
        action: nextAction,
        language: voice.language,
        voice: voice.voice,
        prompt:
          'Ich kann Sie im Moment leider nicht weiterverbinden. Ein Mitarbeiter meldet sich bei Ihnen. Kann ich sonst noch etwas für Sie tun?',
      }) + hangup(),
    );
  }

  if (parsed.action === 'hangup') {
    await endCall(supabase, call.id, call.conversation_id, 'agent_closed');
    return twiml(say(parsed.reply, voice) + hangup());
  }

  return twiml(
    gather({ action: nextAction, language: voice.language, voice: voice.voice, prompt: parsed.reply }) +
      say('Falls Sie noch etwas brauchen, rufen Sie uns gerne wieder an. Auf Wiederhören.', voice) +
      hangup(),
  );
}

async function endCall(
  supabase: ReturnType<typeof createServiceRoleClient>,
  callId: string,
  conversationId: string,
  reason: string,
): Promise<void> {
  await supabase.from('calls').update({ ended_reason: reason }).eq('id', callId);
  await supabase.from('conversations').update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', conversationId);
}
