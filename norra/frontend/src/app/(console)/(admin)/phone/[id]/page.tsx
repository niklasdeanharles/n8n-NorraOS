import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { relativeTime } from '@/lib/format';
import { NumberForm } from './number-form';

export const dynamic = 'force-dynamic';

export default async function PhoneNumberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [numberResult, agentsResult, callsResult] = await Promise.all([
    supabase.from('phone_numbers').select('*').eq('id', id).maybeSingle(),
    supabase.from('agents').select('id, name, status').order('name'),
    supabase
      .from('calls')
      .select('id, from_e164, status, started_at, duration_seconds, turn_count, conversation_id')
      .eq('phone_number_id', id)
      .order('started_at', { ascending: false })
      .limit(8),
  ]);

  const number = numberResult.data;
  if (!number) notFound();

  const calls = callsResult.data ?? [];

  return (
    <>
      <header className="topbar">
        <div className="grow">
          <div className="row" style={{ gap: 7 }}>
            <Link href="/phone" className="small muted">Telefon</Link>
            <span className="muted">/</span>
            <h1 style={{ fontSize: 17 }} className="num">{number.e164}</h1>
          </div>
          <div className="small muted">{number.label ?? 'Ohne Bezeichnung'}</div>
        </div>
        <span className={number.status === 'active' ? 'badge badge-ok' : 'badge'}>
          {number.status === 'active' ? 'Live' : number.status === 'paused' ? 'Pausiert' : 'Nicht eingerichtet'}
        </span>
      </header>

      <div className="content stack" style={{ gap: 20, maxWidth: 860 }}>
        <NumberForm number={number} agents={agentsResult.data ?? []} />

        <div className="card card-body-flush">
          <div className="card-head">
            <h2>Anrufe auf dieser Nummer</h2>
          </div>
          {calls.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Anrufer</th><th>Ergebnis</th><th className="num">Turns</th><th className="num">Dauer</th><th>Wann</th></tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr key={call.id}>
                      <td className="num">{call.from_e164 ?? 'unbekannt'}</td>
                      <td>
                        {call.conversation_id ? (
                          <Link href={`/conversations/${call.conversation_id}`} className="small">{call.status}</Link>
                        ) : (
                          <span className="small dim">{call.status}</span>
                        )}
                      </td>
                      <td className="num small">{call.turn_count}</td>
                      <td className="num small">{call.duration_seconds === null ? '—' : `${call.duration_seconds}s`}</td>
                      <td className="small muted">{relativeTime(call.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Auf dieser Nummer ist noch kein Anruf eingegangen.</p>
          )}
        </div>
      </div>
    </>
  );
}
