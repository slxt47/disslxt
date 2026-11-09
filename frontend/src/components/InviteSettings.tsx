import { useState } from 'react';
import type { GuildDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';

const EXPIRY = [
  { label: 'Nie', hours: null },
  { label: '1 Stunde', hours: 1 },
  { label: '1 Tag', hours: 24 },
  { label: '7 Tage', hours: 24 * 7 },
  { label: '30 Tage', hours: 24 * 30 },
];
const USES = [null, 1, 5, 10, 25, 100];

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** "gilt bis …, 2 von 10 genutzt"; also says when the link no longer works. */
export function inviteStatus(g: GuildDto, now = Date.now()): string {
  const expires = g.inviteExpiresAt ? new Date(g.inviteExpiresAt) : null;
  if (expires && expires.getTime() <= now) return 'Link abgelaufen';
  if (g.inviteMaxUses !== null && g.inviteUses >= g.inviteMaxUses) return 'Link aufgebraucht';
  const parts = [
    expires ? `gilt bis ${dateFormat.format(expires)}` : 'läuft nicht ab',
    g.inviteMaxUses === null
      ? 'unbegrenzt nutzbar'
      : `${g.inviteUses} von ${g.inviteMaxUses} genutzt`,
  ];
  return parts.join(', ');
}

/** Owner: how long and how often the invite link works, and a new link. */
export function InviteSettings({ guild }: { guild: GuildDto }) {
  const [hours, setHours] = useState<number | null>(null);
  const [uses, setUses] = useState<number | null>(guild.inviteMaxUses);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(regenerate: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { guild: updated } = await api.updateInvite(guild.id, {
        expiresInHours: hours,
        maxUses: uses,
        regenerate,
      });
      useChatStore.getState().upsertGuild(updated);
      setNote(regenerate ? 'Neuer Link erstellt, der alte gilt nicht mehr.' : 'Gespeichert.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className="settings-subheading">Einladungslink</h3>
      <p className="settings-hint" data-testid="invite-status">
        Aktuell: {inviteStatus(guild)}
      </p>
      <div className="invite-form">
        <label className="field">
          <span>Läuft ab nach</span>
          <select
            value={hours ?? ''}
            data-testid="invite-expiry"
            onChange={(e) => setHours(e.target.value ? Number(e.target.value) : null)}
          >
            {EXPIRY.map((o) => (
              <option key={o.label} value={o.hours ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nutzungen</span>
          <select
            value={uses ?? ''}
            data-testid="invite-uses"
            onChange={(e) => setUses(e.target.value ? Number(e.target.value) : null)}
          >
            {USES.map((n) => (
              <option key={n ?? 'all'} value={n ?? ''}>
                {n ?? 'Unbegrenzt'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="inline-actions">
        <button
          className="btn primary"
          data-testid="invite-save"
          disabled={busy}
          onClick={() => void save(false)}
        >
          Speichern
        </button>
        <button
          className="btn"
          data-testid="invite-regenerate"
          disabled={busy}
          onClick={() => void save(true)}
        >
          Neuen Link erzeugen
        </button>
      </div>
      {note && <p className="form-info">{note}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
