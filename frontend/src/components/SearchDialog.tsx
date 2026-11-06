import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChannelDto, SearchResultDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api, type SearchParams } from '../api/endpoints';
import { conversationName, nameOf } from '../profile';
import { useChatStore } from '../store/chat';
import { Modal } from './Modal';
import { LineSkeleton } from './Skeleton';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const NO_MEMBERS: never[] = [];

/** The text with the search words marked; React elements, so the text stays text. */
function Marked({ text, words }: { text: string; words: string[] }) {
  const lower = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (;;) {
    const next = words
      .map((w) => ({ w, i: lower.indexOf(w, at) }))
      .filter((x) => x.i !== -1)
      .sort((a, b) => a.i - b.i)[0];
    if (!next) break;
    if (next.i > at) parts.push({ text: text.slice(at, next.i), hit: false });
    parts.push({ text: text.slice(next.i, next.i + next.w.length), hit: true });
    at = next.i + next.w.length;
  }
  parts.push({ text: text.slice(at), hit: false });
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

type Scope = 'all' | 'guild' | 'channel' | 'private';

/** Search through everything you may read, with limits for place, person and date. */
export function SearchDialog({ channel, onClose }: { channel: ChannelDto; onClose: () => void }) {
  const navigate = useNavigate();
  const guildId = channel.guildId;
  const members = useChatStore((s) => (guildId ? s.membersByGuild[guildId] : NO_MEMBERS));
  const dms = useChatStore((s) => s.dms);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [authorId, setAuthorId] = useState('');
  const [after, setAfter] = useState('');
  const [until, setUntil] = useState('');
  const [results, setResults] = useState<SearchResultDto[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const params = (): SearchParams => ({
    q: q.trim(),
    ...(scope === 'guild' && guildId ? { guildId } : {}),
    ...(scope === 'channel' ? { channelId: channel.id } : {}),
    ...(scope === 'private' ? { privateOnly: true } : {}),
    ...(authorId ? { authorId } : {}),
    ...(after ? { after } : {}),
    ...(until ? { until } : {}),
  });

  async function run(beforeId?: string) {
    const ticket = (latest.current += 1);
    setBusy(true);
    setError(null);
    try {
      const { results: found } = await api.search({
        ...params(),
        ...(beforeId ? { beforeId } : {}),
      });
      // An older answer arriving late must not replace a newer one.
      if (ticket !== latest.current) return;
      setResults((old) => (beforeId ? [...(old ?? []), ...found] : found));
      setMore(found.length === 25);
    } catch (err) {
      if (ticket === latest.current) setError(errorMessage(err));
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      setMore(false);
      return;
    }
    const timer = setTimeout(() => void run(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, authorId, after, until]);

  function open(r: SearchResultDto) {
    const { message } = r;
    useChatStore.getState().setJumpTarget({ channelId: message.channelId, messageId: message.id });
    navigate(
      r.guildId ? `/guilds/${r.guildId}/channels/${message.channelId}` : `/me/${message.channelId}`,
    );
    onClose();
  }

  const where = (r: SearchResultDto) => {
    if (r.guildId) return `#${r.channelName} · ${r.guildName ?? ''}`;
    const dm = dms.find((d) => d.channel.id === r.message.channelId);
    return dm ? conversationName(dm) : 'Privater Chat';
  };
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  return (
    <Modal title="Suchen" onClose={onClose} testId="search-dialog">
      <input
        className="search-input"
        type="search"
        autoFocus
        aria-label="Suchbegriff"
        placeholder="Worte suchen…"
        value={q}
        data-testid="search-input"
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="search-filters">
        <select
          className="plain-select"
          aria-label="Wo suchen"
          value={scope}
          data-testid="search-scope"
          onChange={(e) => setScope(e.target.value as Scope)}
        >
          <option value="all">Überall</option>
          {guildId && <option value="guild">Dieser Server</option>}
          <option value="channel">Dieser Kanal</option>
          <option value="private">Private Chats</option>
        </select>
        {members && members.length > 0 && (
          <select
            className="plain-select"
            aria-label="Von wem"
            value={authorId}
            data-testid="search-author"
            onChange={(e) => setAuthorId(e.target.value)}
          >
            <option value="">Von allen</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {nameOf(m)}
              </option>
            ))}
          </select>
        )}
        <input
          className="plain-select"
          type="date"
          aria-label="Von Datum"
          value={after}
          data-testid="search-after"
          onChange={(e) => setAfter(e.target.value)}
        />
        <input
          className="plain-select"
          type="date"
          aria-label="Bis Datum"
          value={until}
          data-testid="search-until"
          onChange={(e) => setUntil(e.target.value)}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && !results && <LineSkeleton rows={3} />}
      {results?.length === 0 && !busy && (
        <p className="muted" data-testid="search-empty">
          Nichts gefunden.
        </p>
      )}
      <ul className="search-results" data-testid="search-results">
        {results?.map((r) => (
          <li key={r.message.id}>
            <button
              type="button"
              data-testid={`search-hit-${r.message.id}`}
              onClick={() => open(r)}
            >
              <span className="search-meta">
                <strong>{nameOf(r.message.author)}</strong>
                <span>{where(r)}</span>
                <time>{dateFormat.format(new Date(r.message.createdAt))}</time>
              </span>
              <span className="search-text">
                {r.message.kind === 'voice' && '🎤 '}
                <Marked text={r.message.content} words={words} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <button
          className="btn"
          disabled={busy}
          data-testid="search-more"
          onClick={() => void run(results?.[results.length - 1]?.message.id)}
        >
          Mehr anzeigen
        </button>
      )}
    </Modal>
  );
}
