import { useEffect, useRef, useState } from 'react';
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

/** Server tag and operator badge next to a name. */
export function UserBadges({ user }: { user: Pick<PublicUserDto, 'badge' | 'tag'> }) {
  if (!user.badge && !user.tag) return null;
  return (
    <span className="user-badges">
      {user.tag && (
        <span className="server-tag" title="Server-Tag" data-testid="user-tag">
          {user.tag.emoji && <span aria-hidden="true">{user.tag.emoji}</span>}
          {user.tag.text}
        </span>
      )}
      {user.badge && (
        <span className={`user-badge badge-${user.badge}`} data-testid="user-badge">
          {user.badge}
        </span>
      )}
    </span>
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
