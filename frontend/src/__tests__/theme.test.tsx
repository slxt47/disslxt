import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { usePrefs } from '../store/prefs';

afterEach(() => usePrefs.getState().set({ theme: 'dark' }));

describe('appearance', () => {
  it('Hell / Dunkel set data-theme and the bar colour, and persist', async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    render(<AppearanceSettings />);
    expect(screen.getByTestId('theme-dark').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('theme-system')).toBeNull();

    await userEvent.click(screen.getByTestId('theme-light'));
    await userEvent.click(screen.getByTestId('theme-dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.content).toBe('#04050d');
    expect(JSON.parse(localStorage.getItem('disslxt:prefs')!).theme).toBe('dark');
    expect(screen.getByTestId('theme-dark').getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByTestId('theme-light'));
    expect(document.documentElement.dataset.theme).toBe('light');

    expect(meta.content).toBe('#dfe5ff');
    meta.remove();
  });
});
