import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { voiceConfigured } from '@/lib/env';
import { describeHours, parseBusinessHours } from '@/lib/voice/hours';
import { relativeTime } from '@/lib/format';
import { AddNumberForm } from './add-number-form';
import { SetupGuide } from './setup-guide';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  active: 'badge badge-ok',
  paused: 'badge badge-warn',
  unconfigured: 'badge',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Live',
  paused: 'Pausiert',
  unconfigured: 'Nicht eingerichtet',
};

export default async function PhonePage() {
  const supabase = await createClient();

  const [numbersResult, callsResult, agentsResult] = await Promise.all([
    supabase
      .from('phone_numbers')
      .select('id, e164, label, status, agent_id, business_hours, timezone, after_hours, last_call_at')
      .order('created_at'),
    supabase
      .from('calls')
      .select('id, from_e164, to_e164, status, started_at, duration_seconds, turn_count, conversation_id')
      .order('started_at', { ascending: false })
      .limit(10),
    supabase.from('agents').select('id, name').order('name'),
  ]);

  const numbers = numbersResult.data ?? [];
  const calls = callsResult.data ?? [];
  const agentNames = new Map((agentsResult.data ?? []).map((a) => [a.id, a.name]));
  const live = numbers.filter((n) => n.status === 'active').length;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Telefon</h1>
          <div className="small muted">Nummern, die ein Agent abnimmt — und was dabei herauskam</div>
        </div>
        <span className={live > 0 ? 'badge badge-ok' : 'badge'}>
          {live} von {numbers.length} live
        </span>
      </header>

      <div className="content stack" style={{ gap: 20 }}>
        {!voiceConfigured() ? (
          <p className="notice">
            Telefonie ist auf dieser Instanz noch nicht konfiguriert. Ohne <code>TWILIO_AUTH_TOKEN</code> und{' '}
            <code>NORRA_PUBLIC_URL</code> weist Norra jeden eingehenden Anruf ab — Nummern lassen sich trotzdem
            schon anlegen.
          </p>
        ) : null}

        <div className="card card-body-flush">
          <div className="card-head spread">
            <h2>Nummern</h2>
            <span className="small muted">Eine Nummer gehört genau einer Organisation</span>
          </div>
          {numbers.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Agent</th>
                    <th>Zeiten</th>
                    <th>Status</th>
                    <th>Letzter Anruf</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((number) => (
                    <tr key={number.id}>
                      <td>
                        <Link href={`/phone/${number.id}`} className="num">
                          {number.e164}
                        </Link>
                        {number.label ? <div className="tiny muted">{number.label}</div> : null}
                      </td>
                      <td className="small dim">
                        {number.agent_id ? (agentNames.get(number.agent_id) ?? '—') : (
                          <span className="muted">keiner</span>
                        )}
                      </td>
                      <td className="small dim">{describeHours(parseBusinessHours(number.business_hours))}</td>
                      <td>
                        <span className={STATUS_TONE[number.status] ?? 'badge'}>
                          {STATUS_LABEL[number.status] ?? number.status}
                        </span>
                      </td>
                      <td className="small muted">{relativeTime(number.last_call_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch keine Nummer. Unten anlegen — drei Felder, dann ist die Leitung besetzt.</p>
          )}
        </div>

        <AddNumberForm />

        <SetupGuide numbers={numbers.map((n) => ({ id: n.id, e164: n.e164, status: n.status }))} />

        <div className="card card-body-flush">
          <div className="card-head">
            <h2>Letzte Anrufe</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              Jeder Anruf ist auch eine Konversation — mit vollem Wortlaut
            </div>
          </div>
          {calls.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Anrufer</th>
                    <th>Nummer</th>
                    <th>Ergebnis</th>
                    <th className="num">Turns</th>
                    <th className="num">Dauer</th>
                    <th>Wann</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr key={call.id}>
                      <td className="num">{call.from_e164 ?? 'unbekannt'}</td>
                      <td className="num small dim">{call.to_e164 ?? '—'}</td>
                      <td>
                        {call.conversation_id ? (
                          <Link href={`/conversations/${call.conversation_id}`} className="small">
                            {call.status}
                          </Link>
                        ) : (
                          <span className="small dim">{call.status}</span>
                        )}
                      </td>
                      <td className="num small">{call.turn_count}</td>
                      <td className="num small">
                        {call.duration_seconds === null ? '—' : `${call.duration_seconds}s`}
                      </td>
                      <td className="small muted">{relativeTime(call.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch kein Anruf eingegangen.</p>
          )}
        </div>
      </div>
    </>
  );
}
