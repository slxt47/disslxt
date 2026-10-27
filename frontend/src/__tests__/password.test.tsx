import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/endpoints';
import { RegisterPage } from '../pages/RegisterPage';

afterEach(() => vi.restoreAllMocks());

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe('password policy on the registration page', () => {
  it('shows the rules live and ticks them off while typing', async () => {
    renderPage();
    expect(screen.queryByTestId('password-checklist')).toBeNull();
    await userEvent.type(screen.getByTestId('username'), 'florian');
    await userEvent.type(screen.getByTestId('password'), 'florian1');
    const ok = (id: string) => screen.getByTestId(`pw-rule-${id}`).dataset.ok;
    expect(ok('length')).toBe('false');
    expect(ok('personal')).toBe('false');
    expect(screen.getByTestId('password-checklist').dataset.strength).toBe('0');

    await userEvent.clear(screen.getByTestId('password'));
    await userEvent.type(screen.getByTestId('password'), 'Gelbe!Tulpe88');
    for (const id of ['length', 'variety', 'common', 'personal', 'repeat'])
      expect(ok(id)).toBe('true');
    expect(
      Number(screen.getByTestId('password-checklist').dataset.strength),
    ).toBeGreaterThanOrEqual(2);
  });

  it('a weak password is not sent to the server', async () => {
    const register = vi.spyOn(api, 'register');
    renderPage();
    await userEvent.type(screen.getByTestId('email'), 'a@example.com');
    await userEvent.type(screen.getByTestId('username'), 'alice');
    await userEvent.type(screen.getByTestId('password'), 'Passwort123!');
    await userEvent.click(screen.getByTestId('register-submit'));
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByTestId('form-error').textContent).toMatch(
      /Passwort erfüllt noch nicht alle Regeln/,
    );
    expect(screen.getByTestId('pw-rule-common').dataset.ok).toBe('false');
  });
});
