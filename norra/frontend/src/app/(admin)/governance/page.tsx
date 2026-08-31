import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { currentActor } from '@/lib/audit';
import { formatDateTime, relativeTime, statusTone } from '@/lib/format';
import { DecisionButtons } from './decision-buttons';

export const dynamic = 'force-dynamic';

const AUDIT_LABELS: Record<string, string> = {
  create: 'angelegt', update: 'geändert', delete: 'gelöscht',
  approve: 'freigegeben', reject: 'abgelehnt', takeover: 'übernommen', release: 'zurückgegeben',
};

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  return `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} ${currency ?? ''}`.trim();
}

export default async function GovernancePage() {
  const supabase = await createClient();
  const actor = await currentActor(supabase);

  const [pendingResult, decidedResult, auditResult, agentsResult] = await Promise.all([
    supabase
      .from('approvals')
      .select('id, tool_name, summary, amount, currency, created_at, expires_at, conversation_id, agents(name)')
      .eq('status', 'pending')
      .order('amount', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('approvals')
      .select('id, tool_name, summary, amount, currency, status, decided_at, decision_note, users!approvals_decided_by_fkey(full_name, email)')
      .neq('status', 'pending')
      .order('decided_at', { ascending: false, nullsFirst: false })
      .limit(15),
    supabase
      .from('audit_log')
      .select('id, actor_label, action, entity_type, entity_label, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('agents').select('id, name, guardrails, tools, status').eq('status', 'live'),
  ]);

  const pending = pendingResult.data ?? [];
  const canDecide = actor?.role === 'admin';

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Governance</h1>
          <div className="small muted">Freigaben, Rollen und ein Protokoll, das sich nicht umschreiben lässt</div>
        </div>
        {pending.length > 0 ? (
          <span className="badge badge-warn"><span className="dot" aria-hidden="true" />{pending.length} offen</span>
        ) : (
          <span className="badge badge-ok"><span className="dot" aria-hidden="true" />Nichts offen</span>
        )}
      </header>

      <div className="content stack" style={{ gap: 20 }}>
        <div className="card">
          <div className="card-head">
            <h2>Wartet auf Freigabe</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              Kritische Aktionen werden nicht ausgeführt, sondern hier eingereicht. Höchste Beträge zuerst.
            </div>
          </div>
          {pending.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Aktion</th><th>Agent</th><th>Betrag</th><th>Eingereicht</th><th>Läuft ab</th><th></th></tr>
                </thead>
                <tbody>
                  {pending.map((approval) => (
                    <tr key={approval.id}>
                      <td>
                        <div style={{ fontWeight: 550 }}>{approval.summary}</div>
                        <code className="tiny muted">{approval.tool_name}</code>
                        {approval.conversation_id ? (
                          <> · <Link href={`/conversations/${approval.conversation_id}`} className="tiny">Konversation</Link></>
                        ) : null}
                      </td>
                      <td className="small dim">{approval.agents?.name ?? '—'}</td>
                      <td className="num">{formatAmount(approval.amount, approval.currency)}</td>
                      <td className="small muted">{relativeTime(approval.created_at)}</td>
                      <td className="small muted">{formatDateTime(approval.expires_at)}</td>
                      <td><DecisionButtons approvalId={approval.id} canDecide={canDecide} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Keine offenen Freigaben. Der Agent hat nichts eingereicht, was einen Menschen braucht.</p>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Zuletzt entschieden</h2></div>
            {decidedResult.data && decidedResult.data.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Aktion</th><th>Ergebnis</th><th>Von</th></tr></thead>
                  <tbody>
                    {decidedResult.data.map((decision) => (
                      <tr key={decision.id}>
                        <td>
                          <div className="small">{decision.summary}</div>
                          {decision.decision_note ? <div className="tiny muted">{decision.decision_note}</div> : null}
                        </td>
                        <td><span className={statusTone(decision.status === 'approved' ? 'success' : 'error')}>
                          {decision.status === 'approved' ? 'freigegeben' : decision.status}
                        </span></td>
                        <td className="small dim">
                          {decision.users?.full_name ?? decision.users?.email ?? '—'}
                          <div className="tiny muted">{relativeTime(decision.decided_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Noch nichts entschieden.</p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Guardrails der Live-Agenten</h2>
              <div className="small muted" style={{ marginTop: 3 }}>Was gerade wirklich gilt, nicht was dokumentiert ist</div>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              {agentsResult.data && agentsResult.data.length > 0 ? (
                agentsResult.data.map((agent) => {
                  const guardrails = (typeof agent.guardrails === 'object' && agent.guardrails !== null && !Array.isArray(agent.guardrails)
                    ? agent.guardrails
                    : {}) as { forbidden_topics?: string[] };
                  const tools = Array.isArray(agent.tools) ? agent.tools.length : 0;
                  const forbidden = guardrails.forbidden_topics ?? [];
                  return (
                    <div key={agent.id}>
                      <div className="spread">
                        <Link href={`/agents/${agent.id}`} style={{ fontWeight: 550 }}>{agent.name}</Link>
                        <span className="badge badge-ok">live</span>
                      </div>
                      <div className="tiny muted" style={{ marginTop: 3 }}>
                        {tools} Tools · {forbidden.length > 0 ? `${forbidden.length} verbotene Themen` : 'keine verbotenen Themen'}
                      </div>
                      {forbidden.length > 0 ? (
                        <div className="row" style={{ gap: 5, marginTop: 6 }}>
                          {forbidden.slice(0, 4).map((topic) => (
                            <span key={topic} className="badge tiny">{topic}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="muted small" style={{ margin: 0 }}>Kein Agent ist live.</p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Protokoll</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              Nur anfügbar — auch Admins können Einträge weder ändern noch löschen.
            </div>
          </div>
          {auditResult.data && auditResult.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Wann</th><th>Wer</th><th>Was</th></tr></thead>
                <tbody>
                  {auditResult.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="small muted">{formatDateTime(entry.created_at)}</td>
                      <td className="small">{entry.actor_label}</td>
                      <td className="small dim">
                        <code className="tiny">{entry.entity_type}</code>{' '}
                        {AUDIT_LABELS[entry.action] ?? entry.action}
                        {entry.entity_label ? ` · ${entry.entity_label}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch keine Einträge.</p>
          )}
        </div>
      </div>
    </>
  );
}
