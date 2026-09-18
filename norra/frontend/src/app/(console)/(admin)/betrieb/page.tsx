import { createClient } from '@/lib/supabase/server';
import { relativeTime } from '@/lib/format';
import { readInstance, type OpsReport } from '@/lib/ops/n8n';

export const dynamic = 'force-dynamic';

/**
 * Betrieb — was zwischen dem Repository und dem nächsten echten Anruf steht.
 *
 * Zwei Hälften, die verschiedenen Leuten gehören:
 *
 * 1. **Diese Organisation** sieht jeder Admin seines Mandanten. Leitungen,
 *    gescheiterte Anrufe, gescheiterte Tool-Aufrufe — alles über RLS auf die
 *    eigene Organisation beschränkt.
 * 2. **Die Instanz** sieht nur der Betreiber. Die n8n-Instanz ist über alle
 *    Mandanten hinweg dieselbe; wessen Workflows dort liegen, geht einen Kunden
 *    nichts an. Die Grenze ist `NORRA_OPS_ORG_ID`, und sie ist geschlossen,
 *    solange die Variable fehlt.
 */

const HOURS_24 = 24 * 60 * 60 * 1000;

function InstanceSection({ report }: { report: OpsReport }) {
  if (report.kind === 'forbidden') return null;

  if (report.kind === 'unconfigured') {
    return (
      <div className="card">
        <div className="card-head">
          <h3>Die Instanz</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Der Blick auf n8n ist nicht eingerichtet.
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <p className="small" style={{ margin: 0 }}>
            Es fehlen:{' '}
            {report.missing.map((name, index) => (
              <span key={name}>
                {index > 0 ? ', ' : ''}
                <code>{name}</code>
              </span>
            ))}
            .
          </p>
          <p className="tiny muted" style={{ margin: 0 }}>
            <code>NORRA_OPS_ORG_ID</code> ist die Organisation des Betreibers. Ohne sie zeigt diese
            Karte nichts — nicht aus Vorsicht, sondern weil die Instanz allen Mandanten gemeinsam
            gehört und ein Kunde die Workflows der anderen nicht sehen soll. Ein API-Key allein wäre
            genau die Abkürzung, die das aufhebt.
          </p>
        </div>
      </div>
    );
  }

  if (report.kind === 'unreachable') {
    return (
      <div className="card">
        <div className="card-head"><h3>Die Instanz</h3></div>
        <div className="card-body">
          <p className="notice" style={{ margin: 0 }}>
            Die Instanz antwortet nicht: {report.reason}. Solange das so ist, sagt diese Seite nichts
            darüber aus, was dort liegt — eine leere Liste hieße „alles fehlt&ldquo;, und das stimmt dann
            gerade nicht.
          </p>
        </div>
      </div>
    );
  }

  const blockers = report.findings.filter((finding) => finding.level === 'block');
  const notes = report.findings.filter((finding) => finding.level === 'note');
  const present = report.workflows.filter((workflow) => workflow.present).length;

  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="metric-label">Workflows</div>
          <div className="metric-value">{present} / {report.workflows.length}</div>
          <div className="metric-note">auf der Instanz / im Repository</div>
        </div>
        <div className="metric">
          <div className="metric-label">Blockierend</div>
          <div className="metric-value">{blockers.length}</div>
          <div className="metric-note">{blockers.length === 0 ? 'nichts steht im Weg' : 'steht dem nächsten Anruf im Weg'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Fehlläufe</div>
          <div className="metric-value">{report.failedRuns.length}</div>
          <div className="metric-note">zuletzt gescheiterte Ausführungen</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Die Instanz</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            <code className="tiny">{report.baseUrl}</code>
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          {blockers.length === 0 ? (
            <p className="notice notice-ok" style={{ margin: 0 }}>
              Nichts blockiert. Die Instanz kann einen Anruf annehmen.
            </p>
          ) : (
            <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
              {blockers.map((finding) => (
                <li key={finding.text} className="small">{finding.text}</li>
              ))}
            </ul>
          )}
          {notes.map((finding) => (
            <p key={finding.text} className="tiny muted" style={{ margin: 0 }}>{finding.text}</p>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Workflow</th><th>Datei</th><th>Auslöser</th><th>Stand</th><th>Zuletzt geändert</th></tr>
            </thead>
            <tbody>
              {report.workflows.map((workflow) => (
                <tr key={workflow.name}>
                  <td style={{ fontWeight: 550 }}>{workflow.name}</td>
                  <td className="tiny muted mono">{workflow.file}</td>
                  <td className="small dim">{workflow.trigger}</td>
                  <td>
                    {!workflow.present ? (
                      <span className="badge badge-danger">fehlt</span>
                    ) : workflow.active ? (
                      <span className="badge badge-ok">aktiv</span>
                    ) : workflow.trigger === 'sub' ? (
                      <span className="badge">wird aufgerufen</span>
                    ) : (
                      <span className="badge badge-danger">inaktiv</span>
                    )}
                  </td>
                  <td className="small muted">{workflow.updatedAt ? relativeTime(workflow.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default async function OperationsPage() {
  const supabase = await createClient();
  const since = new Date(Date.now() - HOURS_24).toISOString();

  const [orgResult, numbersResult, callsResult, toolErrorsResult, wrapupResult] = await Promise.all([
    supabase.from('organizations').select('id, name').single(),
    supabase
      .from('phone_numbers')
      .select('id, e164, label, status, agent_id, last_call_at, agent:agents(name)')
      .order('e164'),
    supabase
      .from('calls')
      .select('id, phone_number_id, status, ended_reason, started_at, duration_seconds')
      .gte('started_at', since),
    supabase
      .from('tool_calls_log')
      .select('id, tool_name, error, created_at, duration_ms')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('calls')
      .select('id, started_at, wrapup_status')
      .eq('wrapup_status', 'failed')
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  const numbers = numbersResult.data ?? [];
  const calls = callsResult.data ?? [];
  const toolErrors = toolErrorsResult.data ?? [];
  const failedWrapups = wrapupResult.data ?? [];

  // `failed` und `no_answer` sind zwei verschiedene Dinge: das eine ist ein
  // Fehler, das andere ein Mensch, der nicht abgenommen hat. Sie zusammen zu
  // zählen würde eine gesunde Leitung wie eine kaputte aussehen lassen.
  const failedCalls = calls.filter((call) => call.status === 'failed').length;
  const callsPerNumber = new Map<string, number>();
  for (const call of calls) {
    if (!call.phone_number_id) continue;
    callsPerNumber.set(call.phone_number_id, (callsPerNumber.get(call.phone_number_id) ?? 0) + 1);
  }

  const report = await readInstance(orgResult.data?.id ?? '');

  return (
    <div className="stack">
      <header className="topbar">
        <h1>Betrieb</h1>
        <p className="muted small">
          Was zwischen dem Repository und dem nächsten echten Anruf steht. Dieselben Befunde, die
          <code> node scripts/preflight.mjs</code> auf der Kommandozeile nennt — hier für alle, die
          gerade kein Terminal offen haben.
        </p>
      </header>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label">Anrufe (24 h)</div>
          <div className="metric-value">{calls.length}</div>
          <div className="metric-note">über {numbers.length} Leitung(en)</div>
        </div>
        <div className="metric">
          <div className="metric-label">Gescheiterte Anrufe</div>
          <div className="metric-value">{failedCalls}</div>
          <div className="metric-note">Status <code>failed</code>, nicht „keiner abgenommen&ldquo;</div>
        </div>
        <div className="metric">
          <div className="metric-label">Tool-Fehler</div>
          <div className="metric-value">{toolErrors.length}</div>
          <div className="metric-note">jüngste zuerst, höchstens acht</div>
        </div>
        <div className="metric">
          <div className="metric-label">Nachbereitung offen</div>
          <div className="metric-value">{failedWrapups.length}</div>
          <div className="metric-note">Gespräche ohne Zusammenfassung</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Leitungen</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Eine Nummer ohne Agent klingelt und sagt nichts — deshalb steht das hier und nicht nur
            im Screen <em>Telefon</em>.
          </div>
        </div>
        {numbers.length === 0 ? (
          <div className="card-body"><p className="muted" style={{ margin: 0 }}>Noch keine Nummer eingerichtet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nummer</th><th>Agent</th><th>Stand</th><th>Anrufe (24 h)</th><th>Letzter Anruf</th></tr>
              </thead>
              <tbody>
                {numbers.map((number) => (
                  <tr key={number.id}>
                    <td>
                      <code>{number.e164}</code>
                      {number.label ? <div className="tiny muted">{number.label}</div> : null}
                    </td>
                    <td className="small dim">
                      {number.agent?.name ?? <span className="badge badge-warn">kein Agent</span>}
                    </td>
                    <td>
                      <span className={number.status === 'active' ? 'badge badge-ok' : 'badge badge-warn'}>
                        {number.status}
                      </span>
                    </td>
                    <td className="num small">{callsPerNumber.get(number.id) ?? 0}</td>
                    <td className="small muted">{number.last_call_at ? relativeTime(number.last_call_at) : 'noch keiner'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Gescheiterte Tool-Aufrufe</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Aus <code>tool_calls_log</code>, das die Sub-Workflows selbst schreiben. Ein Tool, das
            still scheitert, sieht im Gespräch aus wie ein Agent, der die Frage nicht verstanden hat.
          </div>
        </div>
        <div className="card-body">
          {toolErrors.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Kein Tool-Aufruf ist zuletzt gescheitert.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Tool</th><th>Fehler</th><th>Dauer</th><th>Wann</th></tr></thead>
                <tbody>
                  {toolErrors.map((entry) => (
                    <tr key={entry.id}>
                      <td><code>{entry.tool_name}</code></td>
                      <td className="small dim">{entry.error ?? '—'}</td>
                      <td className="num small">{entry.duration_ms ? `${entry.duration_ms} ms` : '—'}</td>
                      <td className="small muted">{relativeTime(entry.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <InstanceSection report={report} />
    </div>
  );
}
