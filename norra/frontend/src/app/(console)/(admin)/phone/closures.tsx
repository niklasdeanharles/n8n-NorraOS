'use client';

import { useActionState } from 'react';
import { addClosure, removeClosure, type PhoneFormState } from './actions';

const initial: PhoneFormState = { error: null };

type Closure = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  message: string | null;
};

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function formatRange(closure: Closure): string {
  return closure.starts_on === closure.ends_on
    ? formatDay(closure.starts_on)
    : `${formatDay(closure.starts_on)} – ${formatDay(closure.ends_on)}`;
}

/**
 * Tage, an denen niemand da ist.
 *
 * Bewusst ohne mitgelieferte Feiertagsliste: Feiertage sind pro Bundesland
 * verschieden, und Betriebsferien stehen in keinem Kalender. Eine Liste, die
 * für die Hälfte der Kunden falsch ist, ohne dass sie es merken, wäre
 * schlechter als ein leeres Formular.
 */
export function Closures({ closures, canEdit }: { closures: Closure[]; canEdit: boolean }) {
  const [addState, add, adding] = useActionState(addClosure, initial);
  const [removeState, remove, removing] = useActionState(removeClosure, initial);
  const feedback = addState.error ?? removeState.error ?? addState.ok ?? removeState.ok ?? null;
  const isError = Boolean(addState.error ?? removeState.error);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Schließtage</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Feiertage und Betriebsferien. Sie stehen über den Öffnungszeiten — ein Assistent, der am ersten
          Weihnachtstag „wir sind für Sie da“ sagt, weil Donnerstag im Kalender steht, schickt jemanden vor
          eine verschlossene Tür.
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        {closures.length > 0 ? (
          <div className="stack" style={{ gap: 9 }}>
            {closures.map((closure) => {
              const past = closure.ends_on < today;
              return (
                <div key={closure.id} className="tool-row">
                  <div className="spread">
                    <div className="grow">
                      <strong style={past ? { opacity: 0.6 } : undefined}>{closure.label}</strong>{' '}
                      <span className="num small muted">{formatRange(closure)}</span>
                      {past ? <span className="badge">vorbei</span> : null}
                      {closure.message ? (
                        <div className="field-hint">„{closure.message}“</div>
                      ) : (
                        <div className="field-hint">
                          Ohne eigene Ansage — es gilt, was je Nummer für außerhalb der Zeiten eingestellt ist.
                        </div>
                      )}
                    </div>
                    {canEdit ? (
                      <form action={remove}>
                        <input type="hidden" name="id" value={closure.id} />
                        <button type="submit" className="btn-secondary btn-sm" disabled={removing}>
                          Entfernen
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="field-hint">
            Noch kein Schließtag. Die Leitungen richten sich dann allein nach den Öffnungszeiten — auch an
            Feiertagen.
          </p>
        )}

        {canEdit ? (
          <form action={add} className="stack" style={{ gap: 12 }}>
            <div className="form-grid">
              <label>
                Anlass
                <input name="label" required maxLength={120} placeholder="Betriebsferien" />
                <span className="field-hint">Nur für euch, der Anrufer hört ihn nicht</span>
              </label>
              <label>
                Von
                <input name="starts_on" type="date" required />
              </label>
              <label>
                Bis einschließlich
                <input name="ends_on" type="date" required />
                <span className="field-hint">Für einen einzelnen Tag beide gleich setzen</span>
              </label>
            </div>
            <label>
              Ansage (optional)
              <input
                name="message"
                maxLength={500}
                placeholder="Wir haben Betriebsferien bis zum sechsten Januar."
              />
              <span className="field-hint">
                Wird zuerst gesprochen. Leer lassen heißt: es bleibt bei der normalen Feierabend-Ansage.
              </span>
            </label>
            <div className="row">
              <button type="submit" disabled={adding}>
                {adding ? <span className="spinner" /> : null}
                Schließtag eintragen
              </button>
              {feedback ? <span className={isError ? 'error' : 'small muted'}>{feedback}</span> : null}
            </div>
          </form>
        ) : (
          <p className="field-hint">Nur Admins können Schließtage ändern.</p>
        )}
      </div>
    </div>
  );
}
