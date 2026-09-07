'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signup, type AuthFormState } from '../actions';

const initialState: AuthFormState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span className="brand-name">Norra</span>
        </div>
        <div className="card">
          <div className="card-head"><h1 style={{ fontSize: 19 }}>Organisation anlegen</h1></div>
          <form action={formAction} className="card-body stack">
        <label>
          Name
          <input type="text" name="fullName" autoComplete="name" required />
        </label>
        <label>
          Organisation
          <input type="text" name="organizationName" autoComplete="organization" required />
        </label>
        <label>
          E-Mail
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Passwort
          <input type="password" name="password" autoComplete="new-password" minLength={8} required />
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Wird angelegt…' : 'Konto anlegen'}
        </button>
          </form>
        </div>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
          Schon registriert? <Link href="/login">Anmelden</Link>
        </p>
      </div>
    </main>
  );
}
