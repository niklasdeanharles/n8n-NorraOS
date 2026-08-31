'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import { isToolSlug } from '@/lib/tools';

export type TestCaseFormState = { error: string | null; ok?: string };

/** One assertion per non-empty line. */
function toLines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const addSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name fehlt.').max(200),
  input: z.string().trim().min(1, 'Kundenanfrage fehlt.').max(4000),
});

/**
 * Adds one test case: an input plus what a good answer must and must not
 * contain. This is what makes "vor dem Start testen" self-service — without
 * it, writing a case means a direct database insert.
 */
export async function addTestCase(_prev: TestCaseFormState, formData: FormData): Promise<TestCaseFormState> {
  const parsed = addSchema.safeParse({
    agentId: formData.get('agentId'),
    name: formData.get('name'),
    input: formData.get('input'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const expectContains = toLines(formData.get('expectContains'));
  const expectAbsent = toLines(formData.get('expectAbsent'));

  const rawTool = formData.get('expectTool');
  const expectTool = typeof rawTool === 'string' && rawTool.trim() ? rawTool.trim() : null;
  // A slug outside the catalogue can never appear in `tool_calls_log`, so the
  // case would fail every run for a reason that reads like an agent bug.
  if (expectTool !== null && !isToolSlug(expectTool)) {
    return { error: 'Unbekanntes Tool.' };
  }

  if (expectContains.length === 0 && expectAbsent.length === 0 && expectTool === null) {
    return { error: 'Mindestens eine Erwartung angeben — sonst prüft der Testfall nichts.' };
  }

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins legen Testfälle an.' };

  const { data: created, error } = await supabase
    .from('agent_test_cases')
    .insert({
      organization_id: actor.organizationId,
      agent_id: parsed.data.agentId,
      name: parsed.data.name,
      input: parsed.data.input,
      expect_contains: expectContains,
      expect_absent: expectAbsent,
      expect_tool: expectTool,
      created_by: actor.id,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'create',
    entityType: 'agent_test_case',
    entityId: created?.id ?? null,
    entityLabel: parsed.data.name,
  });

  revalidatePath(`/agents/${parsed.data.agentId}`);
  return { error: null, ok: 'Testfall angelegt.' };
}

const deleteSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
});

export async function deleteTestCase(_prev: TestCaseFormState, formData: FormData): Promise<TestCaseFormState> {
  const parsed = deleteSchema.safeParse({ id: formData.get('id'), agentId: formData.get('agentId') });
  if (!parsed.success) return { error: 'Eingabe ungültig.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins entfernen Testfälle.' };

  const { data: before } = await supabase.from('agent_test_cases').select('name').eq('id', parsed.data.id).single();
  const { error } = await supabase.from('agent_test_cases').delete().eq('id', parsed.data.id);
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'delete',
    entityType: 'agent_test_case',
    entityId: parsed.data.id,
    entityLabel: before?.name ?? parsed.data.id,
  });

  revalidatePath(`/agents/${parsed.data.agentId}`);
  return { error: null, ok: 'Testfall entfernt.' };
}
