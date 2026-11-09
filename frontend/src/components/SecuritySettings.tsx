import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import qrcode from 'qrcode-generator';
import type {
  PasskeyDto,
  SessionDto,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
} from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Icon } from './Icon';
import { LineSkeleton } from './Skeleton';

/** Drawn with React elements, so nothing but the matrix comes out of the library. */
function QrCode({ text }: { text: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qr.isDark(row, col)) dark.push([col, row]);
      }
    }
    return { size, dark };
  }, [text]);
  return (
    <svg
      className="qr-code"
      viewBox={`-2 -2 ${cells.size + 4} ${cells.size + 4}`}
      role="img"
      aria-label="QR-Code für die Authenticator-App"
      data-testid="two-factor-qr"
    >
      <rect x="-2" y="-2" width={cells.size + 4} height={cells.size + 4} fill="#fff" />
      {cells.dark.map(([x, y]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width="1.02" height="1.02" fill="#000" />
      ))}
    </svg>
  );
}

function CodeList({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="recovery-codes" data-testid="recovery-codes">
      <p className="form-info">
        Bewahre diese Ersatzcodes sicher auf. Jeder gilt einmal, falls dein Handy weg ist. Du siehst
        sie nur jetzt.
      </p>
      <ul>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="inline-actions">
        <button
          className="btn small"
          onClick={() =>
            void navigator.clipboard.writeText(codes.join('\n')).then(() => setCopied(true))
          }
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
        <button className="btn small primary" data-testid="recovery-done" onClick={onDone}>
          Habe ich gesichert
        </button>
      </div>
    </div>
  );
}

