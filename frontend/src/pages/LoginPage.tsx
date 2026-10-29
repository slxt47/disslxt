import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { loginSchema } from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { CheckInbox } from '../components/CheckInbox';
import { useAuthStore } from '../store/auth';
import { LegalLinks } from '../components/LegalLinks';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' · '));
      return;
    }
    setBusy(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      // GuestOnly redirects to ?next= once the store says "authenticated".
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(parsed.data.email);
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
        <h1 id="login-title">Anmelden</h1>
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
          Passwort
          <input
            data-testid="password"
            type="password"
            autoComplete="current-password"
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
        {unverified && (
          <CheckInbox
            email={unverified}
            justSent={false}
            intro="Dein Konto ist noch nicht aktiviert. Den Bestätigungslink haben wir geschickt an"
          />
        )}
        <button className="btn primary" type="submit" data-testid="login-submit" disabled={busy}>
          {busy ? 'Anmelden…' : 'Anmelden'}
        </button>
        <p className="auth-switch">
          <Link to="/forgot-password" data-testid="to-forgot">
            Passwort vergessen?
          </Link>
        </p>
        <p className="auth-switch">
          Noch kein Konto?{' '}
          <Link to={`/register${location.search}`} data-testid="to-register">
            Registrieren
          </Link>
        </p>
      </form>
      <LegalLinks />
    </main>
  );
}
