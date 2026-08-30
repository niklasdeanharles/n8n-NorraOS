'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import { WEEK } from '@/lib/voice/hours';

export type PhoneFormState = { error: string | null; ok?: string };

const E164 = /^\+[1-9][0-9]{6,14}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Digits, spaces and dashes as people write them, into the one format a carrier accepts. */
function normalizeE164(input: string): string {
  const trimmed = input.trim().replace(/[\s./-]/g, '');
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  return trimmed;
}

const addSchema = z.object({
  e164: z.string().transform(normalizeE164).refine((v) => E164.test(v), 'Nummer im Format +49301234567 angeben.'),
  label: z.string().trim().max(120).optional(),
});

export async function addPhoneNumber(_prev: PhoneFormState, formData: FormData): Promise<PhoneFormState> {
  const parsed = addSchema.safeParse({ e164: formData.get('e164'), label: formData.get('label') ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Nummern anlegen.' };

  const { data: created, error } = await supabase
    .from('phone_numbers')
    .insert({
      organization_id: actor.organizationId,
      e164: parsed.data.e164,
      label: parsed.data.label || null,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    // The unique index is global: a number can only route to one organization.
    if (error.code === '23505') {
      return { error: 'Diese Nummer ist bereits vergeben. Prüfe, ob sie schon angelegt ist.' };
    }
    return { error: error.message };
  }

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'create',
    entityType: 'phone_number',
    entityId: created?.id ?? null,
    entityLabel: parsed.data.e164,
  });

  revalidatePath('/phone');
  return { error: null, ok: 'Nummer angelegt. Jetzt Agent zuweisen und Weiterleitung eintragen.' };
}

const saveSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().max(120),
  agentId: z.string().uuid().or(z.literal('')),
  status: z.enum(['unconfigured', 'active', 'paused']),
  greeting: z.string().max(2000),
  voice: z.string().trim().min(1).max(80),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Sprache im Format de-DE angeben.'),
  transferNumber: z.string().transform(normalizeE164).refine((v) => v === '' || E164.test(v), 'Weiterleitung im Format +49301234567 angeben.'),
  voicemailMessage: z.string().max(2000),
  maxCallSeconds: z.coerce.number().int().min(30).max(3600),
  recordingEnabled: z.boolean(),
  afterHours: z.enum(['agent', 'voicemail', 'transfer', 'reject']),
  timezone: z.string().trim().min(1).max(64),
});

export async function savePhoneNumber(_prev: PhoneFormState, formData: FormData): Promise<PhoneFormState> {
  const parsed = saveSchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label') ?? '',
    agentId: formData.get('agentId') ?? '',
    status: formData.get('status'),
    greeting: formData.get('greeting') ?? '',
    voice: formData.get('voice'),
    language: formData.get('language'),
    transferNumber: formData.get('transferNumber') ?? '',
    voicemailMessage: formData.get('voicemailMessage') ?? '',
    maxCallSeconds: formData.get('maxCallSeconds'),
    recordingEnabled: formData.get('recordingEnabled') === 'on',
    afterHours: formData.get('afterHours'),
    timezone: formData.get('timezone'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };
  const input = parsed.data;

  // The database rejects these too. Catching them here turns a raw constraint
  // error into a sentence that says what to do about it.
  if (input.status === 'active' && !input.agentId) {
    return { error: 'Eine Nummer kann nicht live gehen, ohne dass ein Agent sie beantwortet.' };
  }
  if (input.afterHours === 'transfer' && !input.transferNumber) {
    return { error: 'Weiterleitung außerhalb der Zeiten braucht eine Zielnummer.' };
  }

  const hours: Record<string, Array<[string, string]>> = {};
  for (const day of WEEK) {
    const from = String(formData.get(`hours:${day}:from`) ?? '').trim();
    const to = String(formData.get(`hours:${day}:to`) ?? '').trim();
    if (!from && !to) continue;
    if (!TIME.test(from) || !TIME.test(to)) {
      return { error: `Öffnungszeiten am ${day}: bitte beide Zeiten als HH:MM angeben.` };
    }
    if (from >= to) return { error: `Öffnungszeiten am ${day}: Ende muss nach dem Anfang liegen.` };
    hours[day] = [[from, to]];
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };

  const { data: before } = await supabase
    .from('phone_numbers')
    .select('e164, status, agent_id, after_hours')
    .eq('id', input.id)
    .single();

  const { error } = await supabase
    .from('phone_numbers')
    .update({
      label: input.label || null,
      agent_id: input.agentId || null,
      status: input.status,
      greeting: input.greeting,
      voice: input.voice,
      language: input.language,
      transfer_number: input.transferNumber || null,
      voicemail_message: input.voicemailMessage || null,
      max_call_seconds: input.maxCallSeconds,
      recording_enabled: input.recordingEnabled,
      after_hours: input.afterHours,
      timezone: input.timezone,
      business_hours: hours,
    })
    .eq('id', input.id);

  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'phone_number',
    entityId: input.id,
    entityLabel: before?.e164 ?? input.id,
    changes: {
      status: { from: before?.status ?? null, to: input.status },
      agent_id: { from: before?.agent_id ?? null, to: input.agentId || null },
      after_hours: { from: before?.after_hours ?? null, to: input.afterHours },
    },
  });

  revalidatePath('/phone');
  revalidatePath(`/phone/${input.id}`);
  return { error: null, ok: 'Gespeichert. Der nächste Anruf nutzt diese Einstellungen.' };
}
