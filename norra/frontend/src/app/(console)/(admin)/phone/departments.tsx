'use client';

import { useActionState } from 'react';
import { addDepartment, removeDepartment, toggleDepartment, type PhoneFormState } from './actions';

const initial: PhoneFormState = { error: null };

type Department = { id: string; name: string; e164: string; description: string; active: boolean };

/**
 * The list the agent transfers against.
 *
 * The description field carries a hint because it is the part people get wrong:
 * it is read by a model deciding where a caller belongs, not by a colleague who
 * already knows what "Buchhaltung" means.
 */
export function Departments({ departments, canEdit }: { departments: Department[]; canEdit: boolean }) {
  const [addState, add, adding] = useActionState(addDepartment, initial);
  const [removeState, remove, removing] = useActionState(removeDepartment, initial);
  const [toggleState, toggle, toggling] = useActionState(toggleDepartment, initial);
  const feedback =
    addState.error ?? removeState.error ?? toggleState.error ?? addState.ok ?? removeState.ok ?? toggleState.ok ?? null;
  const isError = Boolean(addState.error ?? removeState.error ?? toggleState.error);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Abteilungen</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Wohin der Agent durchstellen darf. Er nennt den Namen — die Nummer schlägt Norra hier nach, damit
          keine erfundene Nummer gewählt werden kann.
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        {departments.length > 0 ? (
          <div className="stack" style={{ gap: 9 }}>
            {departments.map((department) => (
              <div key={department.id} className="tool-row">
                <div className="spread">
                  <div className="grow">
                    <strong style={department.active ? undefined : { opacity: 0.6 }}>{department.name}</strong>{' '}
                    <span className="num small muted">{department.e164}</span>
                    {!department.active ? <span className="badge badge-warn">pausiert</span> : null}
                    <div className="field-hint">{department.description}</div>
                  </div>
                  {canEdit ? (
                    <div className="row" style={{ gap: 7 }}>
                      <form action={toggle}>
                        <input type="hidden" name="id" value={department.id} />
                        <input type="hidden" name="active" value={department.active ? 'false' : 'true'} />
                        <button type="submit" className="btn-secondary btn-sm" disabled={toggling}>
                          {department.active ? 'Pausieren' : 'Aktivieren'}
                        </button>
                      </form>
                      <form action={remove}>
                        <input type="hidden" name="id" value={department.id} />
                        <button type="submit" className="btn-secondary btn-sm" disabled={removing}>
                          Entfernen
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="field-hint">
            Noch keine Abteilung. Ohne Abteilungen nutzt der Agent <code>transfer_to_department</code> nicht —
            er übergibt stattdessen an einen Menschen oder vereinbart einen Rückruf.
          </p>
        )}

        {canEdit ? (
          <form action={add} className="stack" style={{ gap: 12 }}>
            <div className="form-grid">
              <label>
                Name
                <input name="name" required maxLength={80} placeholder="Buchhaltung" />
                <span className="field-hint">So nennt der Agent sie im Gespräch</span>
              </label>
              <label>
                Nummer
                <input name="e164" required placeholder="+493012345678" inputMode="tel" />
                <span className="field-hint">Wohin der Anruf tatsächlich geht</span>
              </label>
            </div>
            <label>
              Wofür zuständig
              <input
                name="description"
                required
                maxLength={500}
                placeholder="Fragen zu Rechnungen, Mahnungen und Zahlungsarten"
              />
              <span className="field-hint">
                Danach entscheidet der Agent. Schreib, worum es geht — nicht, wie die Abteilung heißt.
              </span>
            </label>
            <div className="row">
              <button type="submit" disabled={adding}>
                {adding ? <span className="spinner" /> : null}
                Abteilung anlegen
              </button>
              {feedback ? <span className={isError ? 'error' : 'small muted'}>{feedback}</span> : null}
            </div>
          </form>
        ) : (
          <p className="field-hint">Nur Admins können Abteilungen ändern.</p>
        )}
      </div>
    </div>
  );
}
