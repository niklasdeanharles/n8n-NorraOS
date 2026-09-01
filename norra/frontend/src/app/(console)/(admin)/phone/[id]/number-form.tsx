'use client';

import { useActionState, useState } from 'react';
import { savePhoneNumber, type PhoneFormState } from '../actions';
import { DAY_LABELS, parseBusinessHours, WEEK } from '@/lib/voice/hours';
import type { PhoneNumberRow } from '@/types/database';

const initial: PhoneFormState = { error: null };

/**
 * Provider voices. A free-text field would be more flexible and would also let
 * a typo silently fall back to a robot reading German with an English accent.
 */
const VOICES = [
  { value: 'Polly.Vicki-Neural', label: 'Vicki — weiblich, deutsch (neural)' },
  { value: 'Polly.Daniel-Neural', label: 'Daniel — männlich, deutsch (neural)' },
  { value: 'Polly.Hannah-Neural', label: 'Hannah — weiblich, deutsch (neural)' },
  { value: 'Polly.Joanna-Neural', label: 'Joanna — weiblich, englisch (neural)' },
  { value: 'alice', label: 'Alice — Standard, viele Sprachen' },
];

const AFTER_HOURS = [
  { value: 'agent', label: 'Agent nimmt trotzdem ab' },
  { value: 'voicemail', label: 'Nachricht aufnehmen' },
  { value: 'transfer', label: 'An Rufnummer weiterleiten' },
  { value: 'reject', label: 'Anruf abweisen' },
];

export function NumberForm({
  number,
  agents,
}: {
  number: PhoneNumberRow;
  agents: Array<{ id: string; name: string; status: string }>;
}) {
  const [state, action, pending] = useActionState(savePhoneNumber, initial);
  const [afterHours, setAfterHours] = useState(number.after_hours);
  const hours = parseBusinessHours(number.business_hours);

  return (
    <form action={action} className="stack" style={{ gap: 16 }}>
      <input type="hidden" name="id" value={number.id} />
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}

      <div className="card">
        <div className="card-head">
          <h3>Wer abnimmt</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Ohne Agent kann die Nummer nicht live gehen — die Datenbank lässt es nicht zu.
          </div>
        </div>
        <div className="card-body form-grid">
          <label>
            Agent
            <select name="agentId" defaultValue={number.agent_id ?? ''}>
              <option value="">— keiner —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.status === 'live' ? '' : ' (Entwurf)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={number.status}>
              <option value="unconfigured">Nicht eingerichtet</option>
              <option value="active">Live</option>
              <option value="paused">Pausiert</option>
            </select>
          </label>
          <label>
            Bezeichnung
            <input name="label" defaultValue={number.label ?? ''} maxLength={120} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Wie es klingt</h3>
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <label>
            Begrüßung
            <textarea name="greeting" rows={3} defaultValue={number.greeting} maxLength={2000} />
            <span className="field-hint">
              Der erste Satz, den der Anrufer hört. Leer lassen für den Standardtext.
            </span>
          </label>
          <div className="form-grid">
            <label>
              Stimme
              <select name="voice" defaultValue={number.voice}>
                {VOICES.map((voice) => (
                  <option key={voice.value} value={voice.value}>{voice.label}</option>
                ))}
              </select>
            </label>
            <label>
              Sprache
              <input name="language" defaultValue={number.language} placeholder="de-DE" />
              <span className="field-hint">Steuert auch die Spracherkennung des Anrufers.</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Erreichbarkeit</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Alle Zeiten leer = rund um die Uhr erreichbar.
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 8 }}>
            {WEEK.map((day) => {
              const range = hours[day]?.[0];
              return (
                <div key={day} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  <span className="small" style={{ width: 92, flex: 'none' }}>{DAY_LABELS[day]}</span>
                  <input
                    type="time"
                    name={`hours:${day}:from`}
                    defaultValue={range?.[0] ?? ''}
                    style={{ width: 118 }}
                    aria-label={`${DAY_LABELS[day]} von`}
                  />
                  <span className="muted small">bis</span>
                  <input
                    type="time"
                    name={`hours:${day}:to`}
                    defaultValue={range?.[1] ?? ''}
                    style={{ width: 118 }}
                    aria-label={`${DAY_LABELS[day]} bis`}
                  />
                </div>
              );
            })}
          </div>
          <div className="form-grid">
            <label>
              Zeitzone
              <input name="timezone" defaultValue={number.timezone} placeholder="Europe/Berlin" />
            </label>
            <label>
              Außerhalb der Zeiten
              <select
                name="afterHours"
                value={afterHours}
                onChange={(event) => setAfterHours(event.target.value as typeof afterHours)}
              >
                {AFTER_HOURS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {afterHours === 'voicemail' ? (
            <label>
              Ansage vor der Aufnahme
              <textarea name="voicemailMessage" rows={2} defaultValue={number.voicemail_message ?? ''} />
              <span className="field-hint">Die Aufnahme landet als Ticket im Posteingang.</span>
            </label>
          ) : (
            <input type="hidden" name="voicemailMessage" value={number.voicemail_message ?? ''} />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Übergabe und Grenzen</h3>
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="form-grid">
            <label>
              Weiterleitung an
              <input name="transferNumber" defaultValue={number.transfer_number ?? ''} placeholder="+49 30 999888777" />
              <span className="field-hint">
                Ziel für Eskalationen und für den Fall, dass der Agent nicht rechtzeitig antwortet.
              </span>
            </label>
            <label>
              Maximale Gesprächsdauer
              <input
                name="maxCallSeconds"
                type="number"
                min={30}
                max={3600}
                defaultValue={number.max_call_seconds}
              />
              <span className="field-hint">Sekunden. Eine Schleife am Telefon kostet pro Minute.</span>
            </label>
          </div>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 9, fontWeight: 400 }}>
            <input
              type="checkbox"
              name="recordingEnabled"
              defaultChecked={number.recording_enabled}
              style={{ width: 'auto' }}
            />
            <span>
              Gespräche aufzeichnen
              <span className="field-hint" style={{ display: 'block' }}>
                In Deutschland brauchst du dafür die Einwilligung des Anrufers. Die Ansage dafür gehört in die
                Begrüßung.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <button type="submit" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
