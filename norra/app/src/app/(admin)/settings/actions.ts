'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

export type SettingsFormState = { error: string | null; ok?: string };

/**
 * Organization settings.
 *
 * Everything a workflow or a policy reads is a real column with a real
 * constraint. `settings` jsonb keeps only presentation preferences — a blob is
 * where a misspelled key lives forever without anything noticing.
 */
const schema = z.object({
  name: z.string().trim().min(1, 'Name fehlt.').max(200),
  escalationEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-Mail-Adresse ist nicht gültig.'),
  timezone: z.string().trim().min(1, 'Zeitzone fehlt.').max(64),
  locale: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Sprache im Format de oder de-DE angeben.'),
  retentionDays: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), 'Aufbewahrung in ganzen Tagen angeben.')
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || (v >= 7 && v <= 3650), 'Aufbewahrung zwischen 7 und 3650 Tagen.'),
});

export async function saveSettings(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const parsed = schema.safeParse({
    name: formData.get('name'),
    escalationEmail: formData.get('escalationEmail') ?? '',
    timezone: formData.get('timezone'),
    locale: formData.get('locale'),
    retentionDays: formData.get('retentionDays') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  // A timezone the runtime does not know would silently shift every set of
  // business hours by an unpredictable amount.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timezone });
  } catch {
    return { error: `Zeitzone „${parsed.data.timezone}" ist unbekannt. Beispiel: Europe/Berlin.` };
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können die Organisation ändern.' };

  const { data: before } = await supabase
    .from('organizations')
    .select('name, escalation_email, timezone, locale, retention_days')
    .eq('id', actor.organizationId)
    .single();

  const next = {
    name: parsed.data.name,
    escalation_email: parsed.data.escalationEmail || null,
    timezone: parsed.data.timezone,
    locale: parsed.data.locale,
    retention_days: parsed.data.retentionDays,
  };

  const { error } = await supabase.from('organizations').update(next).eq('id', actor.organizationId);
  if (error) return { error: error.message };

  const changes: Record<string, { from: Json; to: Json }> = {};
  if (before) {
    for (const [key, value] of Object.entries(next)) {
      const previous = (before as Record<string, Json>)[key];
      if (previous !== value) changes[key] = { from: previous ?? null, to: value };
    }
  }

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'organization',
    entityId: actor.organizationId,
    entityLabel: parsed.data.name,
    changes,
  });

  revalidatePath('/settings');
  revalidatePath('/team');
  return { error: null, ok: 'Gespeichert.' };
}
