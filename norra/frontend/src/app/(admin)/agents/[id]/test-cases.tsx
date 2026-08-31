'use client';

import { useActionState } from 'react';
import { addTestCase, deleteTestCase, type TestCaseFormState } from './test-case-actions';
import { TOOL_CATALOGUE } from '@/lib/tools';
import type { AgentTestCaseRow } from '@/types/database';

const initial: TestCaseFormState = { error: null };

function DeleteButton({ id, agentId }: { id: string; agentId: string }) {
  const [, action, pending] = useActionState(deleteTestCase, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="agentId" value={agentId} />
      <button type="submit" className="btn-secondary btn-sm" disabled={pending} aria-label="Testfall entfernen">
        {pending ? <span className="spinner" aria-hidden="true" /> : 'Entfernen'}
      </button>
    </form>
  );
}

/**
 * Test cases as data an operator maintains, not rows only reachable from a
 * database console. Without this form, "vor dem Start testen" only works for
 * whoever can write SQL directly against Supabase.
 */
export function TestCases({
  agentId,
  cases,
  enabledTools,
}: {
  agentId: string;
  cases: AgentTestCaseRow[];
  enabledTools: string[];
}) {
  const [state, action, pending] = useActionState(addTestCase, initial);
  // Only tools this agent actually has: expecting one it was never given fails
  // every run and says nothing about the agent.
  const offerable = TOOL_CATALOGUE.filter((tool) => enabledTools.includes(tool.slug));

  return (
    <>
      <div className="card card-body-flush">
        <div className="card-head">
          <h3>Testfälle</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Eine Kundenanfrage plus das, was eine gute Antwort enthalten — oder auf keinen Fall enthalten — darf.
          </div>
        </div>
        {cases.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Testfall</th><th>Erwartung</th><th></th></tr></thead>
              <tbody>
                {cases.map((testCase) => (
                  <tr key={testCase.id}>
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
                      {testCase.expect_tool ? <div>ruft auf: {testCase.expect_tool}</div> : null}
                    </td>
                    <td>
                      <DeleteButton id={testCase.id} agentId={agentId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Noch kein Testfall. Ohne sie geht der Agent ungeprüft live.</p>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Testfall hinzufügen</h3></div>
        <form action={action} className="card-body stack" style={{ gap: 12 }}>
          <input type="hidden" name="agentId" value={agentId} />
          <div className="form-grid">
            <label>
              Name
              <input name="name" placeholder="Erstattung nie zusagen" required maxLength={200} />
            </label>
            <label>
              Kundenanfrage
              <input name="input" placeholder="Ich will mein Geld zurück" required maxLength={4000} />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Muss enthalten
              <textarea name="expectContains" rows={2} placeholder="Ticket" />
              <span className="field-hint">Eine Zeichenfolge pro Zeile.</span>
            </label>
            <label>
              Darf nie enthalten
              <textarea name="expectAbsent" rows={2} placeholder="wurde erstattet" />
              <span className="field-hint">Eine Zeichenfolge pro Zeile.</span>
            </label>
          </div>
          {offerable.length > 0 ? (
            <label>
              Muss dieses Tool aufrufen
              <select name="expectTool" defaultValue="">
                <option value="">— egal —</option>
                {offerable.map((tool) => (
                  <option key={tool.slug} value={tool.slug}>
                    {tool.slug}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Wird gegen das Tool-Protokoll geprüft, nicht gegen den Antworttext — „ich habe ein Ticket
                angelegt” zu schreiben reicht nicht.
              </span>
            </label>
          ) : null}
          {state.error ? <p className="error">{state.error}</p> : null}
          {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}
          <div>
            <button type="submit" disabled={pending} className="btn-secondary btn-sm">
              {pending ? <span className="spinner" aria-hidden="true" /> : null}
              {pending ? 'Legt an…' : 'Hinzufügen'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
