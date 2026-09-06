'use client';

import { useActionState } from 'react';
import { saveSettings, type SettingsFormState } from './actions';

const initial: SettingsFormState = { error: null };

type Organization = {
  name: string;
  escalation_email: string | null;
  timezone: string;
  locale: string;
};

const TIMEZONES = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'UTC'];

export function SettingsForm({ organization, editable }: { organization: Organization; editable: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, initial);

  return (
    <form action={action} className="stack" style={{ gap: 16 }}>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? <p className="notice notice-ok">{state.ok}</p> : null}

      <div className="card">
        <div className="card-head">
          <h2>Allgemein</h2>
        </div>
        <div className="card-body form-grid">
          <label>
            Name
            <input name="name" defaultValue={organization.name} maxLength={200} required disabled={!editable} />
          </label>
          <label>
            Zeitzone
            <input
              name="timezone"
              defaultValue={organization.timezone}
              list="timezones"
              disabled={!editable}
            />
            <datalist id="timezones">
              {TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
            <span className="field-hint">Grundlage für Zeitangaben und Öffnungszeiten.</span>
          </label>
          <label>
            Sprache
            <input name="locale" defaultValue={organization.locale} placeholder="de" disabled={!editable} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Eskalation</h2>
          <div className="small muted" style={{ marginTop: 3 }}>
            Wohin die Benachrichtigung geht, wenn ein Agent an einen Menschen übergibt.
          </div>
        </div>
        <div className="card-body">
          <label>
            E-Mail für Eskalationen
            <input
              name="escalationEmail"
              type="email"
              defaultValue={organization.escalation_email ?? ''}
              placeholder="support@example.com"
              disabled={!editable}
            />
            <span className="field-hint">
              Leer lassen heißt: das Ticket wird trotzdem angelegt, es geht nur keine Mail raus. Der Vorgang ist
              das Ticket, die Mail nur der Hinweis darauf.
            </span>
          </label>
        </div>
      </div>

      {editable ? (
        <div>
          <button type="submit" disabled={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : null}
            {pending ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Änderungen an der Organisation sind Admins vorbehalten. Das ist in der Datenbank durchgesetzt, nicht nur
          hier ausgegraut.
        </p>
      )}
    </form>
  );
}
