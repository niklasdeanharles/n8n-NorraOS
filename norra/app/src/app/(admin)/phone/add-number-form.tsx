'use client';

import { useActionState } from 'react';
import { addPhoneNumber, type PhoneFormState } from './actions';

const initial: PhoneFormState = { error: null };

export function AddNumberForm() {
  const [state, action, pending] = useActionState(addPhoneNumber, initial);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nummer anlegen</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Die Nummer, die deine Kunden wählen. Alles Weitere danach.
        </div>
      </div>
      <form action={action} className="card-body stack" style={{ gap: 14 }}>
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}
        <div className="form-grid">
          <label>
            Rufnummer
            <input name="e164" placeholder="+49 30 1234567" required />
            <span className="field-hint">Mit Landesvorwahl. 0049 und Leerzeichen werden umgeschrieben.</span>
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
