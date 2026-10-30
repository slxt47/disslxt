import { useChatStore } from '../store/chat';
import { nameOf } from '../profile';
import { Avatar } from './Icon';
import { AdminPanel } from './AdminPanel';
import { PRESENCE_TEXT, ProfileLink, StatusLine, UserBadges } from './Social';

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
            data-presence={m.presence ?? (m.online ? 'online' : 'offline')}
          >
            <span className="member-avatar">
              <Avatar name={nameOf(m)} url={m.avatarUrl} size="sm" />
              <span className="presence-dot" aria-hidden="true" />
            </span>
            <span className="member-text">
              <span className="member-name" title={`@${m.username}`}>
                <ProfileLink userId={m.userId}>{nameOf(m)}</ProfileLink>
                <UserBadges user={m} />
              </span>
              <StatusLine status={m.status} />
            </span>
            <span className="sr-only">
              {PRESENCE_TEXT[m.presence ?? (m.online ? 'online' : 'offline')]}
            </span>
          </li>
        ))}
      </ul>
      <AdminPanel />
    </aside>
  );
}
