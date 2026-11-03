import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBadgeStore } from '../store/badges';
import { useProfileView } from '../store/profile';
import type { PresenceStatus, PublicUserDto, UserStatusDto } from '@disslxt/shared';

/** A small, hand-picked set: statuses and server tags need one emoji, not the whole catalogue. */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Gefühle',
    emojis: [
      '😀',
      '😂',
      '🥹',
      '😊',
      '😎',
      '🤓',
      '🥳',
      '😴',
      '🤒',
      '😤',
      '🥶',
      '🤯',
      '😇',
      '🤔',
      '🙃',
      '😈',
    ],
  },
  {
    label: 'Tun',
    emojis: [
      '🎧',
      '🎮',
      '💻',
      '📚',
      '🏋️',
      '🚴',
      '🏃',
      '🍳',
      '🚗',
      '✈️',
      '🏖️',
      '🎬',
      '🎵',
      '🎨',
      '🛠️',
      '🧘',
    ],
  },
  {
    label: 'Herzen & Hände',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '👍',
      '👋',
      '🙏',
      '💪',
      '✌️',
      '🤝',
      '👀',
      '🫶',
    ],
  },
  {
    label: 'Natur',
    emojis: [
      '🐱',
      '🐶',
      '🦊',
      '🐼',
      '🐸',
      '🦄',
      '🐉',
      '🌸',
      '🌻',
      '🌙',
      '⭐',
      '🔥',
      '⚡',
      '🌈',
      '❄️',
      '🌊',
    ],
  },
  {
    label: 'Dinge',
    emojis: [
      '☕',
      '🍕',
      '🍔',
      '🍺',
      '🎂',
      '🏆',
      '👑',
      '💎',
      '🚀',
      '🛡️',
      '⚔️',
      '🎯',
      '🧩',
      '🎲',
      '📌',
      '💤',
    ],
  },
];

/** Picks one emoji (or none) for a status or a server tag. */
export function EmojiPicker({
  value,
  onChange,
  label,
  testId,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  label: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="emoji-picker" ref={box}>
      <button
        type="button"
        className="emoji-button"
        aria-label={value ? `${label}: ${value} – ändern` : `${label} wählen`}
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {value ?? <span className="emoji-empty">＋</span>}
      </button>
      {open && (
        <div className="emoji-pop" role="dialog" aria-label={label}>
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="emoji-group">{g.label}</p>
              <div className="emoji-grid">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={e === value ? 'on' : ''}
                    aria-label={e}
                    onClick={() => {
                      onChange(e);
                      setOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {value && (
            <button
              type="button"
              className="btn small emoji-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Kein Emoji
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Server tag and the chosen badges next to a name. */
export function UserBadges({ user }: { user: Pick<PublicUserDto, 'badges' | 'tag'> }) {
  const catalogue = useBadgeStore((s) => s.byId);
  const shown = (user.badges ?? []).flatMap((id) => (catalogue[id] ? [catalogue[id]] : []));
  if (shown.length === 0 && !user.tag) return null;
  return (
    <span className="user-badges">
      {user.tag && (
        <span className="server-tag" title="Server-Tag" data-testid="user-tag">
          {user.tag.emoji && <span aria-hidden="true">{user.tag.emoji}</span>}
          {user.tag.text}
        </span>
      )}
      {shown.map((b) => (
        <span
          key={b.id}
          className="user-badge"
          title={`${b.label} – ${b.description}`}
          data-testid="user-badge"
          data-badge={b.id}
        >
          <span aria-hidden="true">{b.emoji}</span>
          <span className="sr-only">{b.label}</span>
        </span>
      ))}
    </span>
  );
}

/** A name that opens that person's profile when clicked. */
export function ProfileLink({
  userId,
  className,
  title,
  children,
}: {
  userId: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`profile-link${className ? ` ${className}` : ''}`}
      title={title}
      data-testid="profile-link"
      onClick={(e) => {
        e.stopPropagation();
        useProfileView.getState().open(userId);
      }}
    >
      {children}
    </button>
  );
}

/** "🎧 Hört Musik" under a name. */
export function StatusLine({ status }: { status?: UserStatusDto | null }) {
  if (!status || (!status.emoji && !status.text)) return null;
  return (
    <span className="status-line" data-testid="status-line">
      {status.emoji && <span aria-hidden="true">{status.emoji} </span>}
      {status.text}
    </span>
  );
}

export const PRESENCE_TEXT: Record<PresenceStatus, string> = {
  online: 'online',
  call: 'im Anruf',
  offline: 'offline',
};
