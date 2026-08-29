'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type AgentFormState = { error: string | null; ok?: string };

/** Comma or newline separated free text into a clean list. */
function toList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name fehlt.').max(200),
  status: z.enum(['draft', 'live', 'archived']),
  model: z.string().trim().min(1, 'Modell fehlt.'),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().int().min(1).max(200_000),
  systemPrompt: z.string().max(20_000),
  refusalMessage: z.string().max(2000),
});

/**
 * Writes the row the n8n agent-turn workflow loads at the start of every turn.
 * There is no deploy step: the next message already uses the new configuration.
 */
export async function saveAgent(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const parsed = agentSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    status: formData.get('status'),
    model: formData.get('model'),
    temperature: formData.get('temperature'),
    maxTokens: formData.get('maxTokens'),
    systemPrompt: formData.get('systemPrompt') ?? '',
    refusalMessage: formData.get('refusalMessage') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };
  }

  const enabledTools = formData.getAll('tools').filter((t): t is string => typeof t === 'string');

  const supabase = await createClient();
  const { error } = await supabase
    .from('agents')
    .update({
      name: parsed.data.name,
      status: parsed.data.status,
      model: parsed.data.model,
      temperature: parsed.data.temperature,
      max_tokens: parsed.data.maxTokens,
      system_prompt: parsed.data.systemPrompt,
      guardrails: {
        allowed_topics: toList(formData.get('allowedTopics')),
        forbidden_topics: toList(formData.get('forbiddenTopics')),
        refusal_message: parsed.data.refusalMessage || null,
      },
      tools: enabledTools.map((slug) => ({ slug, enabled: true })),
      escalation_rules: {
        on_keywords: toList(formData.get('escalationKeywords')),
        on_low_confidence: formData.get('escalateOnLowConfidence') === 'on',
      },
    })
    .eq('id', parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath('/agents');
  revalidatePath(`/agents/${parsed.data.id}`);
  return { error: null, ok: 'Gespeichert. Der nächste Turn nutzt diese Konfiguration.' };
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt.').max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Slug: nur Kleinbuchstaben, Ziffern und Bindestriche.'),
});

export async function createAgent(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const parsed = createSchema.safeParse({ name: formData.get('name'), slug: formData.get('slug') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single();
  if (!profile) return { error: 'Kein Profil gefunden.' };

  const { error } = await supabase.from('agents').insert({
    organization_id: profile.organization_id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    created_by: user.id,
  });

  if (error) return { error: error.message };
  revalidatePath('/agents');
  return { error: null, ok: 'Agent angelegt.' };
}
