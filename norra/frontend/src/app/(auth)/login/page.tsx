'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { login, type AuthFormState } from '../actions';

const initialState: AuthFormState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span className="brand-name">Norra</span>
        </div>
        <div className="card">
          <div className="card-head"><h1 style={{ fontSize: 19 }}>Anmelden</h1></div>
          <form action={formAction} className="card-body stack">
        <label>
          E-Mail
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Passwort
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Anmelden…' : 'Anmelden'}
        </button>
          </form>
        </div>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
          Noch kein Konto? <Link href="/signup">Organisation anlegen</Link>
        </p>
      </div>
    </main>
  );
}
