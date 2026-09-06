'use client';

import { useActionState, useState } from 'react';
import { saveAgent, type AgentFormState } from '../actions';
import { CopyField } from '@/components/copy-field';
import { TOOL_CATALOGUE, type ToolChannel } from '@/lib/tools';
import type { AgentRow } from '@/types/database';

const initial: AgentFormState = { error: null };

/** Mirrors `conversation_channel` in the schema — an agent's channels are meant to line up with it. */
const CHANNELS = [
  { value: 'web', label: 'Web-Chat', hint: 'Einbettbares Widget für die eigene Website' },
  { value: 'voice', label: 'Telefon', hint: 'Nummer im Screen „Telefon” zuweisen' },
  { value: 'email', label: 'E-Mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'api', label: 'API' },
] as const;


type Guardrails = { allowed_topics?: string[]; forbidden_topics?: string[]; refusal_message?: string | null };
type EscalationRules = { on_keywords?: string[]; on_low_confidence?: boolean };

function asObject<T>(value: unknown): T {
  return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as T;
}

export function AgentForm({ agent, publicUrl }: { agent: AgentRow; publicUrl: string | null }) {
  const [state, action, pending] = useActionState(saveAgent, initial);
  const [channels, setChannels] = useState<string[]>(agent.channels);

  const guardrails = asObject<Guardrails>(agent.guardrails);
  const escalation = asObject<EscalationRules>(agent.escalation_rules);
  // The stored shape is [{ slug, enabled, config }] — the same rows agent-turn
  // reads per turn. Keep slug -> config here so the form can round-trip it.
  const configured = new Map<string, { url?: string }>();
  for (const entry of Array.isArray(agent.tools) ? agent.tools : []) {
    const tool = asObject<{ slug?: unknown; enabled?: unknown; config?: unknown }>(entry);
    if (typeof tool.slug !== 'string' || tool.enabled === false) continue;
    configured.set(tool.slug, asObject<{ url?: string }>(tool.config));
  }


  /**
   * One channel's worth of tool rows. Split into two cards rather than one
   * list, because "läuft nur am Telefon" is not a detail you want to read past.
   */
  function renderTools(channel: ToolChannel) {
    return TOOL_CATALOGUE.filter((tool) => tool.channel === channel).map((tool) => (
      <div key={tool.slug} className="tool-row">
        <label style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, fontWeight: 400 }}>
          <input
            type="checkbox"
            name="tools"
            value={tool.slug}
            defaultChecked={configured.has(tool.slug)}
            style={{ width: 'auto', marginTop: 3 }}
          />
          <span>
            <code style={{ fontWeight: 550 }}>{tool.slug}</code>
            <span className="field-hint" style={{ display: 'block' }}>{tool.hint}</span>
          </span>
        </label>
        {tool.endpoint ? (
          <label style={{ marginLeft: 26 }}>
            <input
              name={`toolUrl:${tool.slug}`}
              type="url"
              placeholder="https://api.example.com/records"
              defaultValue={configured.get(tool.slug)?.url ?? ''}
            />
            <span className="field-hint">{tool.endpoint}</span>
          </label>
        ) : null}
      </div>
    ));
  }

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
        <div className="card-head">
          <h3>Kanäle</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Wo dieser Agent Kontakt annimmt. Mindestens einer muss aktiv sein.
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {CHANNELS.map((channel) => (
            <label key={channel.value} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, fontWeight: 400 }}>
              <input
                type="checkbox"
                name="channels"
                value={channel.value}
                checked={channels.includes(channel.value)}
                onChange={(event) =>
                  setChannels((current) =>
                    event.target.checked ? [...current, channel.value] : current.filter((c) => c !== channel.value),
                  )
                }
                style={{ width: 'auto', marginTop: 3 }}
              />
              <span>
                {channel.label}
                {'hint' in channel && channel.hint ? (
                  <span className="field-hint" style={{ display: 'block' }}>{channel.hint}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </div>

      {channels.includes('web') ? (
        <div className="card">
          <div className="card-head">
            <h3>Erlaubte Domains</h3>
            <div className="small muted" style={{ marginTop: 3 }}>
              Welche Websites diesen Agenten einbetten dürfen. Leer heißt jede — dann kann auch eine
              fremde Seite ihn unter ihrem Namen antworten lassen.
            </div>
          </div>
          <div className="card-body">
            <label>
              Eine Domain pro Zeile
              <textarea
                name="allowedOrigins"
                rows={3}
                defaultValue={(agent.allowed_origins ?? []).join('\n')}
                placeholder={'https://kunde.de\nhttps://shop.kunde.de'}
                spellCheck={false}
              />
              <span className="field-hint">
                Nur Schema und Host, wie der Browser sie sendet — ohne Pfad und ohne Schrägstrich am
                Ende. Höchstens 20 Einträge.
              </span>
            </label>
          </div>
        </div>
      ) : null}

      {channels.includes('web') ? (
        <div className="card">
          <div className="card-head">
            <h3>Einbetten</h3>
            <div className="small muted" style={{ marginTop: 3 }}>
              Eine Zeile für die eigene Website. Funktioniert erst, sobald der Agent live ist.
            </div>
          </div>
          <div className="card-body">
            {publicUrl ? (
              <>
                <CopyField
                  value={`<script src="${publicUrl}/api/widget/embed" data-agent="${agent.id}" async></script>`}
                />
                {agent.status !== 'live' ? (
                  <p className="tiny muted" style={{ margin: '8px 0 0' }}>
                    Der Code funktioniert erst, wenn der Status oben auf „Live” steht.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="notice">
                <code>NORRA_PUBLIC_URL</code> ist auf dieser Instanz nicht gesetzt — ohne die öffentliche
                Basis-URL kann hier kein fertiger Code stehen.
              </p>
            )}
          </div>
        </div>
      ) : null}

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
          {renderTools('both')}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Tools am Telefon</h3>
          <span className="field-hint">
            Diese vier brauchen einen laufenden Anruf und stehen im Chat nicht zur Verfügung.
          </span>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          {/* Nicht deaktiviert, nur angesagt: ein deaktiviertes Feld wird nicht
              mitgeschickt und würde ein einmal gesetztes Tool beim nächsten
              Speichern stillschweigend wieder entfernen. */}
          {!channels.includes('voice') ? (
            <p className="notice">
              Dieser Agent beantwortet noch keine Anrufe. Du kannst die Tools jetzt setzen — sie
              greifen, sobald du ihm im Screen „Telefon” eine Nummer zuweist.
            </p>
          ) : null}
          {renderTools('voice')}
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
        <button type="submit" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
