import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { statusTone } from '@/lib/format';
import { AgentForm } from './agent-form';
import { Simulation } from './simulation';
import { TestCases } from './test-cases';
import { enabledToolSlugs } from '@/lib/tools';
import type { AgentTestRunRow } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase.from('agents').select('*').eq('id', id).single();
  if (!agent) notFound();

  const [casesResult, runsResult] = await Promise.all([
    supabase.from('agent_test_cases').select('*').eq('agent_id', id).order('created_at'),
    supabase.from('agent_test_runs').select('*').eq('agent_id', id).order('created_at', { ascending: false }).limit(100),
  ]);

  // Only the newest run per case: the table shows current state, not history.
  const lastRuns: Record<string, AgentTestRunRow> = {};
  for (const run of runsResult.data ?? []) {
    if (!lastRuns[run.test_case_id]) lastRuns[run.test_case_id] = run;
  }

  return (
    <>
      <header className="topbar">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <Link href="/agents" className="small muted">Agenten</Link>
            <span className="muted">/</span>
            <h1 style={{ fontSize: 17 }}>{agent.name}</h1>
          </div>
          <div className="small muted">Slug <code>{agent.slug}</code></div>
        </div>
        <span className={statusTone(agent.status)}>{agent.status}</span>
      </header>
      <div className="content stack" style={{ maxWidth: 840 }}>
        <AgentForm agent={agent} publicUrl={process.env.NORRA_PUBLIC_URL?.replace(/\/$/, '') ?? null} />
        <TestCases agentId={agent.id} cases={casesResult.data ?? []} enabledTools={enabledToolSlugs(agent.tools)} />
        <Simulation agentId={agent.id} cases={casesResult.data ?? []} lastRuns={lastRuns} />
      </div>
    </>
  );
}
