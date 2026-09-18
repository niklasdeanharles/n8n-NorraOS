import { createClient } from '@/lib/supabase/server';
import { currentActor } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { RoleSelect } from './role-select';

export const dynamic = 'force-dynamic';

/** What each role may do. Mirrors the RLS policies rather than restating them loosely. */
const CAPABILITIES: Array<{ role: string; may: string[]; mayNot: string[] }> = [
  {
    role: 'Admin',
    may: ['Agenten konfigurieren', 'Wissensbasis pflegen', 'Freigaben entscheiden', 'Rollen vergeben'],
    mayNot: ['Protokoll-Einträge ändern oder löschen'],
  },
  {
    role: 'Mitarbeiter',
    may: ['Konversationen übernehmen und beantworten', 'Tickets bearbeiten', 'Alles lesen'],
    mayNot: ['Agenten ändern', 'Wissensbasis ändern', 'Freigaben entscheiden'],
  },
  {
    role: 'Kunde',
    may: ['Reserviert für ein späteres Kundenportal'],
    mayNot: ['Aktuell kein Zugang zur Konsole'],
  },
];

export default async function TeamPage() {
  const supabase = await createClient();
  const actor = await currentActor(supabase);

  const [membersResult, orgResult] = await Promise.all([
    supabase.from('users').select('id, full_name, email, role, created_at').order('created_at'),
    supabase.from('organizations').select('id, name, slug, escalation_email').single(),
  ]);

  const members = membersResult.data ?? [];
  const isAdmin = actor?.role === 'admin';
  const org = orgResult.data;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Team</h1>
          <div className="small muted">Wer Zugang hat und was diese Rolle darf</div>
        </div>
        <span className="badge">{members.length} {members.length === 1 ? 'Mitglied' : 'Mitglieder'}</span>
      </header>

      <div className="content stack" style={{ gap: 20 }}>
        <div className="card">
          <div className="card-head"><h2>Mitglieder</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Seit</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td style={{ fontWeight: 550 }}>
                      {member.full_name ?? '—'}
                      {member.id === actor?.id ? <span className="badge badge-accent tiny" style={{ marginLeft: 8 }}>du</span> : null}
                    </td>
                    <td className="small dim">{member.email}</td>
                    <td>
                      <RoleSelect
                        userId={member.id}
                        role={member.role}
                        editable={isAdmin && member.id !== actor?.id}
                      />
                    </td>
                    <td className="small muted">{formatDateTime(member.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Einladen</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            <p className="small dim" style={{ margin: 0 }}>
              Neue Mitglieder registrieren sich selbst und geben dabei diese Organisations-ID an. Sie
              starten als Mitarbeiter; Admin vergibst du oben.
            </p>
            <label>
              Organisations-ID
              <input readOnly value={org?.id ?? ''} onFocus={(e) => e.currentTarget.select()} />
              <span className="field-hint">Beim Registrieren als <code>organization_id</code> übergeben</span>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Was Rollen dürfen</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              Durchgesetzt in der Datenbank, nicht nur in der Oberfläche
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 }}>
            {CAPABILITIES.map((entry) => (
              <div key={entry.role}>
                <h3>{entry.role}</h3>
                <ul className="small dim" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {entry.may.map((item) => <li key={item}>{item}</li>)}
                  {entry.mayNot.map((item) => (
                    <li key={item} style={{ color: 'hsl(var(--muted-foreground))', opacity: .8 }}>
                      <s>{item}</s>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Organisation</h2></div>
          <div className="card-body small stack" style={{ gap: 8 }}>
            <div className="spread"><span className="muted">Name</span><span>{org?.name ?? '—'}</span></div>
            <div className="spread"><span className="muted">Slug</span><code>{org?.slug ?? '—'}</code></div>
            <div className="spread">
              <span className="muted">Eskalations-E-Mail</span>
              <span>
                {org?.escalation_email ?? <span className="muted">nicht gesetzt</span>}
              </span>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>
              Ändern unter <a href="/settings">Einstellungen</a>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
