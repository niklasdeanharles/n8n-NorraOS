'use client';

import { useActionState, useState } from 'react';
import { DAY_LABELS, WEEK } from '@/lib/voice/hours';
import { addTargets, createCampaign, setCampaignStatus, type CampaignFormState } from './actions';

const initial: CampaignFormState = { error: null };

function Feedback({ state }: { state: CampaignFormState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p className="notice notice-ok">{state.ok}</p>;
  return null;
}

export function NewCampaignForm({
  agents,
  numbers,
}: {
  agents: Array<{ id: string; name: string }>;
  numbers: Array<{ id: string; e164: string; label: string | null }>;
}) {
  const [state, action, pending] = useActionState(createCampaign, initial);
  // Montag bis Freitag vorgehakt: die Woche, in der ein Geschäftskunde erreichbar
  // ist. Wochenende bewusst nicht — wer samstags anruft, soll das entscheiden.
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);

  if (agents.length === 0 || numbers.length === 0) {
    return (
      <div className="card">
        <div className="card-body stack">
          <p className="muted">
            Eine Kampagne braucht einen Agenten und eine Nummer, von der aus angerufen wird.
            {agents.length === 0 ? ' Es gibt noch keinen Agenten.' : ''}
            {numbers.length === 0 ? ' Es ist noch keine Nummer eingerichtet.' : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <div className="card-head">
        <h3>Neue Kampagne</h3>
        <div className="small muted" style={{ marginTop: 3 }}>
          Wird als Entwurf angelegt. Angerufen wird erst, wenn Nummern drin sind und du sie startest.
        </div>
      </div>
      <div className="card-body stack">
        <label>
          Name
          <input name="name" required maxLength={200} placeholder="Rückrufe KW38" />
        </label>

        <label>
          Was der Agent erreichen soll
          <textarea
            name="goal"
            required
            rows={2}
            maxLength={2000}
            placeholder="Offene Rückrufwünsche abarbeiten und einen Termin anbieten."
          />
          <span className="field-hint">
            Ein Satz. Er wandert in den Gesprächskontext — ein Anruf ohne Anlass ist ein Anruf, bei
            dem der Angerufene nach zehn Sekunden auflegt.
          </span>
        </label>

        <label>
          Der erste Satz
          <textarea
            name="openingLine"
            rows={2}
            maxLength={500}
            placeholder="Guten Tag, hier ist Lina von Lumen Energie. Sie hatten um einen Rückruf gebeten — passt es gerade?"
          />
          <span className="field-hint">
            Leer lassen geht, dann nimmt Norra einen neutralen Satz. Wer anruft, schuldet dem
            Angerufenen als Erstes einen Grund.
          </span>
        </label>

        <div className="form-grid">
          <label>
            Agent
            <select name="agentId" required defaultValue="">
              <option value="" disabled>Bitte wählen</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>
            Anrufen von
            <select name="phoneNumberId" required defaultValue="">
              <option value="" disabled>Bitte wählen</option>
              {numbers.map((number) => (
                <option key={number.id} value={number.id}>
                  {number.label ? `${number.label} · ${number.e164}` : number.e164}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="stack">
          <strong className="small">Wann angerufen werden darf</strong>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Ein Tag ohne Haken heißt: an dem Tag wird nicht angerufen. Gerechnet wird in der
            Zeitzone unten, nicht in der des Servers.
          </p>
          {WEEK.map((day) => (
            <div key={day} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  name={`day-${day}`}
                  checked={days.includes(day)}
                  onChange={(event) =>
                    setDays((current) =>
                      event.target.checked ? [...current, day] : current.filter((d) => d !== day),
                    )
                  }
                  style={{ width: 'auto' }}
                />
                <span style={{ minWidth: 96 }}>{DAY_LABELS[day]}</span>
              </label>
              <input
                type="time"
                name={`from-${day}`}
                defaultValue="09:00"
                disabled={!days.includes(day)}
                style={{ width: 118 }}
                aria-label={`${DAY_LABELS[day]} von`}
              />
              <span className="muted small">bis</span>
              <input
                type="time"
                name={`to-${day}`}
                defaultValue="17:00"
                disabled={!days.includes(day)}
                style={{ width: 118 }}
                aria-label={`${DAY_LABELS[day]} bis`}
              />
            </div>
          ))}
        </div>

        <div className="form-grid">
          <label>
            Zeitzone
            <input name="timezone" defaultValue="Europe/Berlin" maxLength={64} />
          </label>
          <label>
            Gleichzeitige Anrufe
            <input type="number" name="maxConcurrent" defaultValue={5} min={1} max={50} />
            <span className="field-hint">Pro Durchlauf, alle fünf Minuten.</span>
          </label>
        </div>

        <div className="form-grid">
          <label>
            Versuche je Nummer
            <input type="number" name="maxAttempts" defaultValue={3} min={1} max={10} />
          </label>
          <label>
            Wartezeit bis zum nächsten Versuch (Minuten)
            <input type="number" name="retryAfterMinutes" defaultValue={240} min={15} max={10080} />
          </label>
        </div>

        <Feedback state={state} />
        <button type="submit" disabled={pending}>
          {pending ? 'Wird angelegt…' : 'Als Entwurf anlegen'}
        </button>
      </div>
    </form>
  );
}

export function AddTargetsForm({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState(addTargets, initial);
  return (
    <form action={action}>
      <input type="hidden" name="campaignId" value={campaignId} />
      <label>
        Nummern
        <textarea
          name="targets"
          rows={4}
          placeholder={'+4915112345678; A. Beispiel; Vorgang BX-4471\n030 1234567; B. Muster'}
          spellCheck={false}
        />
        <span className="field-hint">
          Eine Zeile je Anruf: Nummer, optional Name, optional eine Notiz — getrennt durch
          Semikolon, Komma oder Tabulator. Aus einer Tabelle kopieren funktioniert direkt.
          Bereits vorhandene Nummern werden übersprungen, nicht doppelt angerufen.
        </span>
      </label>
      <Feedback state={state} />
      <button type="submit" disabled={pending}>{pending ? 'Wird übernommen…' : 'Nummern hinzufügen'}</button>
    </form>
  );
}

export function CampaignStatusForm({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(setCampaignStatus, initial);
  const next = status === 'running' ? 'paused' : 'running';
  const label = status === 'running' ? 'Anhalten' : 'Starten';

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" disabled={pending || status === 'done'} className={next === 'running' ? '' : 'btn-secondary'}>
        {pending ? '…' : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}
