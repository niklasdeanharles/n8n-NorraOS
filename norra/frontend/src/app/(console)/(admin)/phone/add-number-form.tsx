'use client';

import { useActionState } from 'react';
import { addPhoneNumber, type PhoneFormState } from './actions';

const initial: PhoneFormState = { error: null };

/**
 * Die Nummer, unter der der Assistent abnimmt.
 *
 * Der Agent steht bewusst schon hier und nicht erst auf der Detailseite: eine
 * Nummer ohne Agenten klingelt und sagt nichts, und genau dieser Zustand
 * entstand bisher zwischen zwei Formularen. Er bleibt möglich — das Feld ist
 * optional, weil „Nummer da, Agent noch nicht fertig" ein echter Ablauf ist —
 * aber er ist nicht mehr der Weg des geringsten Widerstands.
 *
 * Was hier **nicht** passiert: live schalten. Der Status bleibt auf
 * „nicht eingerichtet", bis die beiden URLs beim Anbieter eingetragen sind.
 * Eine Leitung, die schon abnimmt, während der Anbieter noch nirgendwohin
 * zeigt, sieht für den Betreiber fertig aus und ist es nicht.
 */
export function AddNumberForm({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(addPhoneNumber, initial);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nummer anlegen</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Die Nummer, die deine Kunden wählen — und wer darauf abnimmt.
        </div>
      </div>
      <form action={action} className="card-body stack" style={{ gap: 14 }}>
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}
        <div className="form-grid">
          <label>
            Rufnummer
            <input name="e164" placeholder="+49 30 1234567" inputMode="tel" required />
            <span className="field-hint">Mit Landesvorwahl. 0049 und Leerzeichen werden umgeschrieben.</span>
          </label>
          <label>
            Assistent
            <select name="agentId" defaultValue={agents[0]?.id ?? ''}>
              <option value="">— später zuweisen —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {agents.length === 0
                ? 'Noch kein Agent angelegt — erst unter Agenten anlegen, dann hier zuweisen.'
                : 'Wer den Anruf annimmt. Ohne Agenten klingelt die Nummer und sagt nichts.'}
            </span>
          </label>
          <label>
            Bezeichnung
            <input name="label" placeholder="Zentrale" maxLength={120} />
            <span className="field-hint">Nur für euch, taucht beim Anrufer nie auf.</span>
          </label>
        </div>
        <div>
          <button type="submit" disabled={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : null}
            {pending ? 'Legt an…' : 'Anlegen'}
          </button>
        </div>
      </form>
    </div>
  );
}
