'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { currentActor, recordAudit } from '@/lib/audit';
import { findTemplate } from './templates';

export type AgentFormState = { error: string | null; ok?: string };

/** Comma or newline separated free text into a clean list. */
function toList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Tools that need a per-organization endpoint before they do anything. */
const TOOLS_WITH_ENDPOINT = new Set(['lookup_record']);

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
  // One per line, as typed. Normalised here rather than in the database so the
  // person who typed a trailing slash gets told, instead of a constraint firing
  // on something they cannot see.
  const allowedOrigins = String(formData.get('allowedOrigins') ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowedOrigins.length > 20) {
    return { error: 'Höchstens 20 Domains.' };
  }
  const badOrigin = allowedOrigins.find((origin) => !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin));
  if (badOrigin) {
    return { error: `„${badOrigin}” ist keine Domain in der Form https://kunde.de — ohne Pfad, ohne Schrägstrich am Ende.` };
  }

  const channels = formData.getAll('channels').filter((c): c is string => typeof c === 'string');
  if (channels.length === 0) {
    return { error: 'Mindestens ein Kanal muss aktiv sein — sonst nimmt der Agent nirgends Kontakt an.' };
  }

  // `lookup_record` calls a customer endpoint; without one the sub-workflow has
  // nothing to hit, so refuse to store a tool that cannot work. https only —
  // the request carries customer identifiers.
  const toolRows: Array<{ slug: string; enabled: true; config: Record<string, string> }> = [];
  for (const slug of enabledTools) {
    const config: Record<string, string> = {};
    if (TOOLS_WITH_ENDPOINT.has(slug)) {
      const raw = formData.get(`toolUrl:${slug}`);
      const url = typeof raw === 'string' ? raw.trim() : '';
      if (!url) return { error: `${slug}: Endpunkt fehlt.` };
      if (!/^https:\/\//.test(url)) return { error: `${slug}: Endpunkt muss mit https:// beginnen.` };
      config.url = url;
    }
    toolRows.push({ slug, enabled: true, config });
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };

  // Read the current values first: the trail records what changed, not the row.
  const { data: before } = await supabase
    .from('agents')
    .select('name, status, model, temperature, max_tokens, system_prompt, channels, allowed_origins')
    .eq('id', parsed.data.id)
    .single();

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
      tools: toolRows,
      channels,
      allowed_origins: allowedOrigins,
      escalation_rules: {
        on_keywords: toList(formData.get('escalationKeywords')),
        on_low_confidence: formData.get('escalateOnLowConfidence') === 'on',
      },
    })
    .eq('id', parsed.data.id);

  if (error) return { error: error.message };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before) {
    const next: Record<string, unknown> = {
      name: parsed.data.name, status: parsed.data.status, model: parsed.data.model,
      temperature: parsed.data.temperature, max_tokens: parsed.data.maxTokens,
      system_prompt: parsed.data.systemPrompt,
    };
    for (const [key, value] of Object.entries(next)) {
      const previous = (before as Record<string, unknown>)[key];
      if (previous !== value) changes[key] = { from: previous, to: value };
    }
    const previousChannels = (before.channels ?? []).slice().sort().join(',');
    const nextChannels = channels.slice().sort().join(',');
    if (previousChannels !== nextChannels) changes.channels = { from: before.channels, to: channels };
    // Worth an audit entry on its own: widening this is what lets a stranger's
    // site embed the agent, and narrowing it is what breaks a customer's page.
    const previousOrigins = (before.allowed_origins ?? []).slice().sort().join(',');
    const nextOrigins = allowedOrigins.slice().sort().join(',');
    if (previousOrigins !== nextOrigins) {
      changes.allowed_origins = { from: before.allowed_origins, to: allowedOrigins };
    }
  }

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'agent',
    entityId: parsed.data.id,
    entityLabel: parsed.data.name,
    changes: { ...changes, tools: enabledTools },
  });

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

  const template = findTemplate(formData.get('template') as string | null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single();
  if (!profile) return { error: 'Kein Profil gefunden.' };

  const { data: created, error } = await supabase
    .from('agents')
    .insert({
      organization_id: profile.organization_id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      created_by: user.id,
      system_prompt: template.systemPrompt,
      guardrails: {
        forbidden_topics: template.forbiddenTopics,
        refusal_message: template.refusalMessage || null,
      },
      tools: template.tools.map((slug) => ({ slug, enabled: true, config: {} })),
      escalation_rules: { on_low_confidence: template.escalateOnLowConfidence },
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: profile.organization_id,
    actorId: user.id,
    actorLabel: user.email ?? user.id,
    action: 'create',
    entityType: 'agent',
    entityId: created?.id ?? null,
    entityLabel: parsed.data.name,
    changes: { slug: parsed.data.slug, template: template.id },
  });

  revalidatePath('/agents');
  return { error: null, ok: 'Agent angelegt.' };
}
