import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { verifyEmailSchema } from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { safePath } from '../navigation';
import { useAuthStore } from '../store/auth';

function tokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.slice(1)).get('token');
}

/**
 * Target of the confirmation link. The token is only redeemed on an explicit click, so mail
 * scanners that open links (and even run scripts) cannot use it up before the user does.
 */
export function VerifyEmailPage() {
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const navigate = useNavigate();
  const location = useLocation();
  // Kept in state because the effect below removes it from the URL.
  const [token, setToken] = useState(() => tokenFromHash(location.hash));
  const valid = token !== null && verifyEmailSchema.safeParse({ token }).success;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The server rejected the link for good (used, expired, unknown); retrying is pointless. */
  const [dead, setDead] = useState(false);

  // Take the token out of the address bar and history right away (screenshots, shared
  // screens, browser sync). Kept out of the state initialiser: StrictMode runs that twice.
  // Opening another link in the same tab only changes the hash and does not reload the page,
  // so a new token also replaces the old one and its error.
  useEffect(() => {
    if (!location.hash) return;
    const fromUrl = tokenFromHash(location.hash);
    if (fromUrl !== null) {
      setToken(fromUrl);
      setError(null);
      setDead(false);
    }
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const next = await verifyEmail(token);
      navigate(safePath(next), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setDead(err instanceof ApiRequestError && err.code === 'VERIFICATION_INVALID');
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="verify-title">
        <h1 id="verify-title">E-Mail bestätigen</h1>
        {valid && !error && (
          <p className="muted">Ein Klick noch, dann ist dein disslxt-Konto aktiv.</p>
        )}
        {(error || !valid) && (
          <p className="form-error" role="alert" data-testid="form-error">
            {error ??
              'Dieser Bestätigungslink ist unvollständig. Öffne ihn bitte direkt aus der E-Mail.'}
          </p>
        )}
        {valid && !dead && (
          <button
            className="btn primary"
            type="button"
            data-testid="verify-submit"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Bestätigen…' : 'Konto aktivieren'}
          </button>
        )}
        <p className="auth-switch">
          <Link to="/login">Zur Anmeldung</Link>
          {' · '}
          <Link to="/register">Neu registrieren</Link>
        </p>
      </section>
    </main>
  );
}
