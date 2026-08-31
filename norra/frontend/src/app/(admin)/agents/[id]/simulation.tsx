'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AgentTestCaseRow, AgentTestRunRow } from '@/types/database';

type Result = { caseId: string; name: string; status: string; failures: string[] };

export function Simulation({
  agentId,
  cases,
  lastRuns,
}: {
  agentId: string;
  cases: AgentTestCaseRow[];
  lastRuns: Record<string, AgentTestRunRow>;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Simulation fehlgeschlagen');
      setResults(payload.results ?? []);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unerwarteter Fehler');
    } finally {
      setRunning(false);
    }
  }

  function toneFor(status: string | undefined): string {
    if (status === 'passed') return 'badge badge-ok';
    if (status === 'failed') return 'badge badge-danger';
    if (status === 'error') return 'badge badge-warn';
    return 'badge';
  }

  const summary = results
    ? `${results.filter((r) => r.status === 'passed').length} von ${results.length} bestanden`
    : null;

  return (
    <div className="card">
      <div className="card-head spread">
        <div>
          <h3>Vor dem Start testen</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Läuft gegen den echten Workflow, nicht gegen eine Attrappe.
          </div>
        </div>
        <button type="button" onClick={run} disabled={running || cases.length === 0} className="btn-sm">
          {running ? <span className="spinner" aria-hidden="true" /> : null}
          {running ? 'Läuft…' : 'Testlauf starten'}
        </button>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {cases.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Noch keine Testfälle. Ohne sie geht der Agent ungeprüft live.
          </p>
        ) : (
          <>
            {summary ? (
              <p className={results?.every((r) => r.status === 'passed') ? 'notice notice-ok' : 'notice'}>{summary}</p>
            ) : null}
            {error ? <p className="error">{error}</p> : null}

            <div className="table-wrap">
              <table>
                <thead><tr><th>Testfall</th><th>Erwartung</th><th>Ergebnis</th></tr></thead>
                <tbody>
                  {cases.map((testCase) => {
                    const live = results?.find((r) => r.caseId === testCase.id);
                    const previous = lastRuns[testCase.id];
                    const status = live?.status ?? previous?.status;
                    const failures = live?.failures ?? previous?.failures ?? [];
                    return (
                      <tr key={testCase.id} className={running && !live ? 'is-refreshing' : undefined}>
                        <td>
                          <div style={{ fontWeight: 550 }}>{testCase.name}</div>
                          <div className="tiny muted">{testCase.input}</div>
                        </td>
                        <td className="tiny dim">
                          {testCase.expect_contains.length > 0 ? (
                            <div>enthält: {testCase.expect_contains.join(', ')}</div>
                          ) : null}
                          {testCase.expect_absent.length > 0 ? (
                            <div>nie: {testCase.expect_absent.join(', ')}</div>
                          ) : null}
                        </td>
                        <td>
                          <span className={toneFor(status)}>{status ?? 'nie gelaufen'}</span>
                          {failures.length > 0 ? (
                            <div className="tiny error" style={{ marginTop: 4 }}>{failures.join(' · ')}</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
