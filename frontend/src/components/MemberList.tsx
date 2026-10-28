import { useChatStore } from '../store/chat';
import { nameOf } from '../profile';
import { Avatar } from './Icon';

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
            <span className="member-avatar">
              <Avatar name={nameOf(m)} url={m.avatarUrl} size="sm" />
              <span className="presence-dot" aria-hidden="true" />
            </span>
            <span className="member-name" title={`@${m.username}`}>
              {nameOf(m)}
            </span>
            <span className="sr-only">{m.online ? 'online' : 'offline'}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
