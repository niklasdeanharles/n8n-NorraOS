import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditAction, Database, Json } from '@/types/database';

/**
 * Appends one entry to the audit trail.
 *
 * `actorLabel` is denormalised on purpose: the trail has to stay readable after
 * the person who acted is deleted, and a dangling uuid is not an answer to
 * "who changed this".
 *
 * Never throws. A failed audit write must not roll back the change it records —
 * losing the action is worse than losing its log line.
 */
export async function recordAudit(
  supabase: SupabaseClient<Database>,
  entry: {
    organizationId: string;
    actorId: string | null;
    actorLabel: string;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    entityLabel?: string | null;
    changes?: Json;
  },
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    organization_id: entry.organizationId,
    actor_id: entry.actorId,
    actor_label: entry.actorLabel,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    entity_label: entry.entityLabel ?? null,
    changes: entry.changes ?? {},
  });

  if (error) console.error('audit write failed', error.message);
}

/** Resolves the caller's identity once, for both the tenancy scope and the trail. */
export async function currentActor(supabase: SupabaseClient<Database>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id, role, full_name, email')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  return {
    id: user.id,
    organizationId: profile.organization_id,
    role: profile.role,
    label: profile.full_name ?? profile.email,
  };
}
