import type { PushConfigDto } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { needsHomeScreenForPush } from './platform';

export type PushState =
  /** Server has no VAPID keys. */
  | 'server-disabled'
  /** iOS in Safari: add to home screen first. */
  | 'needs-install'
  /** Browser without Service Worker / Push API. */
  | 'unsupported'
  | 'denied'
  | 'off'
  | 'on';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The VAPID public key as the Uint8Array that PushManager.subscribe wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentPushState(config: PushConfigDto): Promise<PushState> {
  if (!config.enabled || !config.publicKey) return 'server-disabled';
  if (!pushSupported()) return needsHomeScreenForPush() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/**
 * Asks for permission and subscribes. MUST be called straight from a click handler: iOS (and
 * Safari/Firefox) only show the permission prompt in response to a user gesture.
 */
export async function enablePush(config: PushConfigDto): Promise<PushState> {
  if (!config.publicKey || !pushSupported()) return currentPushState(config);
  // Request first, before any other await, so the user gesture is still "fresh" on iOS.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const key = urlBase64ToUint8Array(config.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an old VAPID key cannot receive our pushes: replace it.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.subscribePush(
    sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
  );
  return 'on';
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.unsubscribePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** Removes this browser's subscription from the account (logout) but keeps the permission, so
 *  the next login on this device can re-register it without asking again. */
export async function detachPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api.unsubscribePush(sub.endpoint);
}

/** Re-sends the existing subscription (after login or a rotated subscription). */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api.subscribePush(
      sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
    );
  }
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Registers /sw.js. Called once at start-up; failures only cost offline/push support. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
}
