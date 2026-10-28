import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  forgotPasswordSchema,
  passwordProblems,
  PASSWORD_RESET_TTL_MINUTES,
} from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { useAuthStore } from '../store/auth';

/** "Passwort vergessen": asks for the address; the answer is the same whether it exists or not. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse');
      return;
    }
    setBusy(true);
    try {
      await api.forgotPassword(parsed.data.email);
      setSent(parsed.data.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate aria-labelledby="forgot-title">
        <h1 id="forgot-title">Passwort vergessen</h1>
        {sent ? (
          <p data-testid="reset-sent">
            Wenn es für <strong>{sent}</strong> ein Konto gibt, ist jetzt eine E-Mail mit einem Link
            unterwegs. Er ist {PASSWORD_RESET_TTL_MINUTES} Minuten gültig. Schau auch im Spam-Ordner
            nach.
          </p>
        ) : (
          <>
            <p className="muted">
              Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein
              neues Passwort festlegst.
            </p>
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
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn primary"
              type="submit"
              data-testid="forgot-submit"
              disabled={busy}
            >
              {busy ? 'Senden…' : 'Link schicken'}
            </button>
          </>
        )}
        <p className="auth-switch">
          <Link to="/login">Zurück zur Anmeldung</Link>
        </p>
      </form>
    </main>
  );
}

/** Target of the reset link: new password, then signed in (all other devices are signed out). */
export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get('token'),
  );
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Take the token out of the address bar right away (screenshots, history, shared screens).
  useEffect(() => {
    if (!location.hash) return;
    const fromUrl = new URLSearchParams(location.hash.slice(1)).get('token');
    if (fromUrl) setToken(fromUrl);
    navigate({ pathname: location.pathname }, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  const problems = passwordProblems(password);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (problems.length > 0) return setError(problems[0]!);
    if (password !== repeat) return setError('Die beiden Passwörter sind verschieden.');
    setBusy(true);
    try {
      const { user } = await api.resetPassword(token ?? '', password);
      useAuthStore.setState({ user, status: 'authenticated', loggedOut: false });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Link unvollständig</h1>
          <p>Öffne den Link aus der E-Mail bitte vollständig – oder fordere einen neuen an.</p>
          <Link className="btn primary" to="/forgot-password">
            Neuen Link anfordern
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate aria-labelledby="reset-title">
        <h1 id="reset-title">Neues Passwort</h1>
        <label>
          Neues Passwort
          <input
            data-testid="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <PasswordChecklist password={password} context={{}} />
        <label>
          Wiederholen
          <input
            data-testid="password-repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert" data-testid="form-error">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" data-testid="reset-submit" disabled={busy}>
          {busy ? 'Speichern…' : 'Passwort speichern'}
        </button>
        <p className="settings-hint">Danach bist du auf allen anderen Geräten abgemeldet.</p>
      </form>
    </main>
  );
}
