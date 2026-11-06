import { useState, type DragEvent } from 'react';
import type { CategoryDto, ChannelDto } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Icon } from './Icon';

const NO_CATEGORIES: CategoryDto[] = [];
const NO_CHANNELS: ChannelDto[] = [];

type Group = { id: string | null; name: string; channels: ChannelDto[] };

/** Categories with their channels, in the order the sidebar shows them. */
export function groupChannels(channels: ChannelDto[], categories: CategoryDto[]): Group[] {
  const known = new Set(categories.map((c) => c.id));
  const inGroup = (id: string | null) =>
    channels.filter((c) => (c.categoryId && known.has(c.categoryId) ? c.categoryId : null) === id);
  return [
    { id: null, name: 'Ohne Kategorie', channels: inGroup(null) },
    ...categories.map((c) => ({ id: c.id, name: c.name, channels: inGroup(c.id) })),
  ];
}

/** Takes a channel out and puts it before `beforeId` in that group (at the end without one). */
export function moveChannel(
  groups: Group[],
  channelId: string,
  toGroup: string | null,
  beforeId: string | null,
): Group[] {
  const moved = groups.flatMap((g) => g.channels).find((c) => c.id === channelId);
  if (!moved) return groups;
  return groups.map((g) => {
    const rest = g.channels.filter((c) => c.id !== channelId);
    if (g.id !== toGroup) return { ...g, channels: rest };
    const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
    const channels = [...rest];
    channels.splice(at === -1 ? rest.length : at, 0, moved);
    return { ...g, channels };
  });
}

/** Sort channels by dragging (or the arrows, on touch screens and by keyboard), and categories. */
export function ChannelOrganizer({
  guildId,
  run,
}: {
  guildId: string;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const channels = useChatStore((s) => s.channelsByGuild[guildId] ?? NO_CHANNELS);
  const categories = useChatStore((s) => s.categoriesByGuild[guildId] ?? NO_CATEGORIES);
  const [name, setName] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);
  const groups = groupChannels(channels, categories);

  function save(next: Group[]) {
    const order = next.flatMap((g) => g.channels.map((c) => ({ id: c.id, categoryId: g.id })));
    // Shown at once; the server's event confirms it.
    const byId = new Map(channels.map((c) => [c.id, c]));
    useChatStore.getState().setChannels(
      guildId,
      order.flatMap((o, position) => {
        const channel = byId.get(o.id);
        return channel ? [{ ...channel, position, categoryId: o.categoryId }] : [];
      }),
    );
    void run(() => api.orderChannels(guildId, order));
  }

  function nudge(group: Group, index: number, by: number) {
    const target = group.channels[index + (by > 0 ? 2 : -1)];
    const channel = group.channels[index];
    if (channel) save(moveChannel(groups, channel.id, group.id, target?.id ?? null));
  }

  function drop(e: DragEvent, groupId: string | null, beforeId: string | null) {
    e.preventDefault();
    e.stopPropagation();
    if (dragged && dragged !== beforeId) save(moveChannel(groups, dragged, groupId, beforeId));
    setDragged(null);
  }

  function moveCategory(index: number, by: number) {
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    if (!id) return;
    ids.splice(index + by, 0, id);
    void run(() => api.orderCategories(guildId, ids));
  }

  return (
    <div className="channel-organizer" data-testid="channel-organizer">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          setName('');
          void run(() => api.createCategory(guildId, trimmed));
        }}
      >
        <input
          aria-label="Neue Kategorie"
          placeholder="Neue Kategorie"
          maxLength={32}
          value={name}
          data-testid="category-name"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" data-testid="category-add" disabled={!name.trim()}>
          Anlegen
        </button>
      </form>
      <p className="settings-hint">Kanäle ziehen, um sie zu sortieren oder zu verschieben.</p>
      {groups.map((group) => {
        const index = categories.findIndex((c) => c.id === group.id);
        return (
          <section
            key={group.id ?? 'none'}
            className="organizer-group"
            data-testid={`group-${group.name}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, group.id, null)}
          >
            <header>
              <strong>{group.name}</strong>
              {group.id && (
                <>
                  <button
                    className="icon-btn"
                    aria-label={`${group.name} höher`}
                    disabled={index === 0}
                    onClick={() => moveCategory(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`${group.name} tiefer`}
                    disabled={index === categories.length - 1}
                    onClick={() => moveCategory(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label={`Kategorie ${group.name} löschen`}
                    title="Kategorie löschen, die Kanäle bleiben"
                    data-testid="category-delete"
                    onClick={() => void run(() => api.deleteCategory(guildId, group.id ?? ''))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </>
              )}
            </header>
            <ul>
              {group.channels.map((c, i) => (
                <li
                  key={c.id}
                  draggable
                  className={dragged === c.id ? 'dragging' : undefined}
                  data-testid={`order-${c.name}`}
                  onDragStart={() => setDragged(c.id)}
                  onDragEnd={() => setDragged(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, group.id, c.id)}
                >
                  <Icon name={c.kind === 'voice' ? 'speaker' : 'hash'} size={14} />
                  <span>{c.name}</span>
                  <button
                    className="icon-btn"
                    aria-label={`${c.name} höher`}
                    disabled={i === 0}
                    onClick={() => nudge(group, i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`${c.name} tiefer`}
                    disabled={i === group.channels.length - 1}
                    onClick={() => nudge(group, i, 1)}
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
