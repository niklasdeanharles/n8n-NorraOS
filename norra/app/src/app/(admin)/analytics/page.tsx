import { createClient } from '@/lib/supabase/server';
import { percent } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

function BarList({ rows, warn = false }: { rows: Array<{ label: string; count: number }>; warn?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      {rows.map((row, index) => (
        // `--i` staggers the grow-in so the list reads top to bottom rather
        // than snapping into place all at once.
        <div key={row.label} className="bar-row" style={{ '--i': index } as React.CSSProperties}>
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

/**
 * Volume over the window as an SVG area chart. No charting library: the shape
 * is a polyline over a fixed viewBox, and the browser scales it. The line draws
 * itself in via stroke-dasharray, which is the only way to animate a path
 * without JavaScript.
 */
function TrendChart({ days }: { days: Array<{ date: string; total: number; escalated: number }> }) {
  const width = 720;
  const height = 150;
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = days.length > 1 ? width / (days.length - 1) : width;

  const pointsFor = (pick: (d: (typeof days)[number]) => number) =>
    days.map((day, i) => `${(i * step).toFixed(1)},${(height - (pick(day) / max) * (height - 12)).toFixed(1)}`);

  const line = pointsFor((d) => d.total).join(' ');
  const escalationLine = pointsFor((d) => d.escalated).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Konversationen pro Tag, Maximum ${max}`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0" x2={width}
            y1={height * fraction} y2={height * fraction}
            stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon className="chart-area" points={area} fill="url(#trend-fill)" />
        <polyline className="chart-line" points={line} fill="none" stroke="hsl(var(--chart-1))" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline
          className="chart-line chart-line-alt"
          points={escalationLine}
          fill="none" stroke="hsl(var(--chart-3))" strokeWidth="2" strokeDasharray="4 4"
          strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-legend">
        <span className="tiny muted">{first}</span>
        <span className="tiny"><i className="legend-swatch" /> Konversationen <i className="legend-swatch legend-swatch-alt" /> Eskalationen</span>
        <span className="tiny muted">{last}</span>
      </div>
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
  // Bucket the window by day, zero-filled: a day without traffic is a real
  // reading, and dropping it would compress the x axis silently.
  const dayKeys = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    new Date(Date.now() - (WINDOW_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  const perDay = new Map(dayKeys.map((date) => [date, { date, total: 0, escalated: 0 }]));
  for (const c of conversations) {
    const bucket = perDay.get(c.created_at.slice(0, 10));
    if (!bucket) continue;
    bucket.total += 1;
    if (c.status === 'escalated') bucket.escalated += 1;
  }
  const days = [...perDay.values()];

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

        <div className="card">
          <div className="card-head spread">
            <h3>Verlauf</h3>
            <span className="small muted">Konversationen und Eskalationen pro Tag</span>
          </div>
          <div className="card-body">
            {total > 0 ? <TrendChart days={days} /> : <p className="muted small" style={{ margin: 0 }}>Keine Daten im Zeitraum.</p>}
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
