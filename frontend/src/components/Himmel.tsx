import { useEffect, useRef } from 'react';

/** Same seed, same sky: nothing jumps when the window changes size. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The slxt sky behind the app. It stays still on purpose: here people read, and text must not
 * compete with movement (WCAG 2.2.2). Purely decorative, hidden from screen readers.
 */
export function Himmel() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { innerWidth: w, innerHeight: h } = window;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = random(42);
      for (let i = 0, n = Math.round((w * h) / 9000); i < n; i += 1) {
        ctx.globalAlpha = 0.25 + r() * 0.65;
        ctx.fillStyle = r() < 0.15 ? '#cdd8ff' : '#ffffff';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, r() < 0.08 ? 1.5 : r() * 0.8 + 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="himmel" aria-hidden="true">
      <div className="aurora" />
      <canvas ref={canvas} />
    </div>
  );
}
