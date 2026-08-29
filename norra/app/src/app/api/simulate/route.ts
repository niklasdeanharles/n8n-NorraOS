import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { callN8nWebhook, N8N_WEBHOOKS } from '@/lib/n8n/client';
import { currentActor, recordAudit } from '@/lib/audit';

/**
 * Test before launch.
 *
 * Runs an agent's test cases through the real agent-turn workflow — the same
 * path a customer takes — and checks the answer against each case's
 * assertions. Testing against a mocked agent would prove nothing about the
 * agent that actually ships.
 *
 * The run is throwaway: it uses a scratch conversation that is deleted
 * afterwards, so a simulation never shows up in the operator's inbox or skews
 * the deflection rate.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const requestSchema = z.object({ agentId: z.string().uuid() });

type Assertion = { ok: boolean; failure?: string };

function checkContains(output: string, needles: string[]): Assertion[] {
  return needles.map((needle) =>
    output.toLowerCase().includes(needle.toLowerCase())
      ? { ok: true }
      : { ok: false, failure: `erwartet, aber nicht gefunden: "${needle}"` },
  );
}

function checkAbsent(output: string, needles: string[]): Assertion[] {
  return needles.map((needle) =>
    output.toLowerCase().includes(needle.toLowerCase())
      ? { ok: false, failure: `verboten, aber vorhanden: "${needle}"` }
      : { ok: true },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') {
    return NextResponse.json({ error: 'only admins may run simulations' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name')
    .eq('id', parsed.data.agentId)
    .single();
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  const { data: cases } = await supabase
    .from('agent_test_cases')
    .select('id, name, input, expect_contains, expect_absent, expect_tool')
    .eq('agent_id', agent.id)
    .order('created_at');

  if (!cases || cases.length === 0) {
    return NextResponse.json({ error: 'Für diesen Agenten sind keine Testfälle hinterlegt.' }, { status: 400 });
  }

  const { data: scratch } = await supabase
    .from('conversations')
    .insert({
      organization_id: actor.organizationId,
      agent_id: agent.id,
      channel: 'api',
      title: `Simulation ${new Date().toISOString()}`,
      status: 'closed',
    })
    .select('id')
    .single();

  if (!scratch) return NextResponse.json({ error: 'could not start simulation' }, { status: 500 });

  const results: Array<{ caseId: string; name: string; status: string; failures: string[] }> = [];

  try {
    for (const testCase of cases) {
      const startedAt = Date.now();
      let output = '';
      let status: 'passed' | 'failed' | 'error' = 'failed';
      let failures: string[] = [];

      try {
        const upstream = await callN8nWebhook(N8N_WEBHOOKS.agentTurn, {
          organization_id: actor.organizationId,
          agent_id: agent.id,
          conversation_id: scratch.id,
          message: testCase.input,
          // Each case starts cold: a shared history would let one case's answer
          // decide the next one's.
          history: [],
        });

        if (!upstream.ok) throw new Error(`n8n antwortete ${upstream.status}`);
        output = await upstream.text();

        const assertions = [
          ...checkContains(output, testCase.expect_contains),
          ...checkAbsent(output, testCase.expect_absent),
        ];
        failures = assertions.filter((a) => !a.ok).map((a) => a.failure ?? 'unbekannt');
        status = failures.length === 0 ? 'passed' : 'failed';
      } catch (error) {
        status = 'error';
        failures = [error instanceof Error ? error.message : 'Unerwarteter Fehler'];
      }

      await supabase.from('agent_test_runs').insert({
        organization_id: actor.organizationId,
        agent_id: agent.id,
        test_case_id: testCase.id,
        status,
        output: output.slice(0, 20_000),
        failures,
        duration_ms: Date.now() - startedAt,
      });

      results.push({ caseId: testCase.id, name: testCase.name, status, failures });
    }
  } finally {
    // Messages cascade with the conversation, so the scratch run leaves nothing.
    await supabase.from('conversations').delete().eq('id', scratch.id);
  }

  const passed = results.filter((r) => r.status === 'passed').length;

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'update',
    entityType: 'simulation',
    entityId: agent.id,
    entityLabel: agent.name,
    changes: { passed, total: results.length },
  });

  return NextResponse.json({ passed, total: results.length, results });
}
