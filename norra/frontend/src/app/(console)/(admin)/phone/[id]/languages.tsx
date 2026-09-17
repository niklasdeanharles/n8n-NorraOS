'use client';

import { useActionState, useState } from 'react';
import { addLanguage, removeLanguage, type PhoneFormState } from '../actions';
import { LANGUAGES, languageLabel } from '@/lib/voice/languages';

const initial: PhoneFormState = { error: null };

type Language = { id: string; code: string; voice: string };

/**
 * Welche Sprachen diese Leitung außer ihrer eigenen annimmt.
 *
 * Die Stimmenliste hängt an der gewählten Sprache und wechselt mit ihr — eine
 * deutsche Stimme, die Englisch liest, klingt wie eine Parodie, und die einzige
 * Stelle, an der sich das verhindern lässt, ohne den Betreiber zu belehren, ist
 * die Auswahl selbst.
 */
export function Languages({
  numberId,
  primary,
  languages,
  canEdit,
}: {
  numberId: string;
  primary: string;
  languages: Language[];
  canEdit: boolean;
}) {
  const [addState, add, adding] = useActionState(addLanguage, initial);
  const [removeState, remove, removing] = useActionState(removeLanguage, initial);
  const feedback = addState.error ?? removeState.error ?? addState.ok ?? removeState.ok ?? null;
  const isError = Boolean(addState.error ?? removeState.error);

  // Die eigene Sprache der Leitung steht nicht zur Wahl: sie gilt ohnehin, und
  // ein zweiter Eintrag dafür wäre eine Zeile, die nichts ändert.
  const available = LANGUAGES.filter(
    (language) => language.code !== primary && !languages.some((row) => row.code === language.code),
  );
  const [code, setCode] = useState(available[0]?.code ?? '');
  const voices = LANGUAGES.find((language) => language.code === code)?.voices ?? [];

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sprachen</h2>
        <div className="small muted" style={{ marginTop: 3 }}>
          Spricht der Anrufer eine davon, wechselt der Agent mitten im Gespräch. Was hier nicht steht,
          wird nicht gesprochen — auch dann nicht, wenn das Modell es vorschlägt.
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="spread small">
          <span className="muted">Sprache der Leitung</span>
          <span>
            {languageLabel(primary)} <code className="tiny">{primary}</code>
          </span>
        </div>

        {languages.length > 0 ? (
          <div className="stack" style={{ gap: 9 }}>
            {languages.map((language) => (
              <div key={language.id} className="tool-row">
                <div className="spread">
                  <div className="grow">
                    <strong>{languageLabel(language.code)}</strong> <code className="tiny">{language.code}</code>
                    <div className="field-hint">Stimme: {language.voice}</div>
                  </div>
                  {canEdit ? (
                    <form action={remove}>
                      <input type="hidden" name="id" value={language.id} />
                      <button type="submit" className="btn-secondary btn-sm" disabled={removing}>
                        Entfernen
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="field-hint">
            Nur {languageLabel(primary)}. Ein Anrufer, der eine andere Sprache spricht, bekommt trotzdem
            eine Antwort — nur eben auf {languageLabel(primary)}.
          </p>
        )}

        {canEdit && available.length > 0 ? (
          <form action={add} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="phoneNumberId" value={numberId} />
            <div className="form-grid">
              <label>
                Sprache
                <select name="code" value={code} onChange={(event) => setCode(event.target.value)}>
                  {available.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label} ({language.code})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stimme
                <select name="voice" key={code}>
                  {voices.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">Nur Stimmen, die diese Sprache können</span>
              </label>
            </div>
            <div className="row">
              <button type="submit" disabled={adding}>
                {adding ? <span className="spinner" /> : null}
                Sprache freischalten
              </button>
              {feedback ? <span className={isError ? 'error' : 'small muted'}>{feedback}</span> : null}
            </div>
          </form>
        ) : canEdit ? (
          <p className="field-hint">Alle Sprachen aus dem Katalog sind bereits freigeschaltet.</p>
        ) : (
          <p className="field-hint">Nur Admins können Sprachen ändern.</p>
        )}
      </div>
    </div>
  );
}
