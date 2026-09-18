'use client';

import { useActionState } from 'react';
import { saveSettings, type SettingsFormState } from './actions';

const initial: SettingsFormState = { error: null };

type Organization = {
  name: string;
  display_name: string | null;
  industry: string | null;
  about: string | null;
  hours_note: string | null;
  escalation_email: string | null;
  timezone: string;
  locale: string;
};

/** Vorschläge, keine Vorschrift — das Feld ist Freitext. */
const INDUSTRIES = [
  'Gastronomie', 'Bäckerei', 'Kfz-Werkstatt', 'Arztpraxis', 'Zahnarztpraxis',
  'Handwerk', 'Einzelhandel', 'Versandhandel', 'Rechtsanwaltskanzlei',
  'Steuerberatung', 'Immobilien', 'Fitnessstudio', 'Friseur', 'Hotel',
];

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
          <h2>Über das Unternehmen</h2>
          <div className="small muted" style={{ marginTop: 3 }}>
            Was jeder Agent über euch sagen darf. Einmal hier gepflegt statt in jedem System-Prompt
            einzeln — sonst steht der Firmenname beim dritten Agenten in drei Fassungen im Fließtext.
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="form-grid">
            <label>
              Wie der Agent euch nennt
              <input
                name="displayName"
                defaultValue={organization.display_name ?? ''}
                maxLength={200}
                placeholder={organization.name}
                disabled={!editable}
              />
              <span className="field-hint">
                Oft nicht der Kontoname: „Müller GmbH&ldquo; im Konto, „Bäckerei Müller&ldquo; am Telefon.
              </span>
            </label>
            <label>
              Branche
              <input
                name="industry"
                defaultValue={organization.industry ?? ''}
                list="industries"
                maxLength={120}
                disabled={!editable}
              />
              <datalist id="industries">
                {INDUSTRIES.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
              <span className="field-hint">Bestimmt, welche Vorlage beim nächsten Agenten vorgeschlagen wird.</span>
            </label>
          </div>
          <label>
            In einem Satz
            <textarea
              name="about"
              rows={2}
              defaultValue={organization.about ?? ''}
              maxLength={600}
              placeholder="Handwerksbäckerei mit drei Filialen in Leipzig, seit 1954."
              disabled={!editable}
            />
            <span className="field-hint">
              Die Antwort auf „was macht ihr eigentlich?&ldquo; — kein Ersatz für die Wissensbasis.
            </span>
          </label>
          <label>
            Öffnungszeiten zum Vorlesen
            <input
              name="hoursNote"
              defaultValue={organization.hours_note ?? ''}
              maxLength={400}
              placeholder="Mo–Fr 6–18 Uhr, Sa 6–12 Uhr, So geschlossen."
              disabled={!editable}
            />
            <span className="field-hint">
              Der gesprochene Satz. Wann die Leitung tatsächlich abnimmt, steht je Nummer im Screen
              <em> Telefon</em> — eine Zeitmatrix lässt sich nicht in einen schönen Satz zurückverwandeln.
            </span>
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
