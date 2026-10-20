import { useEffect } from 'react';
import { useChatStore } from '../store/chat';

export function ErrorToast() {
  const error = useChatStore((s) => s.error);
  const setError = useChatStore((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;
  return (
    <div className="toast" role="alert" data-testid="error-toast">
      <span>{error}</span>
      <button className="icon-btn" aria-label="Schließen" onClick={() => setError(null)}>
        ×
      </button>
    </div>
  );
}
