import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { registerSchema } from '@chat-mvp/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { useAuthStore } from '../store/auth';

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, username, password });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' · '));
      return;
    }
    setBusy(true);
    try {
      await register(parsed.data.email, parsed.data.username, parsed.data.password);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'EMAIL_TAKEN'
          ? 'Diese E-Mail-Adresse ist bereits registriert'
          : errorMessage(err),
      );
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate aria-labelledby="register-title">
        <h1 id="register-title">Registrieren</h1>
        <label>
          E-Mail
          <input
            data-testid="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Benutzername
          <input
            data-testid="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Passwort
          <input
            data-testid="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert" data-testid="form-error">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" data-testid="register-submit" disabled={busy}>
          {busy ? 'Registrieren…' : 'Registrieren'}
        </button>
        <p className="auth-switch">
          Schon registriert?{' '}
          <Link to={`/login${location.search}`} data-testid="to-login">
            Anmelden
          </Link>
        </p>
      </form>
    </main>
  );
}
