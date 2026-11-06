import { useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Link, useLocation } from 'react-router-dom';
import { loginSchema } from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { CheckInbox } from '../components/CheckInbox';
import { useAuthStore } from '../store/auth';
import { LegalLinks } from '../components/LegalLinks';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loginTwoFactor = useAuthStore((s) => s.loginTwoFactor);
  const loginPasskey = useAuthStore((s) => s.loginPasskey);
  /** Set once the password was right and the second factor is missing. */
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const accountDeleted = useAuthStore((s) => s.accountDeleted);
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
      const next = await login(parsed.data.email, parsed.data.password);
      // GuestOnly redirects to ?next= once the store says "authenticated".
      if (next) {
        setTicket(next);
        setPassword('');
        setBusy(false);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(parsed.data.email);
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  async function onPasskey() {
    setError(null);
    setBusy(true);
    try {
      await loginPasskey();
    } catch (err) {
      // Closing the system dialog is a choice, not a failure.
      if (!(err instanceof Error && err.name === 'NotAllowedError')) setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (!ticket || !code.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await loginTwoFactor(ticket, code);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
      // The ticket ran out: back to the password.
      if (err instanceof ApiRequestError && err.message.includes('von vorne')) setTicket(null);
    }
  }

  if (ticket) {
    return (
      <main className="auth-page">
        <form className="auth-card" onSubmit={onCode} noValidate aria-labelledby="code-title">
          <h1 id="code-title">Code eingeben</h1>
          <p className="muted">Den Code aus deiner Authenticator-App, oder einen Ersatzcode.</p>
          <label>
            Code
            <input
              data-testid="login-code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert" data-testid="form-error">
              {error}
            </p>
          )}
          <button
            className="btn primary"
            type="submit"
            data-testid="login-code-submit"
            disabled={busy}
          >
            {busy ? 'Prüfe…' : 'Anmelden'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTicket(null);
              setError(null);
            }}
          >
            Zurück
          </button>
        </form>
        <LegalLinks />
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
        <h1 id="login-title">Anmelden</h1>
        {accountDeleted && (
          <p className="form-info" role="status" data-testid="account-deleted">
            Dein Konto wurde gelöscht – mit allen Nachrichten, Dateien und eigenen Servern.
          </p>
        )}
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
        {browserSupportsWebAuthn() && (
          <button
            type="button"
            className="btn"
            data-testid="login-passkey"
            disabled={busy}
            onClick={() => void onPasskey()}
          >
            Mit Passkey anmelden
          </button>
        )}
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
