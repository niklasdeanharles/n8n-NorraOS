'use client';

import { useActionState } from 'react';
import { saveAgent, type AgentFormState } from '../actions';
import type { AgentRow } from '@/types/database';

const initial: AgentFormState = { error: null };

/** Tool slugs that exist as n8n sub-workflows. Keep in step with norra/n8n-workflows. */
const AVAILABLE_TOOLS = [
  { slug: 'lookup_order', label: 'lookup_order', hint: 'Bestellstatus aus Shopify, read-only' },
  { slug: 'escalate_to_human', label: 'escalate_to_human', hint: 'Ticket anlegen und an einen Menschen übergeben' },
  { slug: 'create_refund', label: 'create_refund', hint: 'Erstattung zur Freigabe einreichen — zahlt nichts aus' },
];

type Guardrails = { allowed_topics?: string[]; forbidden_topics?: string[]; refusal_message?: string | null };
type EscalationRules = { on_keywords?: string[]; on_low_confidence?: boolean };

function asObject<T>(value: unknown): T {
  return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as T;
}

export function AgentForm({ agent }: { agent: AgentRow }) {
  const [state, action, pending] = useActionState(saveAgent, initial);

  const guardrails = asObject<Guardrails>(agent.guardrails);
  const escalation = asObject<EscalationRules>(agent.escalation_rules);
  const enabled = new Set(
    Array.isArray(agent.tools)
      ? agent.tools
          .map((t) => (typeof t === 'object' && t !== null && !Array.isArray(t) ? (t as Record<string, unknown>).slug : null))
          .filter((slug): slug is string => typeof slug === 'string')
      : [],
  );

  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={agent.id} />

      <div className="card">
        <div className="card-head"><h3>Grunddaten</h3></div>
        <div className="card-body form-grid">
          <label>Name<input name="name" defaultValue={agent.name} required maxLength={200} /></label>
          <label>
            Status
            <select name="status" defaultValue={agent.status}>
              <option value="draft">Entwurf</option>
              <option value="live">Live</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          <label>
            Modell
            <input name="model" defaultValue={agent.model} required />
            <span className="field-hint">Modell-ID, die der n8n-Workflow an Anthropic gibt</span>
          </label>
          <label>
            Temperature
            <input name="temperature" type="number" step="0.1" min="0" max="2" defaultValue={agent.temperature} />
          </label>
          <label>
            Max Tokens
            <input name="maxTokens" type="number" min="1" max="200000" defaultValue={agent.max_tokens} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>System-Prompt</h3></div>
        <div className="card-body">
          <label>
            <span className="field-hint">
              Wird pro Turn geladen. Eine Änderung wirkt ab der nächsten Nachricht, ohne Deploy.
            </span>
            <textarea name="systemPrompt" defaultValue={agent.system_prompt} rows={10} maxLength={20000} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Guardrails</h3></div>
        <div className="card-body stack">
          <div className="form-grid">
            <label>
              Erlaubte Themen
              <textarea name="allowedTopics" rows={3} defaultValue={(guardrails.allowed_topics ?? []).join('\n')} />
              <span className="field-hint">Eines pro Zeile. Leer = keine Einschränkung.</span>
            </label>
            <label>
              Verbotene Themen
              <textarea name="forbiddenTopics" rows={3} defaultValue={(guardrails.forbidden_topics ?? []).join('\n')} />
              <span className="field-hint">Eines pro Zeile.</span>
            </label>
          </div>
          <label>
            Ablehn-Nachricht
            <input name="refusalMessage" defaultValue={guardrails.refusal_message ?? ''} maxLength={2000} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Tools</h3></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          {AVAILABLE_TOOLS.map((tool) => (
            <label key={tool.slug} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, fontWeight: 400 }}>
              <input
                type="checkbox"
                name="tools"
                value={tool.slug}
                defaultChecked={enabled.has(tool.slug)}
                style={{ width: 'auto', marginTop: 3 }}
              />
              <span>
                <code style={{ fontWeight: 550 }}>{tool.label}</code>
                <span className="field-hint" style={{ display: 'block' }}>{tool.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Eskalation</h3></div>
        <div className="card-body stack">
          <label>
            Schlüsselwörter
            <textarea name="escalationKeywords" rows={2} defaultValue={(escalation.on_keywords ?? []).join('\n')} />
            <span className="field-hint">Eines pro Zeile, z.B. &bdquo;Anwalt&ldquo;, &bdquo;Beschwerde&ldquo;</span>
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>
            <input
              type="checkbox"
              name="escalateOnLowConfidence"
              defaultChecked={escalation.on_low_confidence === true}
              style={{ width: 'auto' }}
            />
            Bei Unsicherheit an einen Menschen übergeben
          </label>
        </div>
      </div>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}

      <div className="row">
        <button type="submit" disabled={pending}>{pending ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </form>
  );
}
