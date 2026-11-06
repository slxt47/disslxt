// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, hexToRgb, hsl, PRESET_THEMES, themeVars } from '../theme/themes';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/^\s+(--[a-z0-9-]+): (#[0-9a-f]{6});/gm)].map((m) => [m[1]!, m[2]!]),
  );
}

const light = tokens(':root');
const palettes = { hell: light, dunkel: { ...light, ...tokens(":root[data-theme='dark']") } };

/** A panel with the sky shining through. */
function over(panel: string, sky: string, share: number): string {
  const [a, b] = [hexToRgb(panel), hexToRgb(sky)];
  const mix = a.map((v, i) => Math.round(v * share + b[i]! * (1 - share)));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(Object.entries(palettes))('colours in %s', (_, t) => {
  const v = (name: string) => t[name]!;
  const skies = [v('--sky1'), v('--sky2'), v('--sky3')];
  const surfaces = [
    v('--bg'),
    v('--bg-secondary'),
    v('--bg-tertiary'),
    v('--bg-elevated'),
    ...skies.map((s) => over(v('--bg'), s, 0.92)),
    ...skies.map((s) => over(v('--bg-secondary'), s, 0.86)),
    ...skies.map((s) => over(v('--bg-tertiary'), s, 0.62)),
  ];

  it.each(['--text', '--text-secondary', '--text-tertiary', '--accent-text', '--danger'])(
    '%s reads on every surface (4.5:1)',
    (name) => {
      for (const surface of surfaces) {
        expect(contrast(v(name), surface), `${v(name)} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('text on filled controls reads (4.5:1)', () => {
    for (const [text, fill] of [
      ['--on-accent', '--accent'],
      ['--on-accent', '--accent-2'],
      ['--on-danger', '--danger'],
      ['--on-success', '--success'],
    ] as const) {
      expect(contrast(v(text), v(fill)), `${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the focus ring stands out (3:1)', () => {
    for (const surface of surfaces) {
      expect(contrast(v('--accent'), surface)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('avatars', () => {
  it('dark letters read on every name colour (4.5:1)', () => {
    for (let hue = 0; hue < 360; hue += 1) {
      for (const stop of [hsl(hue, 70, 78), hsl((hue + 32) % 360, 66, 76)]) {
        expect(contrast('#0b0b10', stop)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe.each(PRESET_THEMES.map((t) => [t.name, t] as const))('theme %s', (_, theme) => {
  const v = themeVars(theme);
  it('all text colours read on all backgrounds (4.5:1)', () => {
    for (const bg of ['--bg', '--bg-secondary', '--bg-tertiary', '--bg-elevated']) {
      for (const text of ['--text', '--text-secondary', '--text-tertiary', '--accent-text']) {
        expect(contrast(v[text]!, v[bg]!), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('text on the accent reads', () => {
    for (const fill of ['--accent', '--accent-2']) {
      expect(contrast(v['--on-accent']!, v[fill]!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
