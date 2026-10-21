import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { safePath } from '../navigation';
import { syncPushSubscription } from './push';

/** Handles messages from the service worker: notification clicks and rotated subscriptions. */
export function ServiceWorkerBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; url?: string } | null;
      if (data?.type === 'navigate' && typeof data.url === 'string') navigate(safePath(data.url));
      if (data?.type === 'resubscribe') void syncPushSubscription().catch(() => undefined);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    // Bind this browser's subscription to the account that is logged in now.
    void syncPushSubscription().catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
}
