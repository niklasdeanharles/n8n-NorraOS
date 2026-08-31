import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { conversationStatusLabel, relativeTime, statusTone } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  // Every query is scoped by RLS to the caller's organization, so none of them
  // filters by organization_id by hand.
  const [agents, conversations, tickets, documents] = await Promise.all([
    supabase.from('agents').select('id, name, status, model').order('created_at'),
    supabase
      .from('conversations')
      .select('id, channel, status, title, last_message_at, assigned_user_id')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(8),
    supabase.from('tickets').select('id, number, subject, status, priority').eq('status', 'open').limit(8),
    supabase.from('knowledge_base_documents').select('id, status, chunk_count'),
  ]);

  const liveAgents = (agents.data ?? []).filter((a) => a.status === 'live').length;
  const openConversations = (conversations.data ?? []).filter((c) => ['open', 'pending', 'escalated'].includes(c.status)).length;
  const chunks = (documents.data ?? []).reduce((sum, d) => sum + d.chunk_count, 0);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Übersicht</h1>
          <div className="small muted">Zustand deiner Agenten und offenen Fälle</div>
        </div>
        <Link href="/conversations" className="btn btn-secondary btn-sm">Zum Posteingang</Link>
      </header>

      <div className="content stack" style={{ gap: 20 }}>
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Agenten live</div>
            <div className="metric-value num">{liveAgents}</div>
            <div className="metric-note">von {(agents.data ?? []).length} angelegt</div>
          </div>
          <div className="metric">
            <div className="metric-label">Offene Konversationen</div>
            <div className="metric-value num">{openConversations}</div>
            <div className="metric-note">in den letzten 8</div>
          </div>
          <div className="metric">
            <div className="metric-label">Offene Tickets</div>
            <div className="metric-value num">{(tickets.data ?? []).length}</div>
            <div className="metric-note">warten auf Bearbeitung</div>
          </div>
          <div className="metric">
            <div className="metric-label">Wissensblöcke</div>
            <div className="metric-value num">{chunks}</div>
            <div className="metric-note">{(documents.data ?? []).length} Dokumente</div>
          </div>
        </div>

        <div className="card card-body-flush">
          <div className="card-head spread">
            <h2>Letzte Konversationen</h2>
            <Link href="/conversations" className="small">Alle ansehen</Link>
          </div>
          {conversations.data && conversations.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Titel</th><th>Kanal</th><th>Status</th><th>Bearbeiter</th><th>Aktivität</th></tr></thead>
                <tbody>
                  {conversations.data.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/conversations/${c.id}`}>{c.title ?? 'Ohne Titel'}</Link></td>
                      <td className="small"><span className="badge">{c.channel}</span></td>
                      <td><span className={statusTone(c.status)}>{conversationStatusLabel(c.status)}</span></td>
                      <td className="small dim">{c.assigned_user_id ? 'Mensch' : 'Agent'}</td>
                      <td className="small muted">{relativeTime(c.last_message_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch keine Konversationen.</p>
          )}
        </div>

        <div className="card card-body-flush">
          <div className="card-head"><h2>Offene Tickets</h2></div>
          {tickets.data && tickets.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Betreff</th><th>Priorität</th></tr></thead>
                <tbody>
                  {tickets.data.map((t) => (
                    <tr key={t.id}>
                      <td className="num muted">{t.number}</td>
                      <td>{t.subject}</td>
                      <td><span className={statusTone(t.priority)}>{t.priority}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Keine offenen Tickets.</p>
          )}
        </div>
      </div>
    </>
  );
}
