'use client';

import { useActionState } from 'react';
import { createAgent, type AgentFormState } from './actions';

const initial: AgentFormState = { error: null };

export function NewAgentForm() {
  const [state, action, pending] = useActionState(createAgent, initial);

  return (
    <div className="card">
      <div className="card-head"><h3>Neuen Agenten anlegen</h3></div>
      <form action={action} className="card-body stack">
        <div className="form-grid">
          <label>
            Name
            <input name="name" placeholder="Support Bot" required maxLength={200} />
          </label>
          <label>
            Slug
            <input name="slug" placeholder="support-bot" required pattern="[a-z0-9][a-z0-9\-]*" />
            <span className="field-hint">Kleinbuchstaben, Ziffern, Bindestriche</span>
          </label>
        </div>
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}
        <div><button type="submit" disabled={pending}>{pending ? 'Legt an…' : 'Anlegen'}</button></div>
      </form>
    </div>
  );
}
