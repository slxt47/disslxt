import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushConfigDto } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { InstallBanner } from '../components/InstallBanner';
import { SettingsDialog } from '../components/SettingsDialog';
import { iosVersion, isIos, isStandalone, needsHomeScreenForPush } from '../pwa/platform';
import { enablePush, urlBase64ToUint8Array } from '../pwa/push';
import { RealtimeClient, type SocketLike } from '../realtime/socket';
import { usePrefs } from '../store/prefs';
import { usePushStore } from '../store/push';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

// A real P-256 public key (65 bytes, uncompressed), base64url.
const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const config: PushConfigDto = { enabled: true, publicKey: VAPID_KEY, mutedGuildIds: [] };

describe('platform detection', () => {
  const env = (userAgent: string, extra: Partial<Parameters<typeof isIos>[0]> = {}) => ({
    userAgent,
    maxTouchPoints: 0,
    ...extra,
  });

  it('recognises iPhone and iPadOS (which pretends to be a Mac)', () => {
    expect(isIos(env(IPHONE, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(env(IPAD_AS_MAC, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(env(IPAD_AS_MAC))).toBe(false); // a real Mac
    expect(isIos(env(CHROME_DESKTOP))).toBe(false);
    expect(iosVersion(env(IPHONE))).toBe(17);
  });

  it('push on iOS needs the home-screen app; standalone is detected both ways', () => {
    expect(needsHomeScreenForPush(env(IPHONE, { maxTouchPoints: 5 }))).toBe(true);
    expect(needsHomeScreenForPush(env(IPHONE, { maxTouchPoints: 5, standalone: true }))).toBe(
      false,
    );
    const media = () => ({ matches: true });
    expect(isStandalone(env(CHROME_DESKTOP, { matchMedia: media }))).toBe(true);
    expect(needsHomeScreenForPush(env(CHROME_DESKTOP))).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes the VAPID key into the 65-byte uncompressed point', () => {
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});

/** Installs fake Notification / ServiceWorker / PushManager globals. */
function fakePushBrowser(
  opts: { permission?: NotificationPermission; answer?: NotificationPermission } = {},
) {
  const calls: string[] = [];
  let subscription: {
    endpoint: string;
    options: { applicationServerKey: ArrayBuffer };
    toJSON: () => unknown;
    unsubscribe: () => Promise<boolean>;
  } | null = null;
  const Notification = {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      calls.push('requestPermission');
      Notification.permission = opts.answer ?? 'granted';
      return Notification.permission;
    }),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      calls.push('subscribe');
      subscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        options: { applicationServerKey: applicationServerKey.slice().buffer },
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'p', auth: 'a' },
        }),
        unsubscribe: async () => {
          subscription = null;
          return true;
        },
      };
      return subscription;
    }),
  };
  const reg = { pushManager };
  vi.stubGlobal('Notification', Notification);
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(reg),
      getRegistration: async () => reg,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  return { calls, Notification, pushManager };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // @ts-expect-error test cleanup of the faked property
  delete navigator.serviceWorker;
  usePushStore.getState().reset();
});

describe('enablePush', () => {
  it('asks for permission first (inside the click), then subscribes and registers server-side', async () => {
    const b = fakePushBrowser();
    const post = vi.spyOn(api, 'subscribePush').mockResolvedValue({ status: 'subscribed' });
    expect(await enablePush(config)).toBe('on');
    expect(b.calls).toEqual(['requestPermission', 'subscribe']);
    expect(post).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    });
    const key = b.pushManager.subscribe.mock.calls[0]![0];
    expect(key).toMatchObject({ userVisibleOnly: true });
  });

  it('a refused prompt subscribes nothing', async () => {
    const b = fakePushBrowser({ answer: 'denied' });
    const post = vi.spyOn(api, 'subscribePush');
    expect(await enablePush(config)).toBe('denied');
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('SettingsDialog', () => {
  it('without push support on iOS Safari shows the home-screen guide instead of a button', async () => {
    vi.spyOn(api, 'pushConfig').mockResolvedValue(config);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    render(<SettingsDialog onClose={() => {}} />);
    expect(await screen.findByTestId('install-guide')).toBeTruthy();
    expect(screen.getByTestId('push-state').dataset.state).toBe('needs-install');
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it('the permission prompt only appears after the click on "Mitteilungen aktivieren"', async () => {
    const b = fakePushBrowser();
    vi.spyOn(api, 'pushConfig').mockResolvedValue(config);
    vi.spyOn(api, 'subscribePush').mockResolvedValue({ status: 'subscribed' });
    vi.spyOn(api, 'testPush').mockResolvedValue({ delivered: 1 });
    render(<SettingsDialog onClose={() => {}} />);
    const button = await screen.findByTestId('push-enable');
    expect(b.Notification.requestPermission).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(b.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId('push-state')).dataset.state).toBe('on');
    await userEvent.click(screen.getByTestId('push-test'));
    expect(await screen.findByText('Testmitteilung verschickt.')).toBeTruthy();
  });

  it('explains how to unblock when the permission was denied', async () => {
    fakePushBrowser({ permission: 'denied' });
    vi.spyOn(api, 'pushConfig').mockResolvedValue(config);
    render(<SettingsDialog onClose={() => {}} />);
    expect((await screen.findByText(/blockiert/)).textContent).toMatch(/Einstellungen/);
  });

  it('server without VAPID keys says so', async () => {
    vi.spyOn(api, 'pushConfig').mockResolvedValue({ ...config, enabled: false, publicKey: null });
    render(<SettingsDialog onClose={() => {}} />);
    expect((await screen.findByTestId('push-state')).dataset.state).toBe('server-disabled');
  });
});

describe('InstallBanner', () => {
  beforeEach(() => usePrefs.getState().set({ installHintDismissed: false }));

  it('appears only in iOS Safari and stays closed once dismissed', async () => {
    const { unmount } = render(<InstallBanner onShowGuide={() => {}} />);
    expect(screen.queryByTestId('install-banner')).toBeNull(); // jsdom is no iPhone
    unmount();

    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    const onShowGuide = vi.fn();
    render(<InstallBanner onShowGuide={onShowGuide} />);
    await userEvent.click(screen.getByText('So geht’s'));
    expect(onShowGuide).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Hinweis schließen'));
    expect(screen.queryByTestId('install-banner')).toBeNull();
    expect(JSON.parse(localStorage.getItem('disslxt:prefs')!)).toMatchObject({
      installHintDismissed: true,
    });
  });
});

describe('RealtimeClient visibility', () => {
  it('tells the server when the tab goes to the background and back', () => {
    const sent: unknown[] = [];
    let socket!: SocketLike & { onmessage: ((ev: MessageEvent) => void) | null };
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const client = new RealtimeClient({
      url: 'ws://x/ws',
      eventTarget: null,
      visibility: doc,
      createSocket: () => {
        socket = {
          readyState: 1,
          onopen: null,
          onclose: null,
          onmessage: null,
          onerror: null,
          send: (d: string) => sent.push(JSON.parse(d)),
          close: () => {},
        };
        return socket;
      },
    });
    client.start();
    act(() =>
      socket.onmessage?.({ data: JSON.stringify({ type: 'ready', data: {} }) } as MessageEvent),
    );
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual([
      { type: 'visibility', data: { visible: false } },
      { type: 'visibility', data: { visible: true } },
    ]);
    client.stop();
  });
});
