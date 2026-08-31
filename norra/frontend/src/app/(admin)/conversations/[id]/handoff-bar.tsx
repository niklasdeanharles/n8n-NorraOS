'use client';

import { useActionState } from 'react';
import { takeOver, releaseToAgent, resolveConversation, type HandoffState } from '../actions';

const initial: HandoffState = { error: null };

export function HandoffBar({
  conversationId,
  humanInControl,
  resolved,
}: {
  conversationId: string;
  humanInControl: boolean;
  resolved: boolean;
}) {
  const [takeState, takeAction, takePending] = useActionState(takeOver, initial);
  const [releaseState, releaseAction, releasePending] = useActionState(releaseToAgent, initial);
  const [resolveState, resolveAction, resolvePending] = useActionState(resolveConversation, initial);

  const message = takeState.ok ?? releaseState.ok ?? resolveState.ok;
  const error = takeState.error ?? releaseState.error ?? resolveState.error;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        {humanInControl ? (
          <form action={releaseAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <button type="submit" className="btn-secondary btn-sm" disabled={releasePending}>
              {releasePending ? <span className="spinner" aria-hidden="true" /> : null}
              An Agent zurückgeben
            </button>
          </form>
        ) : (
          <form action={takeAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <button type="submit" className="btn-sm" disabled={takePending}>
              {takePending ? <span className="spinner" aria-hidden="true" /> : null}
              {takePending ? 'Übernimmt…' : 'Übernehmen'}
            </button>
          </form>
        )}

        {resolved ? null : (
          <form action={resolveAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <button type="submit" className="btn-secondary btn-sm" disabled={resolvePending}>
              {resolvePending ? <span className="spinner" aria-hidden="true" /> : null}
              Als gelöst markieren
            </button>
          </form>
        )}
      </div>
      {message ? <p className="notice notice-ok">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
