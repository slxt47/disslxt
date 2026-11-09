// Night sky like the other slxt sites (slxt.org, dash.slxt.dev): stars, shooting stars, a soft aurora.
// Extras here: two star layers with scroll parallax, a few twinkling stars, tap the sky for your own shooting star,
// and the light/dark switch fades the whole page slowly into the other mode (View Transitions, where supported).
// Stars only in dark mode (light mode = dusk gradient). With "reduce motion": static stars, nothing moves.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const himmel = document.createElement('div');
  himmel.className = 'himmel';
  himmel.setAttribute('aria-hidden', 'true');
  himmel.innerHTML =
    '<div class="aurora"><i></i><i></i><i></i></div>' +
    '<div class="sternlage fern"><canvas></canvas></div>' +
    '<div class="sternlage nah"><canvas></canvas><div class="funkeln"></div></div>' +
    '<div class="sternschnuppen"></div>';
  document.body.prepend(himmel);
  const [fern, nah] = himmel.querySelectorAll('.sternlage');
  const box = himmel.querySelector('.sternschnuppen');
  const funkeln = himmel.querySelector('.funkeln');

  // Same seed = same sky after a resize (no jumping stars when the phone's address bar collapses)
  const zufall = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const EXTRA = 1.5;            // layers are taller than the screen so they can drift while scrolling
  let gemalt = { w: 0, h: 0 };
  function malen(lage, seed, dichte, gross) {
    const cv = lage.querySelector('canvas'), ctx = cv.getContext('2d'), r = zufall(seed);
    const dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = Math.round(Math.max(innerHeight, 500) * EXTRA);
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    for (let i = 0, n = Math.round(w * h / dichte); i < n; i++) {
      ctx.globalAlpha = 0.25 + r() * 0.65;
      ctx.fillStyle = r() < 0.15 ? '#cdd8ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(r() * w, r() * h, r() < 0.08 ? gross : r() * 0.8 + 0.3, 0, Math.PI * 2); ctx.fill();
    }
    return h;
  }
  function sterne() {
    const w = innerWidth, h = Math.round(Math.max(innerHeight, 500) * EXTRA);
    if (w === gemalt.w && h <= gemalt.h) return;
    malen(fern, 7, 6400, 1.0);
    gemalt = { w, h: malen(nah, 42, 14000, 1.6) };
    // Twinkling stars: a handful of real elements, only opacity/scale animate (stays on the compositor)
    funkeln.textContent = '';
    if (reduce) return;
    const r = zufall(99);
    for (let i = 0, n = Math.min(34, Math.round(w / 40)); i < n; i++) {
      const s = document.createElement('i');
      s.style.left = (r() * 100).toFixed(2) + '%';
      s.style.top = (r() * 100).toFixed(2) + '%';
      s.style.setProperty('--d', (2.4 + r() * 3.6).toFixed(2) + 's');
      s.style.setProperty('--v', (-r() * 6).toFixed(2) + 's');
      s.style.setProperty('--g', (2 + r() * 2.5).toFixed(1) + 'px');
      funkeln.append(s);
    }
  }
  sterne();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { sterne(); scrollen(); }, 150); });

  // ---- Parallax: far stars drift slowly, near stars a little faster, the aurora fades out ----
  let tick = false;
  function scrollen() {
    tick = false;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const p = Math.min(1, Math.max(0, scrollY / max));
    const spiel = gemalt.h - innerHeight;                       // how far a layer may move
    fern.style.transform = `translate3d(0, ${(-p * spiel * 0.45).toFixed(1)}px, 0)`;
    nah.style.transform = `translate3d(0, ${(-p * spiel).toFixed(1)}px, 0)`;
    himmel.style.setProperty('--aurora', Math.max(0.25, 1 - scrollY / (innerHeight * 1.2)).toFixed(3));
  }
  if (!reduce) {
    addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(scrollen); } }, { passive: true });
    scrollen();
  }

  // ---- Shooting stars ----
  function meteor(x0, y0) {
    if (reduce) return;
    const W = innerWidth, H = innerHeight, len = 80 + Math.random() * 150;
    const dir = x0 === undefined ? (Math.random() < 0.5 ? 1 : -1) : (x0 < W / 2 ? 1 : -1);
    const ang = (14 + Math.random() * 26) * Math.PI / 180, dist = Math.max(W, H) * (0.22 + Math.random() * 0.25);
    if (x0 === undefined) { x0 = dir > 0 ? Math.random() * W * 0.65 : W * 0.35 + Math.random() * W * 0.65; y0 = Math.random() * H * 0.42; }
    const x1 = x0 + dir * Math.cos(ang) * dist, y1 = y0 + Math.sin(ang) * dist, deg = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    const el = document.createElement('i'); el.className = 'meteor'; el.style.width = `${len}px`; box.append(el);
    const at = (x, y, s) => `translate3d(${x - len}px, ${y - 1}px, 0) rotate(${deg}deg) scaleX(${s})`;
    const a = el.animate([{ transform: at(x0, y0, 0.3), opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.9, offset: 0.65 }, { transform: at(x1, y1, 1), opacity: 0 }],
      { duration: 700 + Math.random() * 700, easing: 'cubic-bezier(.3, .55, .55, 1)' });
    a.onfinish = a.oncancel = () => el.remove();
  }
  (function plan(erst) {
    setTimeout(() => {
      if (!document.hidden) { meteor(); if (Math.random() < 0.18) setTimeout(meteor, 200 + Math.random() * 700); }
      plan(false);
    }, erst ? 1500 + Math.random() * 2500 : 4000 + Math.random() * 9000);
  })(true);
  // Tap/click into the empty sky = your own shooting star
  // "click" instead of "pointerdown": on phones a swipe to scroll must not fire a shooting star
  addEventListener('click', (e) => {
    if (e.button || e.target.closest('a, button, input, textarea, label, select, .topic, .legal, .toc, .contact, .search, .top, .foot, svg')) return;
    meteor(e.clientX, e.clientY);
  });

  // Light/dark switch: the slow crossfade now lives in modus.js (shared by all slxt pages).
})();
