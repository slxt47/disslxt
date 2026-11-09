import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { conversationName } from '../profile';
import { useChatStore } from '../store/chat';
import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';

interface Target {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
  to: string;
}

/** Best first: start of the name, start of a word, then anywhere. */
export function rankTargets<T extends { label: string; hint: string }>(
  list: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const score = (t: T): number => {
    const label = t.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    return t.hint.toLowerCase().includes(q) ? 3 : 9;
  };
  return list
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.t);
}

/** Strg+K: type a name, Enter goes there. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const guilds = useChatStore((s) => s.guilds);
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
  const dms = useChatStore((s) => s.dms);
  const unread = useChatStore((s) => s.unread);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  // Servers not opened yet have no channels here.
  useEffect(() => {
    for (const g of useChatStore.getState().guilds) {
      if (useChatStore.getState().channelsByGuild[g.id]) continue;
      api.listChannels(g.id).then(
        (r) => useChatStore.getState().setChannels(g.id, r.channels),
        () => undefined,
      );
    }
  }, []);

  const targets = useMemo(() => {
    const all: Target[] = [];
    for (const g of guilds) {
      for (const c of channelsByGuild[g.id] ?? []) {
        all.push({
          key: c.id,
          label: c.name,
          hint: g.name,
          icon: c.kind === 'voice' ? 'speaker' : 'hash',
          to: `/guilds/${g.id}/channels/${c.id}`,
        });
      }
    }
    for (const d of dms) {
      all.push({
        key: d.channel.id,
        label: conversationName(d),
        hint: d.channel.kind === 'group' ? 'Gruppe' : 'Privater Chat',
        icon: 'message',
        to: `/me/${d.channel.id}`,
      });
    }
    // With nothing typed, what is new comes first.
    return [...all].sort((a, b) => Number(!!unread[b.key]) - Number(!!unread[a.key]));
  }, [guilds, channelsByGuild, dms, unread]);

  const shown = rankTargets(targets, query).slice(0, 12);
  const current = Math.min(selected, Math.max(0, shown.length - 1));

  function go(target?: Target) {
    if (!target) return;
    navigate(target.to);
    onClose();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : shown.length - 1;
      setSelected((current + step) % Math.max(1, shown.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(shown[current]);
    }
  }

  return (
    <Modal title="Springen zu" onClose={onClose} testId="quick-switcher">
      <input
        className="search-input"
        autoFocus
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls="switcher-list"
        aria-autocomplete="list"
        aria-activedescendant={shown.length > 0 ? `switcher-option-${current}` : undefined}
        aria-label="Kanal oder Unterhaltung"
        placeholder="Kanal oder Unterhaltung…"
        value={query}
        data-testid="switcher-input"
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onKey}
      />
      {shown.length === 0 ? (
        <p className="muted">Nichts gefunden.</p>
      ) : (
        <ul className="switcher-list" id="switcher-list" role="listbox" aria-label="Treffer">
          {shown.map((t, i) => (
            // Arrows and Enter work from the field; the row itself is only for the mouse.
            <li
              key={t.key}
              id={`switcher-option-${i}`}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'active' : ''}
              data-testid={`switcher-${t.label}`}
              onClick={() => go(t)}
            >
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
