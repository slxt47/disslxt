import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GifDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';

let statusPromise: Promise<boolean> | null = null;
/** Whether the server has a GIPHY key (asked once per session). */
export function useGifsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    statusPromise ??= api.gifStatus().then(
      (r) => r.enabled,
      () => false,
    );
    let alive = true;
    void statusPromise.then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A GIF in the chat: GIPHY's MP4 loops silently; with reduced motion it waits for a tap. */
export function GifView({ gif }: { gif: GifDto }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still] = useState(reducedMotion);
  const [playing, setPlaying] = useState(!still);
  const ratio = { aspectRatio: `${gif.width} / ${gif.height}` } as CSSProperties;
  return (
    <figure className="gif-message" data-testid="gif-message">
      <video
        ref={ref}
        src={gif.mp4}
        poster={gif.webp}
        style={ratio}
        autoPlay={!still}
        loop
        muted
        playsInline
        preload={still ? 'metadata' : 'auto'}
        aria-label={gif.title || 'GIF'}
        onClick={() => {
          const v = ref.current;
          if (!v) return;
          if (v.paused)
            void v.play().then(
              () => setPlaying(true),
              () => undefined,
            );
          else {
            v.pause();
            setPlaying(false);
          }
        }}
      />
      {!playing && <span className="gif-badge">GIF ▶</span>}
      <figcaption>via GIPHY</figcaption>
    </figure>
  );
}

/** Search GIPHY (trending without a query) and pick one. */
export function GifPicker({
  onPick,
  onClose,
}: {
  onPick: (gif: GifDto) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Search 350 ms after the last key press; a newer query wins over an older answer.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.searchGifs(q.trim()).then(
        (r) => {
          if (!alive) return;
          setGifs(r.gifs);
          setMore(r.gifs.length > 0);
          setError(null);
          setLoading(false);
        },
        (err: unknown) => {
          if (!alive) return;
          setError(errorMessage(err));
          setLoading(false);
        },
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!box.current?.contains(target) && !target.closest?.('[data-testid="gif-button"]')) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  async function loadMore() {
    setLoading(true);
    try {
      const r = await api.searchGifs(q.trim(), gifs.length);
      setGifs((g) => [...g, ...r.gifs.filter((n) => !g.some((o) => o.id === n.id))]);
      setMore(r.gifs.length > 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="gif-picker"
      ref={box}
      role="dialog"
      aria-label="GIF auswählen"
      data-testid="gif-picker"
    >
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="GIFs suchen…"
        aria-label="GIFs suchen"
        enterKeyHint="search"
        data-testid="gif-search"
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="gif-grid" aria-busy={loading}>
        {gifs.map((g) => (
          <button
            key={g.id}
            type="button"
            className="gif-tile"
            title={g.title}
            data-testid="gif-result"
            onClick={() => onPick(g)}
          >
            <img
              src={g.webp}
              alt={g.title || 'GIF'}
              loading="lazy"
              decoding="async"
              style={{ aspectRatio: `${g.width} / ${g.height}` }}
            />
          </button>
        ))}
        {!loading && !error && gifs.length === 0 && <p className="muted">Nichts gefunden.</p>}
      </div>
      {error && <p className="form-error small">{error}</p>}
      <div className="gif-footer">
        {more && gifs.length > 0 && (
          <button
            type="button"
            className="btn small"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            Mehr laden
          </button>
        )}
        <span className="gif-attribution">Powered by GIPHY</span>
      </div>
    </div>
  );
}
