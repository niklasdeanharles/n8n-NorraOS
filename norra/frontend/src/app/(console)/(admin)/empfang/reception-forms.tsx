'use client';

import { useActionState } from 'react';
import { addStaffMember, markMessageHandled, setStaffActive, type ReceptionFormState } from './actions';

const initial: ReceptionFormState = { error: null };

function Feedback({ state }: { state: ReceptionFormState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p className="notice notice-ok">{state.ok}</p>;
  return null;
}

export function AddStaffForm() {
  const [state, action, pending] = useActionState(addStaffMember, initial);
  return (
    <form action={action} className="card-body stack">
      <div className="form-grid">
        <label>
          Name
          <input name="name" required maxLength={200} placeholder="Frau Vogel" />
          <span className="field-hint">So, wie ein Anrufer ihn sagt.</span>
        </label>
        <label>
          Funktion
          <input name="role" maxLength={120} placeholder="Großkundenbetreuung" />
        </label>
      </div>

      <div className="form-grid">
        <label>
          Rufnummer
          <input name="e164" placeholder="+4930111222333" spellCheck={false} />
          <span className="field-hint">Hierhin wird durchgestellt.</span>
        </label>
        <label>
          Durchwahl
          <input name="extension" maxLength={8} placeholder="17" inputMode="numeric" />
          <span className="field-hint">Was ein Anrufer nennt. Im Haus nur einmal vergeben.</span>
        </label>
      </div>

      <label>
        E-Mail
        <input name="email" type="email" placeholder="vogel@kunde.de" spellCheck={false} />
        <span className="field-hint">Hierhin gehen Nachrichten, die am Telefon hinterlassen werden.</span>
      </label>

      <label>
        Notiz für den Agenten
        <input name="note" maxLength={500} placeholder="Dienstags und donnerstags im Haus." />
        <span className="field-hint">
          Was der Agent über diese Person sagen darf, wenn jemand nach ihr fragt. Kurz halten.
        </span>
      </label>

      <div className="stack" style={{ gap: 6 }}>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>
          <input type="checkbox" name="acceptsTransfers" defaultChecked style={{ width: 'auto' }} />
          <span>Anrufe annehmen</span>
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>
          <input type="checkbox" name="acceptsMessages" defaultChecked style={{ width: 'auto' }} />
          <span>Nachrichten annehmen</span>
        </label>
        <span className="field-hint">
          Zwei getrennte Fragen: eine Geschäftsführerin nimmt vielleicht keine Anrufe entgegen,
          Nachrichten aber sehr wohl.
        </span>
      </div>

      <Feedback state={state} />
      <div><button type="submit" disabled={pending}>{pending ? 'Wird angelegt…' : 'Ins Verzeichnis'}</button></div>
    </form>
  );
}

export function StaffToggle({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setStaffActive, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <button type="submit" className="btn-secondary btn-sm" disabled={pending}>
        {active ? 'Aus dem Verzeichnis' : 'Wieder aufnehmen'}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

export function HandleMessageButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markMessageHandled, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn-secondary btn-sm" disabled={pending}>
        {pending ? '…' : 'Erledigt'}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
