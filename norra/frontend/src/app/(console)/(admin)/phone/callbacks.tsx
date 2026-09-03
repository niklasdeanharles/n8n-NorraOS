'use client';

import { useActionState } from 'react';
import { completeCallback, type PhoneFormState } from './actions';
import { formatDateTime, relativeTime } from '@/lib/format';

const initial: PhoneFormState = { error: null };

type Callback = {
  id: string;
  e164: string;
  reason: string;
  preference: string | null;
  requested_for: string | null;
  created_at: string;
};

/**
 * Callbacks the agent promised on the phone.
 *
 * `preference` is shown in the caller's own words next to the parsed time,
 * because "heute Nachmittag" is what was actually agreed — the timestamp is at
 * best an interpretation of it.
 */
export function Callbacks({ callbacks }: { callbacks: Callback[] }) {
  const [state, complete, pending] = useActionState(completeCallback, initial);

  return (
    <div className="card card-body-flush">
      <div className="card-head spread">
        <div>
          <h2>Offene Rückrufe</h2>
          <div className="small muted" style={{ marginTop: 3 }}>
            Vom Agenten am Telefon zugesagt — hier steht, wer noch wartet
          </div>
        </div>
        <span className={callbacks.length > 0 ? 'badge badge-warn' : 'badge badge-ok'}>
          {callbacks.length} offen
        </span>
      </div>
      {callbacks.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Anliegen</th>
                <th>Wunsch</th>
                <th>Zugesagt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {callbacks.map((callback) => (
                <tr key={callback.id}>
                  <td className="num">{callback.e164}</td>
                  <td className="small">{callback.reason}</td>
                  <td className="small dim">
                    {callback.preference ?? <span className="muted">kein Zeitwunsch</span>}
                    {callback.requested_for ? (
                      <div className="tiny muted">{formatDateTime(callback.requested_for)}</div>
                    ) : null}
                  </td>
                  <td className="small muted">{relativeTime(callback.created_at)}</td>
                  <td>
                    <form action={complete}>
                      <input type="hidden" name="id" value={callback.id} />
                      <button type="submit" className="btn-secondary btn-sm" disabled={pending}>
                        Erledigt
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Keine offenen Rückrufe.</p>
      )}
      {state.error ? <p className="error" style={{ padding: '0 18px 14px' }}>{state.error}</p> : null}
    </div>
  );
}
