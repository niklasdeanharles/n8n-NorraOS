import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { conversationStatusLabel, relativeTime, statusTone } from '@/lib/format';
import type { ConversationStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

const FILTERS: Array<{ key: string; label: string; statuses: ConversationStatus[] | null }> = [
  { key: 'active', label: 'Aktiv', statuses: ['open', 'pending', 'escalated'] },
  { key: 'escalated', label: 'Eskaliert', statuses: ['escalated'] },
  { key: 'resolved', label: 'Gelöst', statuses: ['resolved', 'closed'] },
  { key: 'all', label: 'Alle', statuses: null },
];

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = 'active' } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const supabase = await createClient();
  let query = supabase
    .from('conversations')
    .select('id, channel, status, title, end_user_email, last_message_at, assigned_user_id, agents(name)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (active.statuses) query = query.in('status', active.statuses);
  const { data: conversations, error } = await query;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Posteingang</h1>
          <div className="small muted">Konversationen aller Kanäle, neueste zuerst</div>
        </div>
        <div className="row">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/conversations?filter=${f.key}`}
              className={f.key === active.key ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </header>

      <div className="content stack">
        {error ? <p className="error">{error.message}</p> : null}
        <div className="card card-body-flush">
          {conversations && conversations.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Konversation</th>
                    <th>Agent</th>
                    <th>Kanal</th>
                    <th>Status</th>
                    <th>Bearbeiter</th>
                    <th>Aktivität</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/conversations/${c.id}`} style={{ fontWeight: 550 }}>
                          {c.title ?? 'Ohne Titel'}
                        </Link>
                        <div className="tiny muted">{c.end_user_email ?? 'anonym'}</div>
                      </td>
                      <td className="dim small">{c.agents?.name ?? '—'}</td>
                      <td className="small"><span className="badge">{c.channel}</span></td>
                      <td>
                        <span className={statusTone(c.status)}>
                          <span className="dot" aria-hidden="true" />
                          {conversationStatusLabel(c.status)}
                        </span>
                      </td>
                      <td className="small dim">{c.assigned_user_id ? 'Mensch' : 'Agent'}</td>
                      <td className="small muted">{relativeTime(c.last_message_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Keine Konversationen in diesem Filter.</p>
          )}
        </div>
      </div>
    </>
  );
}
