'use client';

import { useActionState } from 'react';
import { saveContact, type HandoffState } from '../actions';

const initial: HandoffState = { error: null };

type Contact = {
  id: string;
  e164: string;
  display_name: string | null;
  note: string | null;
  call_count: number;
};

/**
 * The caller behind a phone conversation, and the two fields that make the
 * next call better.
 *
 * Only rendered when the conversation actually has a contact — chat and widget
 * visitors have none, and an empty card would suggest otherwise.
 */
export function ContactCard({ contact, conversationId }: { contact: Contact; conversationId: string }) {
  const [state, action, pending] = useActionState(saveContact, initial);

  return (
    <div className="card">
      <div className="card-head spread">
        <h3>Anrufer</h3>
        <span className="badge">{contact.call_count}× angerufen</span>
      </div>
      <form action={action} className="card-body stack" style={{ gap: 12 }}>
        <input type="hidden" name="contactId" value={contact.id} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <div className="num small">{contact.e164}</div>
        <label>
          Name
          <input name="displayName" defaultValue={contact.display_name ?? ''} maxLength={200} placeholder="unbekannt" />
          <span className="field-hint">Damit begrüßt der Agent ihn beim nächsten Anruf</span>
        </label>
        <label>
          Notiz
          <input name="note" defaultValue={contact.note ?? ''} maxLength={2000} placeholder="Was beim nächsten Mal hilft" />
          <span className="field-hint">Der Agent liest sie vor dem Gespräch — kurz halten</span>
        </label>
        <div className="row">
          <button type="submit" className="btn-secondary btn-sm" disabled={pending}>
            {pending ? <span className="spinner" /> : null}
            Speichern
          </button>
          {state.error ? <span className="error">{state.error}</span> : null}
          {state.ok ? <span className="small muted">{state.ok}</span> : null}
        </div>
      </form>
    </div>
  );
}
