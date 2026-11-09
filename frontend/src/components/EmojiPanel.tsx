import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EMOJI_GROUPS, searchEmoji } from '../lib/emoji';

/** Emoji list with search, for reactions and the composer. Closes on Escape or a click outside. */
export function EmojiPanel({
  onPick,
  onClose,
  label,
  top,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  label: string;
  /** Above the search, part of the panel. */
  top?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const found = query.trim() ? searchEmoji(query.trim(), 48) : null;
  const button = (emoji: string, code: string) => (
    <button
      key={emoji}
      type="button"
      className="emoji-cell"
      title={`:${code}:`}
      aria-label={code.replace(/_/g, ' ')}
      data-testid={`emoji-${code}`}
      onClick={() => onPick(emoji)}
    >
      {emoji}
    </button>
  );

  return (
    <div
      className="emoji-panel"
      ref={box}
      role="dialog"
      aria-label={label}
      data-testid="emoji-panel"
    >
      {top}
      <input
        className="emoji-search"
        placeholder="Emoji suchen…"
        aria-label="Emoji suchen"
        data-testid="emoji-search"
        autoFocus={!matchMedia('(pointer: coarse)').matches}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="emoji-scroll">
        {found ? (
          found.length > 0 ? (
            <div className="emoji-cells">{found.map((e) => button(e.emoji, e.code))}</div>
          ) : (
            <p className="muted emoji-none">Nichts gefunden</p>
          )
        ) : (
          EMOJI_GROUPS.map((g) => (
            <section key={g.label}>
              <h4>{g.label}</h4>
              <div className="emoji-cells">{g.emojis.map((e) => button(e.emoji, e.code))}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
