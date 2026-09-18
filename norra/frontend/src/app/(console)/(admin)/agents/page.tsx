import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { statusTone } from '@/lib/format';
import { NewAgentForm } from './new-agent-form';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const supabase = await createClient();
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, name, slug, status, model, channels, description')
    .order('created_at');

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Agenten</h1>
          <div className="small muted">System-Prompt, Guardrails und Tools — als Daten, nicht als Workflow</div>
        </div>
      </header>

      <div className="content stack">
        {error ? <p className="error">{error.message}</p> : null}

        <div className="card card-body-flush">
          {agents && agents.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Agent</th><th>Status</th><th>Modell</th><th>Kanäle</th></tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <Link href={`/agents/${agent.id}`} style={{ fontWeight: 550 }}>{agent.name}</Link>
                        <div className="tiny muted">{agent.description ?? agent.slug}</div>
                      </td>
                      <td><span className={statusTone(agent.status)}>{agent.status}</span></td>
                      <td><code className="small">{agent.model}</code></td>
                      <td className="small dim">{agent.channels.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch kein Agent angelegt.</p>
          )}
        </div>

        <NewAgentForm />
      </div>
    </>
  );
}
