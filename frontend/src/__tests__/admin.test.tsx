import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserDto, UserRole } from '@disslxt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/endpoints';
import { AdminPanel } from '../components/AdminPanel';
import { useAuthStore } from '../store/auth';
import { ME } from './fixtures';

const row = (username: string, role: UserRole): AdminUserDto => ({
  id: `${username}-id`,
  username,
  displayName: null,
  avatarUrl: null,
  role,
  online: false,
  createdAt: '2026-10-01T00:00:00.000Z',
});

function signInAs(role: UserRole) {
  useAuthStore.setState({
    status: 'authenticated',
    user: { ...ME, id: 'me-id', email: 'a@example.com', role },
  });
}

beforeEach(() => {
  vi.spyOn(api, 'adminUsers').mockResolvedValue({
    users: [row('theowner', 'owner'), row('theadmin', 'admin'), row('alice', 'user')],
  });
});
afterEach(() => vi.restoreAllMocks());

const renderPanel = () =>
  render(
    <MemoryRouter>
      <AdminPanel />
    </MemoryRouter>,
  );

describe('admin area', () => {
  it('is invisible for normal users and loads nothing', () => {
    signInAs('user');
    renderPanel();
    expect(screen.queryByTestId('admin-panel')).toBeNull();
    expect(api.adminUsers).not.toHaveBeenCalled();
  });

  it('owner: kick for admins and users, promote/demote, never for the owner', async () => {
    signInAs('owner');
    renderPanel();
    await screen.findByTestId('admin-user-alice');
    const within = (name: string) => screen.getByTestId(`admin-user-${name}`);
    expect(within('theowner').querySelector('button[data-testid="admin-kick"]')).toBeNull();
    expect(within('theadmin').querySelector('[data-testid="admin-demote"]')).not.toBeNull();
    expect(within('theadmin').querySelector('[data-testid="admin-kick"]')).not.toBeNull();
    expect(within('alice').querySelector('[data-testid="admin-promote"]')).not.toBeNull();
  });

  it('admin: kick only normal users, no role buttons', async () => {
    signInAs('admin');
    const kick = vi.spyOn(api, 'adminKick').mockResolvedValue(undefined);
    renderPanel();
    await screen.findByTestId('admin-user-alice');
    const within = (name: string) => screen.getByTestId(`admin-user-${name}`);
    expect(within('theadmin').querySelector('[data-testid="admin-kick"]')).toBeNull();
    expect(within('alice').querySelector('[data-testid="admin-promote"]')).toBeNull();
    // Kicking asks for a second click.
    await userEvent.click(within('alice').querySelector('[data-testid="admin-kick"]')!);
    expect(kick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('admin-kick-confirm'));
    await waitFor(() => expect(kick).toHaveBeenCalledWith('alice-id'));
  });
});
