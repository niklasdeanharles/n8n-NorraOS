'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();

export type HandoffState = { error: string | null; ok?: string };

/**
 * A human takes the conversation over. Assigning the caller is what makes the
 * takeover visible to everyone else through Realtime; the status change alone
 * would not say who owns it.
 */
export async function takeOver(_prev: HandoffState, formData: FormData): Promise<HandoffState> {
  const parsed = idSchema.safeParse(formData.get('conversationId'));
  if (!parsed.success) return { error: 'Ungültige Konversation.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const { error } = await supabase
    .from('conversations')
    .update({ assigned_user_id: user.id, status: 'escalated' })
    .eq('id', parsed.data);

  if (error) return { error: error.message };
  revalidatePath(`/conversations/${parsed.data}`);
  return { error: null, ok: 'Du bearbeitest diese Konversation jetzt.' };
}

/** Hands the conversation back to the agent. */
export async function releaseToAgent(_prev: HandoffState, formData: FormData): Promise<HandoffState> {
  const parsed = idSchema.safeParse(formData.get('conversationId'));
  if (!parsed.success) return { error: 'Ungültige Konversation.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('conversations')
    .update({ assigned_user_id: null, status: 'open' })
    .eq('id', parsed.data);

  if (error) return { error: error.message };
  revalidatePath(`/conversations/${parsed.data}`);
  return { error: null, ok: 'Zurück an den Agenten übergeben.' };
}

export async function resolveConversation(_prev: HandoffState, formData: FormData): Promise<HandoffState> {
  const parsed = idSchema.safeParse(formData.get('conversationId'));
  if (!parsed.success) return { error: 'Ungültige Konversation.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('conversations')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', parsed.data);

  if (error) return { error: error.message };
  revalidatePath(`/conversations/${parsed.data}`);
  return { error: null, ok: 'Als gelöst markiert.' };
}

const replySchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(10_000),
});

/**
 * A human reply. It is written straight to `messages` and never reaches n8n --
 * once a person has taken over, the agent must not answer over the top of them.
 */
export async function sendHumanReply(_prev: HandoffState, formData: FormData): Promise<HandoffState> {
  const parsed = replySchema.safeParse({
    conversationId: formData.get('conversationId'),
    message: formData.get('message'),
  });
  if (!parsed.success) return { error: 'Nachricht fehlt oder ist zu lang.' };

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, organization_id')
    .eq('id', parsed.data.conversationId)
    .single();

  if (!conversation) return { error: 'Konversation nicht gefunden.' };

  const { error } = await supabase.from('messages').insert({
    organization_id: conversation.organization_id,
    conversation_id: conversation.id,
    role: 'assistant',
    content: parsed.data.message,
    content_json: { authored_by: 'human' },
  });

  if (error) return { error: error.message };
  revalidatePath(`/conversations/${conversation.id}`);
  return { error: null };
}
