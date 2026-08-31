'use client';

import { useEffect, useRef, useState } from 'react';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

/** Namespaced per agent: one browser can have open widgets for several agents. */
function storageKey(agentId: string): string {
  return `norra-widget:${agentId}`;
}

function loadStoredConversation(agentId: string): { conversationId: string; token: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(agentId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { conversationId?: unknown }).conversationId === 'string' &&
      typeof (parsed as { token?: unknown }).token === 'string'
    ) {
      return parsed as { conversationId: string; token: string };
    }
  } catch {
    // Private browsing or a cleared store: fall through to a fresh session.
  }
  return null;
}

function storeConversation(agentId: string, conversationId: string, token: string): void {
  try {
    localStorage.setItem(storageKey(agentId), JSON.stringify({ conversationId, token }));
  } catch {
    // Storage can be unavailable; the chat still works within the page load.
  }
}

/**
 * The widget itself: a standalone chat, no admin chrome, embedded in an
 * iframe on a customer's own site.
 *
 * State lives in two places on purpose. `token` is the trust boundary — every
 * request after the first carries it, and the server derives the tenant and
 * conversation from it, never from anything this component sends. `messages`
 * is purely what gets painted; losing it on reload is fine, because the next
 * session fetch does not replay history (a stranger picking up a shared
 * computer should not see somebody else's conversation continue by itself).
 */
export function WidgetChat({ agentId }: { agentId: string }) {
  const [agentName, setAgentName] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [streamed, setStreamed] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = loadStoredConversation(agentId);
    fetch('/api/widget/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, conversationId: stored?.conversationId }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const data: { conversationId: string; token: string; agentName: string } = await response.json();
        conversationIdRef.current = data.conversationId;
        setToken(data.token);
        setAgentName(data.agentName);
        storeConversation(agentId, data.conversationId, data.token);
      })
      .catch(() => setUnavailable(true));
    // agentId is the route param and does not change during the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamed]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming || !token) return;

    setDraft('');
    setError(null);
    setStreamed('');
    setStreaming(true);
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: 'user', content: text }]);

    try {
      const response = await fetch('/api/widget/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, message: text }),
      });

      const refreshed = response.headers.get('x-norra-widget-token');
      if (refreshed) {
        setToken(refreshed);
        if (conversationIdRef.current) storeConversation(agentId, conversationIdRef.current, refreshed);
      }

      if (!response.ok || !response.body) {
        if (response.status === 401) {
          // The token expired between mount and send. Clear it and let the
          // effect below mint a fresh session instead of failing silently.
          try {
            localStorage.removeItem(storageKey(agentId));
          } catch {
            /* ignore */
          }
          setUnavailable(true);
          return;
        }
        throw new Error('Der Assistent antwortet gerade nicht.');
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let text2 = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text2 += value;
        setStreamed(text2);
      }
      setMessages((current) => [...current, { id: `a-${Date.now()}`, role: 'assistant', content: text2 }]);
      setStreamed('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unerwarteter Fehler');
    } finally {
      setStreaming(false);
    }
  }

  if (unavailable) {
    return (
      <div className="widget-shell">
        <div className="widget-notice">Der Chat ist gerade nicht erreichbar.</div>
      </div>
    );
  }

  return (
    <div className="widget-shell">
      <header className="widget-head">
        <span className="widget-dot" aria-hidden="true" />
        {agentName ?? 'Assistent'}
      </header>
      <div className="widget-log" ref={logRef}>
        {messages.length === 0 && !streamed ? (
          <div className="widget-empty">Wie kann ich helfen?</div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={`widget-msg ${message.role === 'user' ? 'widget-msg-user' : ''}`}>
            {message.content}
          </div>
        ))}
        {streaming ? (
          <div className="widget-msg">
            {streamed || (
              <span className="typing" aria-label="Assistent schreibt">
                <i /><i /><i />
              </span>
            )}
          </div>
        ) : null}
      </div>
      {error ? <div className="widget-error">{error}</div> : null}
      <form className="widget-compose" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Nachricht schreiben…"
          rows={1}
          maxLength={4000}
          disabled={!token}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={!token || streaming || draft.trim().length === 0} aria-label="Senden">
          ➤
        </button>
      </form>
    </div>
  );
}
