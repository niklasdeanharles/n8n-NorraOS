import {
  Bot,
  BookOpen,
  Clock,
  Gauge,
  MessagesSquare,
  PhoneMissed,
  PhoneCall,
  Radio,
  Ticket,
} from 'lucide-react';
import Link from 'next/link';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { PageHeader } from '@/components/console/page-header';
import { createClient } from '@/lib/supabase/server';
import { conversationStatusLabel, priorityLabel, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Mitternacht lokal, nicht UTC: „heute" ist der Tag des Betreibers, nicht der von Greenwich. */
function startOfLocalDay(offsetDays = 0): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - offsetDays);
  return now;
}

function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

const DURATION_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function minutesAndSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const weekAgo = startOfLocalDay(6);
  const monthAgo = startOfLocalDay(29);

  // RLS begrenzt jede Abfrage auf die Organisation des Anmeldenden — deshalb
  // filtert hier keine einzige von Hand nach organization_id.
  const [agents, recentCalls, conversations, openConversations, tickets, documents, rated] =
    await Promise.all([
      supabase.from('agents').select('id, name, status, channels').order('created_at'),
      supabase
        .from('calls')
        .select('id, status, direction, started_at, ended_at, duration_seconds, from_e164')
        .gte('started_at', weekAgo.toISOString())
        .order('started_at', { ascending: false }),
      supabase
        .from('conversations')
        .select('id, channel, status, title, last_message_at, assigned_user_id')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(7),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'pending', 'escalated']),
      supabase.from('tickets').select('id, number, subject, priority').eq('status', 'open').limit(6),
      supabase.from('knowledge_base_documents').select('id, chunk_count'),
      supabase.from('conversations').select('csat').not('csat', 'is', null).gte('created_at', monthAgo.toISOString()),
    ]);

  const calls = recentCalls.data ?? [];
  const todayKey = startOfLocalDay().toLocaleDateString('en-CA');

  const live = calls.filter((call) => call.ended_at === null && call.status !== 'failed').length;
  const today = calls.filter((call) => localDateKey(call.started_at) === todayKey);
  const missed = calls.filter((call) => ['no_answer', 'busy', 'failed'].includes(call.status)).length;

  const completed = calls.filter((call) => call.duration_seconds !== null);
  const averageSeconds =
    completed.length > 0
      ? completed.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0) / completed.length
      : null;

  const ratings = (rated.data ?? []).map((row) => row.csat).filter((value): value is number => value !== null);
  const averageCsat = ratings.length > 0 ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;

  // Sieben Balken, auch wenn an einem Tag nichts war: eine Lücke in der Reihe
  // läse sich als fehlende Messung, nicht als ruhiger Tag.
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = startOfLocalDay(6 - index);
    const key = day.toLocaleDateString('en-CA');
    return {
      key,
      label: day.toLocaleDateString('de-DE', { weekday: 'short' }),
      count: calls.filter((call) => localDateKey(call.started_at) === key).length,
    };
  });
  const weekPeak = Math.max(...week.map((day) => day.count), 1);

  const liveAgents = (agents.data ?? []).filter((agent) => agent.status === 'live');
  const chunks = (documents.data ?? []).reduce((sum, document) => sum + document.chunk_count, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Was heute über deine Leitungen und Kanäle gelaufen ist."
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/conversations">Posteingang</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/agents">Assistent anlegen</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Laufende Anrufe"
          value={String(live)}
          hint={live > 0 ? 'gerade in der Leitung' : 'gerade ist es still'}
          icon={<Radio />}
        />
        <Stat
          label="Anrufe heute"
          value={String(today.length)}
          hint={`${calls.length} in sieben Tagen`}
          series={week.map((day) => day.count)}
          icon={<PhoneCall />}
        />
        <Stat
          label="Ø Gesprächsdauer"
          value={averageSeconds === null ? '–' : minutesAndSeconds(averageSeconds)}
          unit={averageSeconds === null ? undefined : 'min'}
          hint={completed.length > 0 ? `aus ${DURATION_FORMAT.format(completed.length)} Gesprächen` : 'noch keine Gespräche'}
          icon={<Clock />}
        />
        <Stat
          label="Zufriedenheit"
          value={averageCsat === null ? '–' : averageCsat.toFixed(1)}
          unit={averageCsat === null ? undefined : 'von 5'}
          hint={ratings.length > 0 ? `${ratings.length} Bewertungen, 30 Tage` : 'noch keine Bewertungen'}
          icon={<Gauge />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Offene Gespräche"
          value={String(openConversations.count ?? 0)}
          hint="offen, wartend oder eskaliert"
          icon={<MessagesSquare />}
        />
        <Stat
          label="Offene Tickets"
          value={String((tickets.data ?? []).length)}
          hint="warten auf Bearbeitung"
          icon={<Ticket />}
        />
        <Stat
          label="Nicht angenommen"
          value={String(missed)}
          hint="sieben Tage"
          icon={<PhoneMissed />}
        />
        <Stat
          label="Wissensblöcke"
          value={String(chunks)}
          hint={`${(documents.data ?? []).length} Dokumente`}
          icon={<BookOpen />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Anrufe der letzten sieben Tage</CardTitle>
            </div>
            <Link href="/analytics" className="text-[13px] font-medium text-brand hover:underline">
              Analytics
            </Link>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-2" role="img" aria-label={`Anrufe pro Tag: ${week.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
              {week.map((day) => (
                <div key={day.key} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2">
                  {/* Die Spur ist `relative` und der Balken `absolute`: eine
                      Prozenthoehe braucht einen Elternteil mit aufgeloester
                      Hoehe, und ein Flex-Kind allein hat keine. */}
                  <div className="relative w-full flex-1">
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-brand/85 transition-[height] duration-500 ease-norra"
                      style={{ height: `${Math.max((day.count / weekPeak) * 100, day.count > 0 ? 6 : 2)}%` }}
                    />
                  </div>
                  <span className="tabular text-[12px] font-medium text-text">{day.count}</span>
                  <span className="text-[11px] text-faint">{day.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assistenten</CardTitle>
            <Link href="/agents" className="text-[13px] font-medium text-brand hover:underline">
              Alle
            </Link>
          </CardHeader>
          <CardContent>
            {(agents.data ?? []).length === 0 ? (
              <EmptyHint icon={<Bot />} text="Noch kein Assistent angelegt." />
            ) : (
              <ul className="space-y-3">
                {(agents.data ?? []).slice(0, 6).map((agent) => (
                  <li key={agent.id} className="flex items-center gap-2.5">
                    <StatusDot tone={agent.status === 'live' ? 'success' : 'neutral'} />
                    <Link href={`/agents/${agent.id}`} className="min-w-0 flex-1 truncate text-[13.5px] text-text hover:underline">
                      {agent.name}
                    </Link>
                    <span className="text-[11.5px] text-faint">{agent.status === 'live' ? 'live' : 'Entwurf'}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-border-hair pt-3 text-[12px] text-faint">
              {liveAgents.length} von {(agents.data ?? []).length} live
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Letzte Gespräche</CardTitle>
            <Link href="/conversations" className="text-[13px] font-medium text-brand hover:underline">
              Posteingang
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {(conversations.data ?? []).length === 0 ? (
              <EmptyHint icon={<MessagesSquare />} text="Noch keine Gespräche." className="px-6 pb-4" />
            ) : (
              <ul className="divide-y divide-[color:var(--border)]">
                {(conversations.data ?? []).map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/conversations/${conversation.id}`}
                      className="flex items-center gap-3 px-6 py-3 transition-colors duration-200 ease-norra hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
                        {conversation.title ?? 'Ohne Titel'}
                      </span>
                      <Badge tone="neutral">{conversation.channel}</Badge>
                      <span className="w-24 shrink-0 text-right text-[12px] text-muted">
                        {conversationStatusLabel(conversation.status)}
                      </span>
                      <span className="hidden w-24 shrink-0 text-right text-[12px] text-faint sm:block">
                        {relativeTime(conversation.last_message_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Offene Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            {(tickets.data ?? []).length === 0 ? (
              <EmptyHint icon={<Ticket />} text="Keine offenen Tickets." />
            ) : (
              <ul className="space-y-3">
                {(tickets.data ?? []).map((ticket) => (
                  <li key={ticket.id} className="flex items-start gap-2.5">
                    <span className="tabular mt-px w-10 shrink-0 text-[12px] text-faint">#{ticket.number}</span>
                    <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-text">{ticket.subject}</span>
                    <Badge tone={ticket.priority === 'urgent' || ticket.priority === 'high' ? 'warning' : 'neutral'}>
                      {priorityLabel(ticket.priority)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function EmptyHint({ icon, text, className }: { icon: React.ReactNode; text: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2 py-6 text-center ${className ?? ''}`}>
      <span className="text-faint [&_svg]:size-5" aria-hidden="true">
        {icon}
      </span>
      <p className="text-[13px] text-muted">{text}</p>
    </div>
  );
}
