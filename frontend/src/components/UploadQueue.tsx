import { FILE_MAX_BYTES } from '@disslxt/shared';
import { useCallback, useRef, useState } from 'react';
import { ApiRequestError, errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { formatBytes } from './FileAttachment';
import { Icon } from './Icon';

interface Upload {
  id: number;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  controller: AbortController;
}

/** Upload state of one channel: files start uploading at once and show progress until sent. */
export function useUploads(channelId: string) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const nextId = useRef(1);

  const patch = (id: number, p: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)));
  const remove = useCallback((id: number) => setUploads((l) => l.filter((u) => u.id !== id)), []);

  const start = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = nextId.current++;
        const controller = new AbortController();
        const tooBig = file.size > FILE_MAX_BYTES;
        setUploads((l) => [
          ...l,
          {
            id,
            name: file.name || 'datei',
            size: file.size,
            progress: 0,
            error: tooBig ? `Zu groß (max. ${formatBytes(FILE_MAX_BYTES)})` : null,
            controller,
          },
        ]);
        if (tooBig) continue;
        api
          .sendFile(channelId, file, (progress) => patch(id, { progress }), controller.signal)
          .then(({ message }) => {
            useChatStore.getState().upsertMessage(message);
            remove(id);
          })
          .catch((err: unknown) => {
            if (err instanceof ApiRequestError && err.code === 'ABORTED') remove(id);
            else patch(id, { error: errorMessage(err) });
          });
      }
    },
    [channelId, remove],
  );

  return { uploads, start, remove };
}

export function UploadQueue({
  uploads,
  onRemove,
}: {
  uploads: Upload[];
  onRemove: (id: number) => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <ul className="upload-queue" aria-label="Uploads">
      {uploads.map((u) => (
        <li key={u.id} className={u.error ? 'failed' : ''} data-testid="upload-item">
          <Icon name="paperclip" size={16} />
          <span className="upload-name">{u.name}</span>
          {u.error ? (
            <span className="upload-error" role="alert">
              {u.error}
            </span>
          ) : (
            <span className="upload-progress" aria-label={`${Math.round(u.progress * 100)} %`}>
              <span style={{ transform: `scaleX(${u.progress})` }} />
            </span>
          )}
          <span className="upload-size">{formatBytes(u.size)}</span>
          <button
            className="icon-btn"
            aria-label={u.error ? 'Ausblenden' : 'Upload abbrechen'}
            onClick={() => (u.error ? onRemove(u.id) : u.controller.abort())}
          >
            <Icon name="close" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
