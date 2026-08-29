'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { currentActor, recordAudit } from '@/lib/audit';

export type ApprovalState = { error: string | null; ok?: string };

const decisionSchema = z.object({
  approvalId: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Records a decision on a pending approval.
 *
 * The status is written together with the decider and the timestamp because the
 * table's check constraint refuses any other combination — an approval that
 * cannot say who granted it is not worth having.
 */
async function decide(formData: FormData, decision: 'approved' | 'rejected'): Promise<ApprovalState> {
  const parsed = decisionSchema.safeParse({
    approvalId: formData.get('approvalId'),
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) return { error: 'Ungültige Freigabe.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins dürfen freigeben.' };

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, status, summary, tool_name')
    .eq('id', parsed.data.approvalId)
    .single();

  if (!approval) return { error: 'Freigabe nicht gefunden.' };
  if (approval.status !== 'pending') return { error: 'Diese Freigabe wurde bereits entschieden.' };

  const { error } = await supabase
    .from('approvals')
    .update({
      status: decision,
      decided_by: actor.id,
      decided_at: new Date().toISOString(),
      decision_note: parsed.data.note ?? null,
    })
    .eq('id', approval.id)
    .eq('status', 'pending');

  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: decision === 'approved' ? 'approve' : 'reject',
    entityType: 'approval',
    entityId: approval.id,
    entityLabel: approval.summary,
    changes: { tool_name: approval.tool_name, note: parsed.data.note ?? null },
  });

  revalidatePath('/governance');
  return {
    error: null,
    ok: decision === 'approved' ? 'Freigegeben.' : 'Abgelehnt.',
  };
}

export async function approveAction(_prev: ApprovalState, formData: FormData): Promise<ApprovalState> {
  return await decide(formData, 'approved');
}

export async function rejectAction(_prev: ApprovalState, formData: FormData): Promise<ApprovalState> {
  return await decide(formData, 'rejected');
}
