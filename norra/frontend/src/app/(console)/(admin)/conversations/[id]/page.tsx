import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { conversationStatusLabel, formatDateTime, statusTone } from '@/lib/format';
import { ChatPanel, type ChatMessage } from './chat-panel';
import { HandoffBar } from './handoff-bar';
import { ContactCard } from './contact-card';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, status, channel, title, end_user_email, end_user_name, end_user_external_id, assigned_user_id, created_at, last_message_at, agents(id, name, model, status), contacts(id, e164, display_name, note, call_count)')
    .eq('id', id)
    .single();

  if (!conversation) notFound();

  const [messagesResult, toolCallsResult, ticketsResult, meResult] = await Promise.all([
    supabase
      .from('messages')
      .select('id, role, content, content_json, created_at')
      .eq('conversation_id', id)
      .order('seq', { ascending: true }),
    supabase
      .from('tool_calls_log')
      .select('id, tool_name, status, created_at, n8n_execution_id')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('tickets').select('id, number, subject, status, priority').eq('conversation_id', id),
    supabase.auth.getUser(),
  ]);

  const currentUserId = meResult.data.user?.id ?? null;
  const humanInControl = conversation.assigned_user_id !== null;
  const ownedByMe = conversation.assigned_user_id === currentUserId;

  const messages: ChatMessage[] = (messagesResult.data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
    authoredByHuman:
      typeof m.content_json === 'object' && m.content_json !== null && !Array.isArray(m.content_json)
        ? (m.content_json as Record<string, unknown>).authored_by === 'human'
        : false,
  }));

  return (
    <>
      <header className="topbar">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <Link href="/conversations" className="small muted">Posteingang</Link>
            <span className="muted">/</span>
            <h1 style={{ fontSize: 17 }}>{conversation.title ?? 'Ohne Titel'}</h1>
          </div>
          <div className="small muted">
            {conversation.end_user_name ?? conversation.end_user_email ?? 'anonymer Kunde'} · Kanal {conversation.channel} ·
            gestartet {formatDateTime(conversation.created_at)}
          </div>
        </div>
        <span className={statusTone(conversation.status)}>
          <span className="dot" aria-hidden="true" />
          {conversationStatusLabel(conversation.status)}
        </span>
      </header>

      <div className="content" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 290px', gap: 20, maxWidth: 1240 }}>
        <div className="card card-body-flush">
          <ChatPanel conversationId={conversation.id} messages={messages} humanInControl={humanInControl} />
        </div>

        <aside className="stack">
          {conversation.contacts ? (
            <ContactCard contact={conversation.contacts} conversationId={conversation.id} />
          ) : null}
          <div className="card">
            <div className="card-head"><h3>Übergabe</h3></div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <p className="small dim" style={{ margin: 0 }}>
                {humanInControl
                  ? ownedByMe
                    ? 'Du bearbeitest diese Konversation. Der Agent antwortet nicht mehr.'
                    : 'Ein anderer Mitarbeiter hat übernommen.'
                  : 'Der Agent bearbeitet diese Konversation.'}
              </p>
              <HandoffBar
                conversationId={conversation.id}
                humanInControl={humanInControl}
                resolved={conversation.status === 'resolved' || conversation.status === 'closed'}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Agent</h3></div>
            <div className="card-body small stack" style={{ gap: 6 }}>
              {conversation.agents ? (
                <>
                  <div className="spread">
                    <span className="muted">Name</span>
                    <Link href={`/agents/${conversation.agents.id}`}>{conversation.agents.name}</Link>
                  </div>
                  <div className="spread"><span className="muted">Modell</span><code>{conversation.agents.model}</code></div>
                  <div className="spread"><span className="muted">Status</span><span className={statusTone(conversation.agents.status)}>{conversation.agents.status}</span></div>
                </>
              ) : (
                <span className="muted">Kein Agent zugeordnet.</span>
              )}
            </div>
          </div>

          {ticketsResult.data && ticketsResult.data.length > 0 ? (
            <div className="card">
              <div className="card-head"><h3>Tickets</h3></div>
              <div className="card-body small stack" style={{ gap: 8 }}>
                {ticketsResult.data.map((t) => (
                  <div key={t.id} className="spread">
                    <span>#{t.number} {t.subject}</span>
                    <span className={statusTone(t.priority)}>{t.priority}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="card-head"><h3>Tool-Aufrufe</h3></div>
            <div className="card-body small stack" style={{ gap: 8 }}>
              {toolCallsResult.data && toolCallsResult.data.length > 0 ? (
                toolCallsResult.data.map((call) => (
                  <div key={call.id} className="spread">
                    <code>{call.tool_name}</code>
                    <span className={statusTone(call.status)}>{call.status}</span>
                  </div>
                ))
              ) : (
                <span className="muted">Noch keine Tools aufgerufen.</span>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
