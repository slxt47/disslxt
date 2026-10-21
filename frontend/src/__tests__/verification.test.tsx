import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import { api } from '../api/endpoints';
import { CheckInbox, RESEND_COOLDOWN_S } from '../components/CheckInbox';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { useAuthStore } from '../store/auth';

const TOKEN = 'A'.repeat(43);
const user = { id: 'u1', email: 'alice@example.com', username: 'alice' };

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="location">{`${pathname}${search}${hash}`}</output>;
}

/** Renders like the real app: StrictMode on, so double-invoked initialisers are caught. */
function renderAt(path: string, element: React.ReactElement) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path={path.split(/[?#]/)[0]} element={element} />
          <Route path="/" element={<p>home</p>} />
          <Route path="/invite/:code" element={<p>invite page</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  useAuthStore.setState({ user: null, status: 'guest', loggedOut: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('VerifyEmailPage', () => {
  it('removes the token from the address bar and only redeems it on click', async () => {
    const verify = vi.spyOn(api, 'verifyEmail').mockResolvedValue({ user, next: null });
    renderAt(`/verify-email#token=${TOKEN}`, <VerifyEmailPage />);

    expect(location()).toBe('/verify-email');
    expect(verify).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('verify-submit'));
    expect(verify).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByText('home')).toBeTruthy();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user });
  });

  it('continues at the stored next path (e.g. the invite)', async () => {
    vi.spyOn(api, 'verifyEmail').mockResolvedValue({ user, next: '/invite/AbC' });
    renderAt(`/verify-email#token=${TOKEN}`, <VerifyEmailPage />);
    await userEvent.click(screen.getByTestId('verify-submit'));
    expect(await screen.findByText('invite page')).toBeTruthy();
  });

  it('never follows an off-site next path', async () => {
    vi.spyOn(api, 'verifyEmail').mockResolvedValue({ user, next: '//evil.example' });
    renderAt(`/verify-email#token=${TOKEN}`, <VerifyEmailPage />);
    await userEvent.click(screen.getByTestId('verify-submit'));
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('shows an error and no button for a missing or malformed token', () => {
    renderAt('/verify-email#token=nope', <VerifyEmailPage />);
    expect(screen.getByTestId('form-error').textContent).toMatch(/unvollständig/);
    expect(screen.queryByTestId('verify-submit')).toBeNull();
  });

  it('hides the button once the server says the link is dead', async () => {
    vi.spyOn(api, 'verifyEmail').mockRejectedValue(
      new ApiRequestError(400, 'VERIFICATION_INVALID', 'Der Bestätigungslink ist abgelaufen.'),
    );
    renderAt(`/verify-email#token=${TOKEN}`, <VerifyEmailPage />);
    await userEvent.click(screen.getByTestId('verify-submit'));
    expect((await screen.findByTestId('form-error')).textContent).toMatch(/abgelaufen/);
    expect(screen.queryByTestId('verify-submit')).toBeNull();
    expect(useAuthStore.getState().status).toBe('guest');
  });
});

describe('VerifyEmailPage, second link in the same tab', () => {
  it('a hash-only navigation to a new link replaces the dead one', async () => {
    const verify = vi
      .spyOn(api, 'verifyEmail')
      .mockRejectedValueOnce(
        new ApiRequestError(400, 'VERIFICATION_INVALID', 'Der Bestätigungslink ist abgelaufen.'),
      )
      .mockResolvedValueOnce({ user, next: null });
    function OpenSecondLink() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(`/verify-email#token=${'B'.repeat(43)}`)}>
          second link
        </button>
      );
    }
    renderAt(
      `/verify-email#token=${TOKEN}`,
      <>
        <OpenSecondLink />
        <VerifyEmailPage />
      </>,
    );
    await userEvent.click(screen.getByTestId('verify-submit'));
    await screen.findByTestId('form-error');
    expect(screen.queryByTestId('verify-submit')).toBeNull();

    await userEvent.click(screen.getByText('second link'));
    expect(location()).toBe('/verify-email');
    expect(screen.queryByTestId('form-error')).toBeNull();
    await userEvent.click(screen.getByTestId('verify-submit'));
    expect(verify).toHaveBeenLastCalledWith('B'.repeat(43));
    expect(await screen.findByText('home')).toBeTruthy();
  });
});

describe('RegisterPage', () => {
  it('shows "check your inbox" instead of logging in, and passes the invite along', async () => {
    const register = vi.spyOn(api, 'register').mockResolvedValue({ status: 'verification_sent' });
    renderAt('/register?next=%2Finvite%2FAbC', <RegisterPage />);
    await userEvent.type(screen.getByTestId('email'), 'Alice@Example.com');
    await userEvent.type(screen.getByTestId('username'), 'alice');
    await userEvent.type(screen.getByTestId('password'), 'Correct-Horse-7');
    await userEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('check-inbox')).toBeTruthy();
    expect(screen.getByTestId('check-inbox-email').textContent).toBe('alice@example.com');
    expect(register).toHaveBeenCalledWith({
      email: 'alice@example.com',
      username: 'alice',
      password: 'Correct-Horse-7',
      next: '/invite/AbC',
    });
    expect(useAuthStore.getState().status).toBe('guest');
  });
});

describe('LoginPage', () => {
  it('EMAIL_NOT_VERIFIED shows the inbox hint with an immediately usable resend', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(
      new ApiRequestError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Bitte bestätige zuerst deine E-Mail-Adresse.',
      ),
    );
    const resend = vi.spyOn(api, 'resendVerification').mockResolvedValue({
      status: 'verification_sent',
    });
    renderAt('/login', <LoginPage />);
    await userEvent.type(screen.getByTestId('email'), 'alice@example.com');
    await userEvent.type(screen.getByTestId('password'), 'correct horse');
    await userEvent.click(screen.getByTestId('login-submit'));

    const button = (await screen.findByTestId('resend-verification')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(resend).toHaveBeenCalledWith('alice@example.com');
  });
});

describe('CheckInbox', () => {
  it('blocks "send again" for the cooldown after a mail went out', async () => {
    vi.useFakeTimers();
    const resend = vi.spyOn(api, 'resendVerification').mockResolvedValue({
      status: 'verification_sent',
    });
    render(<CheckInbox email="a@example.com" />);
    const button = screen.getByTestId('resend-verification') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(`${RESEND_COOLDOWN_S} s`);

    for (let i = 0; i < RESEND_COOLDOWN_S; i++) {
      await act(() => vi.advanceTimersByTime(1000));
    }
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(resend).toHaveBeenCalledWith('a@example.com');
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/neuen Link geschickt/)).toBeTruthy();
  });
});
