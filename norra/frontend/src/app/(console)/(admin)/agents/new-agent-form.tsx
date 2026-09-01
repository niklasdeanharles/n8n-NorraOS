'use client';

import { useActionState, useState } from 'react';
import { createAgent, type AgentFormState } from './actions';
import { AGENT_TEMPLATES } from './templates';

const initial: AgentFormState = { error: null };

export function NewAgentForm() {
  const [state, action, pending] = useActionState(createAgent, initial);
  const [templateId, setTemplateId] = useState(AGENT_TEMPLATES[1]?.id ?? 'blank');

  return (
    <div className="card">
      <div className="card-head">
        <h3>Neuen Agenten anlegen</h3>
        <div className="small muted" style={{ marginTop: 3 }}>
          Eine Vorlage liefert System-Prompt und Guardrails vorausgefüllt — alles danach frei änderbar.
        </div>
      </div>
      <form action={action} className="card-body stack">
        <div className="stack" style={{ gap: 8 }}>
          {AGENT_TEMPLATES.map((template) => (
            <label
              key={template.id}
              className="tool-row"
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, fontWeight: 400 }}
            >
              <input
                type="radio"
                name="template"
                value={template.id}
                checked={templateId === template.id}
                onChange={() => setTemplateId(template.id)}
                style={{ width: 'auto', marginTop: 3 }}
              />
              <span>
                <strong style={{ fontWeight: 550 }}>{template.label}</strong>
                <span className="field-hint" style={{ display: 'block' }}>{template.description}</span>
              </span>
            </label>
          ))}
        </div>
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
        {templateId !== 'blank' ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            Ersetze <code>[Unternehmen]</code> im System-Prompt, bevor der Agent live geht — Norra kennt euren
            Firmennamen nicht.
          </p>
        ) : null}
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}
        <div><button type="submit" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Legt an…' : 'Anlegen'}
        </button></div>
      </form>
    </div>
  );
}
