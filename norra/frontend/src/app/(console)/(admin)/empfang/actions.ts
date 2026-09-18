'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

export type ReceptionFormState = { error: string | null; ok?: string };

const E164 = /^\+[1-9][0-9]{6,14}$/;

function normalizeE164(input: string): string {
  const trimmed = input.trim().replace(/[\s./-]/g, '');
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  if (trimmed.startsWith('0')) return `+49${trimmed.slice(1)}`;
  return trimmed;
}

const staffSchema = z.object({
  name: z.string().trim().min(1, 'Ohne Namen findet der Agent die Person nicht.').max(200),
  role: z.string().trim().max(120).optional(),
  extension: z.string().trim().regex(/^[0-9]{0,8}$/, 'Die Durchwahl besteht nur aus Ziffern.').optional(),
  email: z.string().trim().max(320).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function addStaffMember(
  _prev: ReceptionFormState,
  formData: FormData,
): Promise<ReceptionFormState> {
  const parsed = staffSchema.safeParse({
    name: formData.get('name'),
    role: formData.get('role') ?? undefined,
    extension: formData.get('extension') ?? undefined,
    email: formData.get('email') ?? undefined,
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const rawNumber = String(formData.get('e164') ?? '').trim();
  const e164 = rawNumber ? normalizeE164(rawNumber) : null;
  if (e164 && !E164.test(e164)) {
    return { error: `„${rawNumber}” ist keine Rufnummer. Format: +4930123456789.` };
  }

  const email = parsed.data.email || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) {
    return { error: `„${email}” ist keine E-Mail-Adresse.` };
  }

  const acceptsTransfers = formData.get('acceptsTransfers') === 'on';
  const acceptsMessages = formData.get('acceptsMessages') === 'on';

  // Dieselben zwei Regeln wie in der Datenbank, hier nur mit einem Satz statt
  // einem Constraint-Namen. Die Datenbank bleibt die Instanz, die entscheidet.
  if (acceptsTransfers && !e164) {
    return { error: 'Durchstellen ohne Rufnummer ist ein Versprechen, das beim ersten Anruf bricht. Nummer eintragen oder den Haken entfernen.' };
  }
  if (acceptsMessages && !email && !e164) {
    return { error: 'Ohne E-Mail und ohne Rufnummer bliebe jede Nachricht liegen, und niemand wüsste davon.' };
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') {
    return { error: 'Nur Admins pflegen das Verzeichnis — wer hier einträgt, entscheidet, wohin Anrufe gehen.' };
  }

  const { data: created, error } = await supabase
    .from('staff_members')
    .insert({
      organization_id: actor.organizationId,
      name: parsed.data.name,
      role: parsed.data.role || null,
      e164,
      extension: parsed.data.extension || null,
      email,
      note: parsed.data.note || null,
      accepts_transfers: acceptsTransfers,
      accepts_messages: acceptsMessages,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    const duplicate = error.code === '23505';
    return {
      error: duplicate
        ? `Die Durchwahl ${parsed.data.extension} ist schon vergeben. Zwei Menschen unter einer Nummer wäre ein Anruf, der beim Falschen landet.`
        : error.message,
    };
  }

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'create',
    entityType: 'staff_member',
    entityId: created.id,
    entityLabel: parsed.data.name,
    changes: { e164, accepts_transfers: acceptsTransfers, accepts_messages: acceptsMessages },
  });

  revalidatePath('/empfang');
  return { error: null, ok: `${parsed.data.name} steht jetzt im Verzeichnis.` };
}

export async function setStaffActive(
  _prev: ReceptionFormState,
  formData: FormData,
): Promise<ReceptionFormState> {
  const id = String(formData.get('id') ?? '');
  const active = formData.get('active') === 'true';
  if (!id) return { error: 'Eintrag fehlt.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins pflegen das Verzeichnis.' };

  const { error } = await supabase.from('staff_members').update({ active }).eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/empfang');
  return { error: null, ok: active ? 'Wieder im Verzeichnis.' : 'Aus dem Verzeichnis genommen.' };
}

export async function markMessageHandled(
  _prev: ReceptionFormState,
  formData: FormData,
): Promise<ReceptionFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Nachricht fehlt.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };

  // `handled_at` ist nicht Beiwerk: der Check-Constraint verlangt beides
  // zusammen, damit es keine erledigte Nachricht ohne Zeitpunkt gibt.
  const { error } = await supabase
    .from('messages_for_staff')
    .update({ status: 'erledigt', handled_at: new Date().toISOString(), handled_by: actor.id })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/empfang');
  return { error: null, ok: 'Abgehakt.' };
}
