import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';

/** Seconds between two "send again" clicks; the server limits per address and IP on top. */
export const RESEND_COOLDOWN_S = 60;

/** "Check your inbox" notice with a rate-limited "send again" button. */
export function CheckInbox({
  email,
  intro,
  justSent = true,
}: {
  email: string;
  intro?: string;
  /** A mail went out a moment ago, so "send again" starts in cooldown. */
  justSent?: boolean;
}) {
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_S : 0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.resendVerification(email);
      setStatus('Wir haben dir einen neuen Link geschickt. Der vorherige ist damit ungültig.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="check-inbox" data-testid="check-inbox" role="status">
      <p>
        {intro ?? 'Fast geschafft! Wir haben dir eine E-Mail geschickt an'}{' '}
        <strong data-testid="check-inbox-email">{email}</strong>.
      </p>
      <p className="muted">
        Klicke auf den Link in der E-Mail, um dein Konto zu aktivieren. Der Link ist 24 Stunden
        gültig. Nichts angekommen? Schau auch im Spam-Ordner nach.
      </p>
      {status && <p className="form-info">{status}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn"
        data-testid="resend-verification"
        onClick={() => void resend()}
        disabled={busy || cooldown > 0}
      >
        {cooldown > 0 ? `Erneut senden (${cooldown} s)` : 'Erneut senden'}
      </button>
    </div>
  );
}
