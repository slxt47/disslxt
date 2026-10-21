import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChatStore } from '../store/chat';
import { CreateGuildDialog } from './CreateGuildDialog';
import { Icon } from './Icon';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

export function ServerList({ activeGuildId }: { activeGuildId: string | null }) {
  const guilds = useChatStore((s) => s.guilds);
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
  const [creating, setCreating] = useState(false);

  return (
    <nav className="server-list" aria-label="Server">
      <ul data-testid="guild-list">
        {guilds.map((g) => {
          const first = channelsByGuild[g.id]?.[0];
          const to = first ? `/guilds/${g.id}/channels/${first.id}` : `/guilds/${g.id}`;
          return (
            <li key={g.id}>
              <Link
                to={to}
                className={`guild-icon${g.id === activeGuildId ? ' active' : ''}`}
                data-testid={`guild-item-${g.id}`}
                title={g.name}
                aria-label={g.name}
                aria-current={g.id === activeGuildId ? 'page' : undefined}
              >
                {initials(g.name)}
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
