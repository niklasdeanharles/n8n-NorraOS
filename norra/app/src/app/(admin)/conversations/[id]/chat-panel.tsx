'use client';

import { useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { sendHumanReply, type HandoffState } from '../actions';
import type { MessageRole } from '@/types/database';

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  authoredByHuman: boolean;
};

const initialState: HandoffState = { error: null };

function avatarFor(message: ChatMessage): string {
  if (message.role === 'user') return 'K';
  if (message.role === 'tool') return '⚙';
  return message.authoredByHuman ? '👤' : 'AI';
}

function labelFor(message: ChatMessage): string {
  if (message.role === 'user') return 'Kunde';
  if (message.role === 'tool') return 'Tool';
  return message.authoredByHuman ? 'Mitarbeiter' : 'Agent';
}

/**
 * Chat transcript plus the reply box.
 *
 * Which box you get depends on who owns the conversation: a human who has taken
 * over writes directly into `messages`, while an untaken conversation is
 * answered by streaming a turn through /api/agent-turn.
 */
export function ChatPanel({
  conversationId,
  messages,
  humanInControl,
}: {
  conversationId: string;
  messages: ChatMessage[];
  humanInControl: boolean;
}) {
  const [replyState, replyAction, replyPending] = useActionState(sendHumanReply, initialState);
  const [draft, setDraft] = useState('');
  const [streamed, setStreamed] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [optimistic, addOptimistic] = useOptimistic(messages, (state, next: ChatMessage) => [...state, next]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [optimistic.length, streamed]);

  async function runAgentTurn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || streaming) return;

    setDraft('');
    setAgentError(null);
    setStreamed('');
    setStreaming(true);
    addOptimistic({
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      authoredByHuman: false,
    });

    try {
      const response = await fetch('/api/agent-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({ error: 'unbekannt' }));
        throw new Error(typeof detail.error === 'string' ? detail.error : 'Agent nicht erreichbar');
      }

      // The proxy pipes n8n's stream through untouched, so this reads whatever
      // the agent emits without assuming a frame format.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
        setStreamed(text);
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Unerwarteter Fehler');
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {optimistic.length === 0 && !streamed ? (
          <p className="empty">Noch keine Nachrichten.</p>
        ) : null}

        {optimistic.map((message) => (
          <div
            key={message.id}
            className={`msg ${message.role === 'user' ? 'msg-user' : ''} ${message.role === 'tool' ? 'msg-tool' : ''}`}
          >
            <div className="msg-avatar" aria-hidden="true">{avatarFor(message)}</div>
            <div>
              <div className="msg-bubble">{message.content}</div>
              <div className="msg-meta">
                {labelFor(message)} · {new Date(message.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {streaming || streamed ? (
          <div className="msg">
            <div className="msg-avatar" aria-hidden="true">AI</div>
            <div>
              <div className="msg-bubble">
                {streamed || (
                  <span className="typing" aria-label="Agent schreibt">
                    <i /><i /><i />
                  </span>
                )}
              </div>
              <div className="msg-meta">Agent {streaming ? '· schreibt…' : '· fertig'}</div>
            </div>
          </div>
        ) : null}
      </div>

      {humanInControl ? (
        <form action={replyAction} className="chat-compose">
          <input type="hidden" name="conversationId" value={conversationId} />
          <textarea
            name="message"
            className="grow"
            placeholder="Als Mitarbeiter antworten…"
            required
            maxLength={10000}
          />
          <button type="submit" disabled={replyPending}>
            {replyPending ? 'Sendet…' : 'Senden'}
          </button>
        </form>
      ) : (
        <form onSubmit={runAgentTurn} className="chat-compose">
          <textarea
            className="grow"
            placeholder="Nachricht als Kunde senden, um den Agenten zu testen…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={10000}
          />
          <button type="submit" disabled={streaming || draft.trim().length === 0}>
            {streaming ? 'Läuft…' : 'An Agent'}
          </button>
        </form>
      )}

      {replyState.error ? <p className="error" style={{ padding: '0 16px 12px' }}>{replyState.error}</p> : null}
      {agentError ? <p className="error" style={{ padding: '0 16px 12px' }}>{agentError}</p> : null}
    </div>
  );
}
