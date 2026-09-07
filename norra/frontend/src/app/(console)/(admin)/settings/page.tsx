import { createClient } from '@/lib/supabase/server';
import { voiceConfigured } from '@/lib/env';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

/**
 * Integration status.
 *
 * Presence only — never a value, not even masked. A masked secret still tells
 * an attacker its length, and this page is visible to every member.
 */
function integrationRows() {
  return [
    {
      name: 'Supabase',
      detail: 'Datenbank, Auth und Realtime',
      configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      hint: 'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
    },
    {
      name: 'n8n',
      detail: 'Agenten-Workflows und Wissens-Ingestion',
      configured: Boolean(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_SECRET),
      hint: 'N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET',
    },
    {
      name: 'Telefonie',
      detail: 'Eingehende Anrufe an den Telefon-Assistenten',
      configured: voiceConfigured(),
      hint: 'TWILIO_AUTH_TOKEN, NORRA_PUBLIC_URL',
    },
  ];
}

export default async function SettingsPage() {
  const supabase = await createClient();

  const [orgResult, actorResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, escalation_email, timezone, locale')
      .single(),
    supabase.auth.getUser(),
  ]);

  const organization = orgResult.data;
  const userId = actorResult.data.user?.id;
  const { data: profile } = userId
    ? await supabase.from('users').select('role').eq('id', userId).single()
    : { data: null };
  const isAdmin = profile?.role === 'admin';

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Einstellungen</h1>
          <div className="small muted">Was für die ganze Organisation gilt</div>
        </div>
        {isAdmin ? null : <span className="badge">nur lesend</span>}
      </header>

      <div className="content stack" style={{ gap: 20, maxWidth: 860 }}>
        {organization ? (
          <SettingsForm organization={organization} editable={isAdmin} />
        ) : (
          <p className="notice">Organisation konnte nicht geladen werden.</p>
        )}

        <div className="card card-body-flush">
          <div className="card-head">
            <h2>Integrationen</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              Konfiguriert wird über Umgebungsvariablen, nicht hier — Secrets gehören nicht in eine Datenbank,
              die das halbe Team lesen kann.
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Dienst</th><th>Wofür</th><th>Variablen</th><th>Status</th></tr>
              </thead>
              <tbody>
                {integrationRows().map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontWeight: 550 }}>{row.name}</td>
                    <td className="small dim">{row.detail}</td>
                    <td className="tiny muted mono">{row.hint}</td>
                    <td>
                      <span className={row.configured ? 'badge badge-ok' : 'badge badge-warn'}>
                        {row.configured ? 'gesetzt' : 'fehlt'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Organisation</h2>
          </div>
          <div className="card-body small stack" style={{ gap: 9 }}>
            <div className="spread">
              <span className="muted">Slug</span>
              <code>{organization?.slug ?? '—'}</code>
            </div>
            <div className="spread">
              <span className="muted">Organisations-ID</span>
              <code className="tiny">{organization?.id ?? '—'}</code>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>
              Der Slug ist Teil der Identität dieser Organisation und lässt sich nicht ändern. Neue Mitglieder
              geben beim Registrieren die Organisations-ID an.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
