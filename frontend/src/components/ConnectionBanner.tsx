import { useChatStore } from '../store/chat';

export function ConnectionBanner() {
  const connection = useChatStore((s) => s.connection);
  if (connection !== 'reconnecting') return null;
  return (
    <div className="connection-banner" role="status" data-testid="connection-banner">
      Verbindung getrennt – verbinde neu…
    </div>
  );
}
