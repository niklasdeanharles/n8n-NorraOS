import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Dashboard shell. Every query below is scoped by RLS to the caller's
 * organization, so none of them filters by organization_id by hand.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [agents, conversations, tickets] = await Promise.all([
    supabase.from('agents').select('id, name, slug, status, model').order('created_at'),
    supabase
      .from('conversations')
      .select('id, channel, status, title, last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(10),
    supabase.from('tickets').select('id, number, subject, status, priority').order('created_at', { ascending: false }).limit(10),
  ]);

  return (
    <main className="stack" style={{ gap: 28 }}>
      <section className="stack">
        <h2 style={{ margin: 0 }}>Agenten</h2>
        <div className="card">
          {agents.error ? <p className="error">{agents.error.message}</p> : null}
          {agents.data?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Modell</th>
                </tr>
              </thead>
              <tbody>
                {agents.data.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.name}</td>
                    <td className="muted">{agent.slug}</td>
                    <td>{agent.status}</td>
                    <td className="muted">{agent.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Noch kein Agent angelegt.</p>
          )}
        </div>
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Letzte Konversationen</h2>
        <div className="card">
          {conversations.error ? <p className="error">{conversations.error.message}</p> : null}
          {conversations.data?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Titel</th>
                  <th>Kanal</th>
                  <th>Status</th>
                  <th>Zuletzt</th>
                </tr>
              </thead>
              <tbody>
                {conversations.data.map((conversation) => (
                  <tr key={conversation.id}>
                    <td>{conversation.title ?? <span className="muted">ohne Titel</span>}</td>
                    <td className="muted">{conversation.channel}</td>
                    <td>{conversation.status}</td>
                    <td className="muted">
                      {conversation.last_message_at
                        ? new Date(conversation.last_message_at).toLocaleString('de-DE')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Noch keine Konversationen.</p>
          )}
        </div>
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Offene Tickets</h2>
        <div className="card">
          {tickets.error ? <p className="error">{tickets.error.message}</p> : null}
          {tickets.data?.length ? (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Betreff</th>
                  <th>Status</th>
                  <th>Priorität</th>
                </tr>
              </thead>
              <tbody>
                {tickets.data.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="muted">{ticket.number}</td>
                    <td>{ticket.subject}</td>
                    <td>{ticket.status}</td>
                    <td>{ticket.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Keine Tickets.</p>
          )}
        </div>
      </section>
    </main>
  );
}
