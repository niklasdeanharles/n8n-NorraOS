'use client';

import { useActionState } from 'react';
import { approveAction, rejectAction, type ApprovalState } from './actions';

const initial: ApprovalState = { error: null };

export function DecisionButtons({ approvalId, canDecide }: { approvalId: string; canDecide: boolean }) {
  const [approveState, approve, approvePending] = useActionState(approveAction, initial);
  const [rejectState, reject, rejectPending] = useActionState(rejectAction, initial);

  const message = approveState.ok ?? rejectState.ok;
  const error = approveState.error ?? rejectState.error;

  if (!canDecide) {
    return <span className="tiny muted">Nur Admins entscheiden</span>;
  }

  return (
    <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
      <div className="row" style={{ gap: 7, flexWrap: 'nowrap' }}>
        <form action={reject}>
          <input type="hidden" name="approvalId" value={approvalId} />
          <button type="submit" className="btn-secondary btn-sm" disabled={rejectPending || approvePending}>
          {rejectPending ? <span className="spinner" aria-hidden="true" /> : null}
            Ablehnen
          </button>
        </form>
        <form action={approve}>
          <input type="hidden" name="approvalId" value={approvalId} />
          <button type="submit" className="btn-sm" disabled={approvePending || rejectPending}>
          {approvePending ? <span className="spinner" aria-hidden="true" /> : null}
            {approvePending ? 'Gibt frei…' : 'Freigeben'}
          </button>
        </form>
      </div>
      {message ? <span className="tiny" style={{ color: 'hsl(var(--success))' }}>{message}</span> : null}
      {error ? <span className="tiny error">{error}</span> : null}
    </div>
  );
}
