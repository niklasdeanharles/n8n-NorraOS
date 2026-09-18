'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { currentActor, recordAudit } from '@/lib/audit';

export type TeamState = { error: string | null; ok?: string };

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'agent', 'customer']),
});

/**
 * Changes a member's role.
 *
 * Refuses to demote the last admin: an organization with no admin can no longer
 * approve anything or change its own agents, and nobody left inside can undo it.
 */
export async function changeRole(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const parsed = roleSchema.safeParse({ userId: formData.get('userId'), role: formData.get('role') });
  if (!parsed.success) return { error: 'Ungültige Eingabe.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins dürfen Rollen ändern.' };

  const { data: target } = await supabase
    .from('users')
    .select('id, role, full_name, email')
    .eq('id', parsed.data.userId)
    .single();
  if (!target) return { error: 'Mitglied nicht gefunden.' };
  if (target.role === parsed.data.role) return { error: null };

  if (target.role === 'admin' && parsed.data.role !== 'admin') {
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return { error: 'Das ist der letzte Admin. Ernenne zuerst einen anderen.' };
    }
  }

  const { error } = await supabase.from('users').update({ role: parsed.data.role }).eq('id', target.id);
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'user',
    entityId: target.id,
    entityLabel: target.full_name ?? target.email,
    changes: { role: { from: target.role, to: parsed.data.role } },
  });

  revalidatePath('/team');
  return { error: null, ok: `Rolle geändert auf ${parsed.data.role}.` };
}
