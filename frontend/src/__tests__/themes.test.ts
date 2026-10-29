import { describe, expect, it } from 'vitest';
import { contrast, PRESET_THEMES, readableOn, themeVars, type ThemeDef } from '../theme/themes';

const check = (t: ThemeDef) => {
  const v = themeVars(t);
  for (const bg of ['--bg', '--bg-secondary', '--bg-elevated']) {
    expect(contrast(v['--text']!, v[bg]!), `${t.id} text on ${bg}`).toBeGreaterThanOrEqual(7);
  }
  expect(contrast(v['--text-secondary']!, v['--bg-secondary']!), t.id).toBeGreaterThanOrEqual(4.5);
  expect(contrast(v['--accent-text']!, v['--bg-secondary']!), t.id).toBeGreaterThanOrEqual(4.5);
};

describe('colour themes', () => {
  it('every preset keeps text readable (WCAG AA)', () => {
    for (const t of PRESET_THEMES) check(t);
  });

  it('a hard custom theme (pale yellow accent on light) is corrected, not unreadable', () => {
    const t: ThemeDef = {
      id: 'custom-x',
      name: 'x',
      base: 'light',
      accent: '#fff7a0',
      accent2: '#ffe066',
      hue: 60,
      tint: 1,
    };
    check(t);
    // Buttons on the pale gradient get dark text.
    expect(themeVars(t)['--on-accent']).toBe('#111118');
  });

  it('readableOn keeps a colour that already reads well', () => {
    expect(readableOn('#000000', '#ffffff')).toBe('#000000');
  });
});
