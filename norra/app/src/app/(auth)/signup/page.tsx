'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signup, type AuthFormState } from '../actions';

const initialState: AuthFormState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <main className="container" style={{ maxWidth: 400 }}>
      <h1>Organisation anlegen</h1>
      <form action={formAction} className="card stack">
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
      <p className="muted">
        Schon registriert? <Link href="/login">Anmelden</Link>
      </p>
    </main>
  );
}
