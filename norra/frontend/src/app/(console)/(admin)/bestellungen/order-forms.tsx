'use client';

import { useActionState, useState } from 'react';
import { addOrderSource, removeOrderSource, toggleOrderSource, type OrderFormState } from './actions';

const initial: OrderFormState = { error: null };

type Source = {
  id: string;
  label: string;
  kind: 'google_sheet' | 'http';
  sheet_id: string | null;
  sheet_range: string | null;
  endpoint_url: string | null;
  match_column: string;
  return_columns: string[];
  active: boolean;
};

export function OrderSources({ sources, canEdit }: { sources: Source[]; canEdit: boolean }) {
  const [addState, add, adding] = useActionState(addOrderSource, initial);
  const [toggleState, toggle, toggling] = useActionState(toggleOrderSource, initial);
  const [removeState, remove, removing] = useActionState(removeOrderSource, initial);
  const [kind, setKind] = useState<'google_sheet' | 'http'>('google_sheet');

  const feedback =
    addState.error ?? toggleState.error ?? removeState.error ?? addState.ok ?? toggleState.ok ?? removeState.ok ?? null;
  const isError = Boolean(addState.error ?? toggleState.error ?? removeState.error);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Bestellquellen</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Woher der Agent eine Bestellnummer nachschlägt. Der Anrufer nennt die Nummer, Norra sucht sie
          hier — das Modell bekommt nie die ganze Tabelle zu sehen.
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        {sources.length > 0 ? (
          <div className="stack" style={{ gap: 9 }}>
            {sources.map((source) => (
              <div key={source.id} className="tool-row">
                <div className="spread">
                  <div className="grow">
                    <strong style={source.active ? undefined : { opacity: 0.6 }}>{source.label}</strong>{' '}
                    <span className="badge">{source.kind === 'google_sheet' ? 'Google Sheet' : 'Endpunkt'}</span>
                    {!source.active ? <span className="badge badge-warn">pausiert</span> : null}
                    <div className="field-hint">
                      Sucht in <code>{source.match_column}</code>
                      {source.kind === 'google_sheet' ? (
                        <> · Bereich <code>{source.sheet_range}</code></>
                      ) : (
                        <> · <code className="tiny">{source.endpoint_url}</code></>
                      )}
                    </div>
                    <div className="field-hint">
                      Der Kunde hört: {source.return_columns.map((column) => (
                        <code key={column} className="tiny" style={{ marginRight: 6 }}>{column}</code>
                      ))}
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="row" style={{ gap: 7 }}>
                      <form action={toggle}>
                        <input type="hidden" name="id" value={source.id} />
                        <input type="hidden" name="active" value={source.active ? 'false' : 'true'} />
                        <button type="submit" className="btn-secondary btn-sm" disabled={toggling}>
                          {source.active ? 'Pausieren' : 'Aktivieren'}
                        </button>
                      </form>
                      <form action={remove}>
                        <input type="hidden" name="id" value={source.id} />
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
            Noch keine Quelle. Ohne sie nutzt der Agent <code>lookup_order</code> nicht — er nimmt die
            Bestellnummer stattdessen als Nachricht auf.
          </p>
        )}

        {canEdit ? (
          <form action={add} className="stack" style={{ gap: 12 }}>
            <div className="form-grid">
              <label>
                Name
                <input name="label" required maxLength={120} placeholder="Bestellungen 2026" />
                <span className="field-hint">Nur für euch</span>
              </label>
              <label>
                Art
                <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                  <option value="google_sheet">Google Sheet</option>
                  <option value="http">Eigener Endpunkt</option>
                </select>
              </label>
            </div>

            {kind === 'google_sheet' ? (
              <div className="form-grid">
                <label>
                  Tabellen-ID
                  <input name="sheetId" required maxLength={200} placeholder="1AbCdEfGhIjKlMnOpQrStUv" />
                  <span className="field-hint">Der lange Teil aus der Sheet-URL zwischen /d/ und /edit</span>
                </label>
                <label>
                  Bereich
                  <input name="sheetRange" required maxLength={120} placeholder="Bestellungen!A:H" />
                  <span className="field-hint">Blattname und Spalten, erste Zeile sind die Überschriften</span>
                </label>
              </div>
            ) : (
              <label>
                Endpunkt
                <input name="endpointUrl" required maxLength={500} placeholder="https://api.example.com/orders" />
                <span className="field-hint">
                  Wird mit <code>?query=&lt;Bestellnummer&gt;</code> aufgerufen. Nur https — eine Bestellnummer
                  ist ein Kundendatum. Zurück darf ein Objekt, eine Liste oder ein Objekt mit{' '}
                  <code>orders</code>, <code>data</code>, <code>items</code> oder <code>results</code> darin.
                </span>
              </label>
            )}

            <div className="form-grid">
              <label>
                Spalte mit der Bestellnummer
                <input name="matchColumn" required maxLength={80} placeholder="Bestellnummer" />
                <span className="field-hint">
                  Danach wird in der Antwort gesucht — beim Endpunkt der Name des Feldes, nicht der des
                  Query-Parameters.
                </span>
              </label>
              <label>
                Was der Kunde hören darf
                <input name="returnColumns" required placeholder="Status, Voraussichtliche Lieferung" />
                <span className="field-hint">
                  Kommagetrennt. <strong>Nur diese Spalten</strong> gehen an den Agenten — Einkaufspreis und
                  interne Notizen bleiben, wo sie sind.
                </span>
              </label>
            </div>

            <div className="row">
              <button type="submit" disabled={adding}>
                {adding ? <span className="spinner" /> : null}
                Quelle anlegen
              </button>
              {feedback ? <span className={isError ? 'error' : 'small muted'}>{feedback}</span> : null}
            </div>
          </form>
        ) : (
          <p className="field-hint">Nur Admins können Bestellquellen ändern.</p>
        )}
      </div>
    </div>
  );
}