function TwoFactorSection() {
  const [status, setStatus] = useState<TwoFactorStatusDto | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [form, setForm] = useState<'setup' | 'disable' | 'codes' | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.twoFactorStatus().then(setStatus, (err: unknown) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  function reset() {
    setForm(null);
    setSetup(null);
    setPassword('');
    setCode('');
    setError(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (form === 'setup' && !setup) {
        setSetup(await api.twoFactorSetup(password));
        setPassword('');
      } else if (form === 'setup') {
        const { recoveryCodes } = await api.twoFactorEnable(code);
        setCodes(recoveryCodes);
        reset();
        load();
      } else if (form === 'disable') {
        await api.twoFactorDisable(password, code);
        reset();
        load();
      } else if (form === 'codes') {
        const { recoveryCodes } = await api.twoFactorRecoveryCodes(password, code);
        setCodes(recoveryCodes);
        reset();
        load();
      }
    });
  }

  if (!status) return error ? <p className="form-error">{error}</p> : <LineSkeleton rows={2} />;
  if (codes) return <CodeList codes={codes} onDone={() => setCodes(null)} />;

  const needsPassword = form === 'disable' || form === 'codes' || (form === 'setup' && !setup);
  const needsCode = form === 'disable' || form === 'codes' || (form === 'setup' && !!setup);

  return (
    <>
      <p className="settings-hint" data-testid="two-factor-state">
        {status.enabled
          ? `Aktiv. Noch ${status.recoveryCodesLeft} Ersatzcodes übrig.`
          : 'Aus. Mit einer Authenticator-App schützt ein zweiter Code dein Konto, auch wenn jemand dein Passwort kennt.'}
      </p>
      {!form && !status.enabled && status.available && (
        <button className="btn" data-testid="two-factor-start" onClick={() => setForm('setup')}>
          Einrichten
        </button>
      )}
      {!form && status.enabled && (
        <div className="inline-actions">
          <button
            className="btn"
            data-testid="two-factor-new-codes"
            onClick={() => setForm('codes')}
          >
            Neue Ersatzcodes
          </button>
          <button
            className="btn danger-outline"
            data-testid="two-factor-off"
            onClick={() => setForm('disable')}
          >
            Ausschalten
          </button>
        </div>
      )}
      {!status.available && !status.enabled && (
        <p className="settings-hint">Auf diesem Server noch nicht verfügbar.</p>
      )}
      {form && (
        <form className="two-factor-form" onSubmit={submit}>
          {setup && (
            <>
              <QrCode text={setup.uri} />
              <p className="settings-hint">
                Scanne den Code mit deiner App, zum Beispiel Aegis, Google Authenticator oder dem
                iPhone-Passwortmanager. Oder gib den Schlüssel von Hand ein:
              </p>
              <code className="invite-link" data-testid="two-factor-secret">
                {setup.secret}
              </code>
            </>
          )}
          {needsPassword && (
            <label className="field">
              <span>Passwort</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                data-testid="two-factor-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {needsCode && (
            <label className="field">
              <span>
                {form === 'setup' ? 'Code aus der App' : 'Code aus der App oder Ersatzcode'}
              </span>
              <input
                autoComplete="one-time-code"
                inputMode={form === 'setup' ? 'numeric' : 'text'}
                value={code}
                data-testid="two-factor-code"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <div className="inline-actions">
            <button className="btn primary" data-testid="two-factor-submit" disabled={busy}>
              {form === 'disable' ? 'Ausschalten' : 'Weiter'}
            </button>
            <button type="button" className="btn" onClick={reset}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert" data-testid="two-factor-error">
          {error}
        </p>
      )}
    </>
  );
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function SessionsSection() {
  const [list, setList] = useState<SessionDto[] | null>(null);
  const load = useCallback(() => {
    api.listSessions().then(
      (r) => setList(r.sessions),
      (err: unknown) => useChatStore.getState().setError(errorMessage(err)),
    );
  }, []);
  useEffect(load, [load]);

  const run = (action: () => Promise<unknown>) => {
    action().then(load, (err: unknown) => useChatStore.getState().setError(errorMessage(err)));
  };

  if (!list) return <LineSkeleton rows={2} />;
  const others = list.filter((s) => !s.current);
  return (
    <>
      <ul className="session-list" data-testid="session-list">
        {list.map((s) => (
          <li key={s.id} data-testid={s.current ? 'session-current' : 'session-other'}>
            <span>
              <strong>{s.device ?? 'Unbekanntes Gerät'}</strong>
              {s.current && <span className="pill-note">dieses Gerät</span>}
              <small>
                {s.lastSeenAt ? `Zuletzt aktiv ${dateFormat.format(new Date(s.lastSeenAt))}` : ''}
              </small>
            </span>
            {!s.current && (
              <button
                className="btn small"
                data-testid="session-end"
                onClick={() => run(() => api.endSession(s.id))}
              >
                Abmelden
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <button
          className="btn danger-outline"
          data-testid="sessions-end-others"
          onClick={() => run(api.endOtherSessions)}
        >
          Überall sonst abmelden
        </button>
      )}
    </>
  );
}

/** Second factor, signed-in devices and the copy of your data. */
function PasskeySection() {
  const [keys, setKeys] = useState<PasskeyDto[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.passkeys().then(
      (r) => setKeys(r.passkeys),
      () => undefined,
    );
  }, []);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { challengeId, options } = await api.passkeyOptions(password);
      const response = await startRegistration({ optionsJSON: options });
      await api.addPasskey(challengeId, response, name.trim());
      setAdding(false);
      setName('');
      load();
    } catch (err) {
      if (!(err instanceof Error && err.name === 'NotAllowedError')) setError(errorMessage(err));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  if (!browserSupportsWebAuthn()) {
    return <p className="settings-hint">Dieser Browser kann keine Passkeys.</p>;
  }
  return (
    <>
      <p className="settings-hint">
        Anmelden mit Fingerabdruck, Gesicht oder Geräte-PIN. Ersetzt Passwort und Code.
      </p>
      {!keys && <LineSkeleton rows={1} />}
      {keys && keys.length > 0 && (
        <ul className="session-list" data-testid="passkey-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.name}</strong>
                <small>
                  {k.lastUsedAt
                    ? `Zuletzt ${new Date(k.lastUsedAt).toLocaleDateString('de-DE')}`
                    : 'Noch nicht benutzt'}
                </small>
              </span>
              <button
                className="btn small"
                data-testid="passkey-delete"
                onClick={() => void api.deletePasskey(k.id).then(load, () => undefined)}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="two-factor-form" onSubmit={(e) => void add(e)}>
          <label>
            Name
            <input
              placeholder="z. B. iPhone"
              maxLength={64}
              value={name}
              data-testid="passkey-name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Passwort
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              data-testid="passkey-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="inline-actions">
            <button
              className="btn primary"
              data-testid="passkey-submit"
              disabled={busy || !name.trim() || !password}
            >
              Weiter
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" data-testid="passkey-add" onClick={() => setAdding(true)}>
          Passkey hinzufügen
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function SecuritySettings() {
  return (
    <section className="settings-section" aria-labelledby="settings-security">
      <h3 id="settings-security">Sicherheit</h3>
      <h4 className="settings-subheading">Zwei-Faktor-Anmeldung</h4>
      <TwoFactorSection />
      <h4 className="settings-subheading">Passkeys</h4>
      <PasskeySection />
      <h4 className="settings-subheading">Angemeldete Geräte</h4>
      <SessionsSection />
      <h4 className="settings-subheading">Deine Daten</h4>
      <p className="settings-hint">
        Lade alles als JSON-Datei herunter: Konto, Server, Freunde, Nachrichten und Reaktionen.
      </p>
      <a className="btn" href="/api/account/export" download data-testid="export-data">
        <Icon name="download" size={16} />
        Daten herunterladen
      </a>
    </section>
  );
}
