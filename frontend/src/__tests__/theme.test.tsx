import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { usePrefs } from '../store/prefs';

afterEach(() => usePrefs.getState().set({ theme: 'system' }));

describe('appearance', () => {
  it('Hell / Dunkel / Automatisch set data-theme and the bar colour, and persist', async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = '(prefers-color-scheme: light)';
    document.head.appendChild(meta);
    render(<AppearanceSettings />);
    expect(screen.getByTestId('theme-system').getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByTestId('theme-dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.content).toBe('#161617');
    expect(JSON.parse(localStorage.getItem('disslxt:prefs')!).theme).toBe('dark');
    expect(screen.getByTestId('theme-dark').getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByTestId('theme-light'));
    expect(document.documentElement.dataset.theme).toBe('light');

    await userEvent.click(screen.getByTestId('theme-system'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(meta.content).toBe('#f5f5f7');
    meta.remove();
  });
});
