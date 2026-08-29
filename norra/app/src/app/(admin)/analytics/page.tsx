import { createClient } from '@/lib/supabase/server';
import { percent } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

function BarList({ rows, warn = false }: { rows: Array<{ label: string; count: number }>; warn?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} className="bar-row">
          <div>
            <div className="spread" style={{ marginBottom: 4 }}>
              <code className="small">{row.label}</code>
            </div>
            <div className="bar-track">
              <div className={warn ? 'bar-fill bar-fill-warn' : 'bar-fill'} style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </div>
          <span className="num small muted" style={{ textAlign: 'right' }}>{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const [conversationsResult, toolCallsResult, ticketsResult, messagesResult] = await Promise.all([
    supabase.from('conversations').select('id, status, channel, created_at, topic, csat, knowledge_gap').gte('created_at', since),
    supabase.from('tool_calls_log').select('tool_name, status').gte('created_at', since),
    supabase.from('tickets').select('id, status, priority').gte('created_at', since),
    supabase.from('messages').select('id, role').gte('created_at', since),
  ]);

  const conversations = conversationsResult.data ?? [];
  const toolCalls = toolCallsResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const messages = messagesResult.data ?? [];

  const total = conversations.length;
  // Deflection: closed out without ever reaching a human. Conversations still
  // open are excluded -- counting them as deflected would flatter the number.
  const settled = conversations.filter((c) => ['resolved', 'closed', 'escalated'].includes(c.status));
  const deflected = settled.filter((c) => c.status !== 'escalated');
  const escalated = conversations.filter((c) => c.status === 'escalated').length;

  const byChannel = Object.entries(
    conversations.reduce<Record<string, number>>((acc, c) => {
      acc[c.channel] = (acc[c.channel] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const byTool = Object.entries(
    toolCalls.reduce<Record<string, number>>((acc, call) => {
      acc[call.tool_name] = (acc[call.tool_name] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const failedTools = toolCalls.filter((c) => c.status === 'error').length;

  // Topic explorer: what customers actually ask about, most common first.
  const byTopic = Object.entries(
    conversations.reduce<Record<string, number>>((acc, c) => {
      if (!c.topic) return acc;
      acc[c.topic] = (acc[c.topic] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Gap detection: topics where the knowledge base came up empty. Ranked by how
  // often it happened, because the most-asked gap is the one worth writing.
  const gapsByTopic = Object.entries(
    conversations.reduce<Record<string, number>>((acc, c) => {
      if (!c.knowledge_gap) return acc;
      const key = c.topic ?? 'ohne Thema';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const gapTotal = conversations.filter((c) => c.knowledge_gap).length;
  const rated = conversations.filter((c) => typeof c.csat === 'number');
  const csatAverage = rated.length === 0
    ? null
    : Math.round((rated.reduce((sum, c) => sum + (c.csat ?? 0), 0) / rated.length) * 10) / 10;
  const assistantMessages = messages.filter((m) => m.role === 'assistant').length;
  const turnsPerConversation = total === 0 ? 0 : Math.round((assistantMessages / total) * 10) / 10;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Analytics</h1>
          <div className="small muted">Letzte {WINDOW_DAYS} Tage</div>
        </div>
      </header>

      <div className="content stack" style={{ gap: 20 }}>
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Konversationen</div>
            <div className="metric-value num">{total}</div>
            <div className="metric-note">{assistantMessages} Agentenantworten</div>
          </div>
          <div className="metric">
            <div className="metric-label">Deflection-Rate</div>
            <div className="metric-value num">{percent(deflected.length, settled.length)}</div>
            <div className="metric-note">{deflected.length} von {settled.length} abgeschlossen ohne Mensch</div>
          </div>
          <div className="metric">
            <div className="metric-label">Eskalationen</div>
            <div className="metric-value num">{escalated}</div>
            <div className="metric-note">{tickets.length} Tickets angelegt</div>
          </div>
          <div className="metric">
            <div className="metric-label">Antworten je Konversation</div>
            <div className="metric-value num">{turnsPerConversation}</div>
            <div className="metric-note">Mittelwert</div>
          </div>
          <div className="metric">
            <div className="metric-label">Tool-Aufrufe</div>
            <div className="metric-value num">{toolCalls.length}</div>
            <div className="metric-note">{failedTools} fehlgeschlagen</div>
          </div>
          <div className="metric">
            <div className="metric-label">CSAT</div>
            <div className="metric-value num">{csatAverage === null ? '—' : `${csatAverage} / 5`}</div>
            <div className="metric-note">{rated.length} Bewertungen</div>
          </div>
          <div className="metric">
            <div className="metric-label">Wissenslücken</div>
            <div className="metric-value num">{gapTotal}</div>
            <div className="metric-note">Fragen ohne Fundstelle</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-head"><h3>Kanäle</h3></div>
            <div className="card-body">
              {byChannel.length > 0 ? <BarList rows={byChannel} /> : <p className="muted small" style={{ margin: 0 }}>Keine Daten im Zeitraum.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Genutzte Tools</h3></div>
            <div className="card-body">
              {byTool.length > 0 ? <BarList rows={byTool} /> : <p className="muted small" style={{ margin: 0 }}>Noch kein Tool aufgerufen.</p>}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3>Themen</h3>
              <div className="small muted" style={{ marginTop: 3 }}>Worüber Kunden tatsächlich sprechen</div>
            </div>
            <div className="card-body">
              {byTopic.length > 0 ? <BarList rows={byTopic} /> : (
                <p className="muted small" style={{ margin: 0 }}>
                  Noch keine Themen erfasst. Der Agent setzt sie am Ende eines Turns.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Lücken in der Wissensbasis</h3>
              <div className="small muted" style={{ marginTop: 3 }}>
                Gefragt, aber nicht beantwortbar — häufigste zuerst
              </div>
            </div>
            <div className="card-body">
              {gapsByTopic.length > 0 ? (
                <>
                  <BarList rows={gapsByTopic} warn />
                  <p className="tiny muted" style={{ margin: '10px 0 0' }}>
                    Jede Zeile ist ein Artikel, der noch fehlt.
                  </p>
                </>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  Keine Lücken im Zeitraum. Die Wissensbasis trägt die Fragen, die gestellt wurden.
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="tiny muted" style={{ margin: 0 }}>
          Die Deflection-Rate zählt nur abgeschlossene Konversationen. Laufende Fälle bleiben außen vor —
          sie als gelöst zu zählen würde die Zahl schönen.
        </p>
      </div>
    </>
  );
}
