/**
 * Colour themes beyond light and dark. A theme is a few choices (base, two accent colours, a
 * background tint); every design token is derived from them, and text colours are nudged until
 * they reach WCAG contrast (4.5:1) on their background, so no theme becomes unreadable.
 */
export interface ThemeDef {
  id: string;
  name: string;
  base: 'light' | 'dark';
  /** Main and second accent (buttons and highlights use a gradient between them). */
  accent: string;
  accent2: string;
  /** Hue of the background tint (0–360) and how strong it is (0–1). */
  hue: number;
  tint: number;
  /** True black backgrounds (saves power on OLED screens). */
  oled?: boolean;
}

export const PRESET_THEMES: ThemeDef[] = [
  {
    id: 'ocean',
    name: 'Ozean',
    base: 'dark',
    accent: '#1fb6d6',
    accent2: '#3b6cf6',
    hue: 205,
    tint: 0.55,
  },
  {
    id: 'forest',
    name: 'Wald',
    base: 'dark',
    accent: '#2fbf71',
    accent2: '#0f9f8f',
    hue: 150,
    tint: 0.45,
  },
  {
    id: 'sunset',
    name: 'Sonnenuntergang',
    base: 'dark',
    accent: '#ff7a45',
    accent2: '#ff3d7f',
    hue: 12,
    tint: 0.45,
  },
  {
    id: 'nord',
    name: 'Nord',
    base: 'dark',
    accent: '#88c0d0',
    accent2: '#5e81ac',
    hue: 220,
    tint: 0.35,
  },
  {
    id: 'oled',
    name: 'OLED Schwarz',
    base: 'dark',
    accent: '#a78bfa',
    accent2: '#60a5fa',
    hue: 260,
    tint: 0,
    oled: true,
  },
  {
    id: 'sakura',
    name: 'Sakura',
    base: 'light',
    accent: '#d63c78',
    accent2: '#9b4dea',
    hue: 340,
    tint: 0.55,
  },
  {
    id: 'sand',
    name: 'Sand',
    base: 'light',
    accent: '#c2410c',
    accent2: '#b7791f',
    hue: 35,
    tint: 0.6,
  },
  {
    id: 'mint',
    name: 'Minze',
    base: 'light',
    accent: '#0d9488',
    accent2: '#2563eb',
    hue: 170,
    tint: 0.5,
  },
];

export const CUSTOM_PREFIX = 'custom-';
export const MAX_CUSTOM_THEMES = 12;

// --- colour maths ---------------------------------------------------------------------------

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x7c5cff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb(h, s, l));

function luminance([r, g, b]: Rgb): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves a colour's lightness (keeping its hue) until it reaches `min` contrast on `bg`. */
export function readableOn(color: string, bg: string, min = 4.5): string {
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  const lighter = luminance(hexToRgb(bg)) < 0.2;
  let light = l;
  let out = color;
  for (let i = 0; i < 60 && contrast(out, bg) < min; i++) {
    light = lighter ? Math.min(98, light + 1.5) : Math.max(4, light - 1.5);
    out = hsl(h, s, light);
  }
  return out;
}

const rgba = (hex: string, alpha: number) => `rgba(${hexToRgb(hex).join(', ')}, ${alpha})`;

function shade(hex: string, dl: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return hsl(h, s, Math.min(96, Math.max(4, l + dl)));
}

// --- tokens ---------------------------------------------------------------------------------

/** The CSS custom properties a theme sets on <html> (on top of its light/dark base). */
export function themeVars(t: ThemeDef): Record<string, string> {
  const dark = t.base === 'dark';
  const sat = Math.round(Math.min(1, Math.max(0, t.tint)) * 100);
  const h = t.hue;
  const bg = t.oled ? '#000000' : dark ? hsl(h, sat * 0.35, 9) : hsl(h, sat * 0.4, 99);
  const bgSecondary = t.oled
    ? '#000000'
    : dark
      ? hsl(h, sat * 0.35, 6.5)
      : hsl(h, sat * 0.45, 96.5);
  const bgTertiary = t.oled ? '#000000' : dark ? hsl(h, sat * 0.35, 4.5) : hsl(h, sat * 0.45, 92.5);
  const bgElevated = t.oled ? '#101014' : dark ? hsl(h, sat * 0.3, 13.5) : '#ffffff';
  const text = dark ? hsl(h, Math.min(25, sat * 0.25), 94) : hsl(h, Math.min(30, sat * 0.3), 10);
  const textSecondary = readableOn(
    dark ? hsl(h, Math.min(15, sat * 0.2), 70) : hsl(h, Math.min(15, sat * 0.2), 38),
    bgSecondary,
  );
  const textTertiary = readableOn(dark ? hsl(h, 10, 50) : hsl(h, 10, 55), bgSecondary, 3);
  const accentText = readableOn(t.accent, bgSecondary);
  // White or near-black text on the accent gradient, whichever reads better on both ends.
  const onAccent =
    Math.min(contrast('#ffffff', t.accent), contrast('#ffffff', t.accent2)) >= 3
      ? '#ffffff'
      : '#111118';
  return {
    '--bg': bg,
    '--bg-secondary': bgSecondary,
    '--bg-tertiary': bgTertiary,
    '--bg-elevated': bgElevated,
    '--bg-translucent': rgba(bg, dark ? 0.72 : 0.74),
    '--fill': dark ? rgba(hsl(h, 40, 75), 0.08) : rgba(hsl(h, 30, 40), 0.08),
    '--fill-strong': dark ? rgba(hsl(h, 40, 75), 0.15) : rgba(hsl(h, 30, 40), 0.15),
    '--separator': dark ? 'rgba(255, 255, 255, 0.07)' : rgba(hsl(h, 40, 20), 0.09),
    '--text': text,
    '--text-secondary': textSecondary,
    '--text-tertiary': textTertiary,
    '--accent': t.accent,
    '--accent-2': t.accent2,
    '--accent-hover': shade(t.accent, dark ? 5 : 4),
    '--accent-pressed': shade(t.accent, -6),
    '--accent-text': accentText,
    '--accent-soft': rgba(t.accent, dark ? 0.14 : 0.09),
    '--accent-soft-strong': rgba(t.accent, dark ? 0.25 : 0.16),
    '--on-accent': onAccent,
    '--focus-ring': `0 0 0 4px ${rgba(t.accent, dark ? 0.38 : 0.24)}`,
    '--glow': `0 10px 30px -6px ${rgba(t.accent, 0.55)}`,
    '--backdrop': t.oled
      ? 'none'
      : `radial-gradient(1200px 600px at 110% -10%, ${rgba(t.accent, dark ? 0.13 : 0.06)}, transparent 60%), radial-gradient(900px 500px at -10% 110%, ${rgba(t.accent2, dark ? 0.09 : 0.05)}, transparent 60%)`,
  };
}

export function findTheme(id: string, custom: ThemeDef[]): ThemeDef | null {
  return PRESET_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id) ?? null;
}
