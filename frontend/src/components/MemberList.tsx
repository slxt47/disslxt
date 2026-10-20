import { useChatStore } from '../store/chat';

export function MemberList({ guildId }: { guildId: string }) {
  const members = useChatStore((s) => s.membersByGuild[guildId]);
  const online = members?.filter((m) => m.online).length ?? 0;

  return (
    <aside className="member-list" aria-label="Mitglieder">
      <h3 className="sidebar-heading">
        Mitglieder{members ? ` – ${online}/${members.length} online` : ''}
      </h3>
      <ul data-testid="member-list">
        {members?.map((m) => (
          <li
            key={m.userId}
            className={`member${m.online ? ' online' : ''}`}
            data-testid={`member-${m.username}`}
            data-online={m.online ? 'true' : 'false'}
          >
            <span className="presence-dot" aria-hidden="true" />
            <span className="member-name">{m.username}</span>
            <span className="sr-only">{m.online ? 'online' : 'offline'}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
