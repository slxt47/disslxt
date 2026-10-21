import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { registerSchema } from '@disslxt/shared';
import { safeNext } from '../navigation';
import { errorMessage } from '../api/client';
import { CheckInbox } from '../components/CheckInbox';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { useAuthStore } from '../store/auth';

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, username, password });
    if (!parsed.success) {
      // Password rules are already listed under the field; name only the other problems.
      const other = parsed.error.issues.filter((i) => i.path[0] !== 'password');
      const pw = parsed.error.issues.some((i) => i.path[0] === 'password');
      setError(
        [
          ...other.map((i) => i.message),
          ...(pw ? ['Das Passwort erfüllt noch nicht alle Regeln'] : []),
        ].join(' · '),
      );
      return;
    }
    setBusy(true);
    try {
      const next = safeNext(location.search);
      await register(
        parsed.data.email,
        parsed.data.username,
        parsed.data.password,
        next === '/' ? undefined : next,
      );
      setSentTo(parsed.data.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="inbox-title">
          <h1 id="inbox-title">Bestätige deine E-Mail</h1>
          <CheckInbox email={sentTo} />
          <p className="auth-switch">
            Schon bestätigt?{' '}
            <Link to={`/login${location.search}`} data-testid="to-login">
              Anmelden
            </Link>
          </p>
        </section>
      </main>
    );
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
            aria-describedby="password-rules"
            required
          />
        </label>
        <div id="password-rules">
          <PasswordChecklist password={password} context={{ username, email }} />
        </div>
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
