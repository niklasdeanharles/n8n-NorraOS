import { createClient } from '@/lib/supabase/server';
import { relativeTime } from '@/lib/format';
import { AddStaffForm, HandleMessageButton, StaffToggle } from './reception-forms';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  neu: 'badge badge-warn',
  zugestellt: 'badge badge-accent',
  erledigt: 'badge',
};

export default async function ReceptionPage() {
  const supabase = await createClient();

  const [staffResult, messagesResult] = await Promise.all([
    supabase
      .from('staff_members')
      .select('id, name, role, e164, extension, email, note, accepts_transfers, accepts_messages, active')
      .order('name'),
    supabase
      .from('messages_for_staff')
      .select('id, staff_member_id, caller_name, caller_e164, body, urgency, status, created_at, delivered_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const staff = staffResult.data ?? [];
  const messages = messagesResult.data ?? [];
  const nameById = new Map(staff.map((person) => [person.id, person.name]));
  const open = messages.filter((message) => message.status !== 'erledigt');

  return (
    <div className="stack">
      <header className="topbar">
        <h1>Empfang</h1>
        <p className="muted small">
          Wen der Agent kennt und was ihm ausgerichtet wurde. Ein Rezeptionist kennt Menschen,
          nicht nur Abteilungen.
        </p>
      </header>

      <div className="card">
        <div className="card-head">
          <h3>
            Nachrichten{' '}
            {open.length > 0 ? <span className="badge badge-warn">{open.length} offen</span> : null}
          </h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Was Anrufer jemandem ausrichten lassen wollten. Ein Rückruf ist die Bitte um einen
            zweiten Anruf — das hier ist der Inhalt selbst.
          </div>
        </div>
        <div className="card-body">
          {messages.length === 0 ? (
            <p className="muted">Noch keine Nachricht.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Für</th>
                    <th>Von</th>
                    <th>Nachricht</th>
                    <th>Eingegangen</th>
                    <th>Stand</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td>{nameById.get(message.staff_member_id) ?? '—'}</td>
                      <td>
                        {message.caller_name ?? 'nicht genannt'}
                        {message.caller_e164 ? (
                          <span className="tiny muted" style={{ display: 'block' }}>{message.caller_e164}</span>
                        ) : null}
                      </td>
                      <td>
                        {message.body}
                        {message.urgency === 'dringend' ? (
                          <span className="badge badge-danger" style={{ marginLeft: 6 }}>dringend</span>
                        ) : null}
                      </td>
                      <td className="tiny muted">{relativeTime(message.created_at)}</td>
                      <td>
                        <span className={STATUS_TONE[message.status] ?? 'badge'}>{message.status}</span>
                      </td>
                      <td>
                        {message.status === 'erledigt' ? null : <HandleMessageButton id={message.id} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Verzeichnis</h3>
          <div className="small muted" style={{ marginTop: 3 }}>
            Wer hier steht, kann angerufen und angesprochen werden. Wer nicht, für den nimmt der
            Agent nichts entgegen — statt es zu versprechen und liegen zu lassen.
          </div>
        </div>
        <div className="card-body">
          {staff.length === 0 ? (
            <p className="muted">Noch niemand im Verzeichnis.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Funktion</th>
                    <th>Durchwahl</th>
                    <th>Nimmt an</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {staff.map((person) => (
                    <tr key={person.id} style={person.active ? undefined : { opacity: 0.55 }}>
                      <td>
                        {person.name}
                        {person.note ? (
                          <span className="tiny muted" style={{ display: 'block' }}>{person.note}</span>
                        ) : null}
                      </td>
                      <td className="muted small">{person.role ?? '—'}</td>
                      <td className="small">
                        {person.extension ?? '—'}
                        {person.e164 ? (
                          <span className="tiny muted" style={{ display: 'block' }}>{person.e164}</span>
                        ) : null}
                      </td>
                      <td className="small">
                        {person.accepts_transfers ? <span className="badge badge-ok">Anrufe</span> : null}{' '}
                        {person.accepts_messages ? <span className="badge badge-accent">Nachrichten</span> : null}
                        {!person.accepts_transfers && !person.accepts_messages ? (
                          <span className="muted">nichts</span>
                        ) : null}
                      </td>
                      <td><StaffToggle id={person.id} active={person.active} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Person aufnehmen</h3></div>
        <AddStaffForm />
      </div>
    </div>
  );
}
