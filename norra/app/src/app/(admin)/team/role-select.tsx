'use client';

import { useActionState } from 'react';
import { changeRole, type TeamState } from './actions';
import type { UserRole } from '@/types/database';

const initial: TeamState = { error: null };

const ROLES: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'agent', label: 'Mitarbeiter' },
  { value: 'customer', label: 'Kunde' },
];

export function RoleSelect({ userId, role, editable }: { userId: string; role: UserRole; editable: boolean }) {
  const [state, action, pending] = useActionState(changeRole, initial);

  if (!editable) {
    return <span className="badge">{ROLES.find((r) => r.value === role)?.label ?? role}</span>;
  }

  return (
    <form action={action} className="stack" style={{ gap: 4 }}>
      <input type="hidden" name="userId" value={userId} />
      <div className="row" style={{ gap: 7, flexWrap: 'nowrap' }}>
        <select name="role" defaultValue={role} disabled={pending} style={{ width: 'auto' }}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button type="submit" className="btn-secondary btn-sm" disabled={pending}>Setzen</button>
      </div>
      {state.error ? <span className="tiny error">{state.error}</span> : null}
      {state.ok ? <span className="tiny" style={{ color: 'hsl(var(--success))' }}>{state.ok}</span> : null}
    </form>
  );
}
