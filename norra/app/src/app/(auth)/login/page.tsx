'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { login, type AuthFormState } from '../actions';

const initialState: AuthFormState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="container" style={{ maxWidth: 400 }}>
      <h1>Anmelden</h1>
      <form action={formAction} className="card stack">
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
      <p className="muted">
        Noch kein Konto? <Link href="/signup">Organisation anlegen</Link>
      </p>
    </main>
  );
}
