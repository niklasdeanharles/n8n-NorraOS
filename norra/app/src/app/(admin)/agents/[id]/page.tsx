import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { statusTone } from '@/lib/format';
import { AgentForm } from './agent-form';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase.from('agents').select('*').eq('id', id).single();
  if (!agent) notFound();

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
      <div className="content" style={{ maxWidth: 820 }}>
        <AgentForm agent={agent} />
      </div>
    </>
  );
}
