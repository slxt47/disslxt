import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useChatStore } from '../store/chat';
import { CreateGuildDialog } from './CreateGuildDialog';
import { Icon, nameHue } from './Icon';

export function guildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

export function ServerList({
  activeGuildId,
  home = false,
}: {
  activeGuildId: string | null;
  /** Friends and private conversations are shown. */
  home?: boolean;
}) {
  const guilds = useChatStore((s) => s.guilds);
  const unread = useChatStore((s) => Object.values(s.unreadDms).reduce((a, b) => a + b, 0));
  const requests = useChatStore((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const badge = unread + requests;
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
  const [creating, setCreating] = useState(false);

  return (
    <nav className="server-list" aria-label="Server">
      <Link
        to="/me"
        className={`brand-mark${home ? ' active' : ''}`}
        data-testid="home-button"
        title="Freunde & Direktnachrichten"
        aria-label={`Freunde und Direktnachrichten${badge ? ` – ${badge} neu` : ''}`}
        aria-current={home ? 'page' : undefined}
      >
        d
        {badge > 0 && (
          <span className="badge" data-testid="home-badge" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
      <ul data-testid="guild-list">
        {guilds.map((g) => {
          const first = channelsByGuild[g.id]?.[0];
          const to = first ? `/guilds/${g.id}/channels/${first.id}` : `/guilds/${g.id}`;
          return (
            <li key={g.id}>
              <Link
                to={to}
                className={`guild-icon${g.id === activeGuildId ? ' active' : ''}${g.iconUrl ? ' has-image' : ''}`}
                data-testid={`guild-item-${g.id}`}
                title={g.name}
                aria-label={g.name}
                style={{ '--hue': nameHue(g.name) } as CSSProperties}
                aria-current={g.id === activeGuildId ? 'page' : undefined}
              >
                {g.iconUrl ? <img src={g.iconUrl} alt="" /> : guildInitials(g.name)}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        className="guild-icon add"
        data-testid="create-guild-button"
        title="Server erstellen"
        aria-label="Server erstellen"
        onClick={() => setCreating(true)}
      >
        <Icon name="plus" size={22} />
      </button>
      {creating && <CreateGuildDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}
