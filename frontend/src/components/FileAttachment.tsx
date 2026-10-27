import type { FileAttachmentDto } from '@disslxt/shared';
import { Icon } from './Icon';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Images show as a preview (tap opens the original); everything else as a download card. */
export function FileAttachment({ file }: { file: FileAttachmentDto }) {
  if (file.isImage) {
    return (
      <a
        className="file-image"
        href={file.url}
        target="_blank"
        rel="noreferrer"
        data-testid="file-image"
        title={`${file.name} · ${formatBytes(file.size)}`}
      >
        <img src={file.url} alt={file.name} loading="lazy" decoding="async" />
      </a>
    );
  }
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.slice(0, 4).toUpperCase() : '';
  return (
    <a className="file-card" href={file.url} download={file.name} data-testid="file-card">
      <span className="file-icon" aria-hidden="true">
        <Icon name="file" size={26} />
        {ext && <span className="file-ext">{ext}</span>}
      </span>
      <span className="file-meta">
        <span className="file-name">{file.name}</span>
        <span className="file-size">{formatBytes(file.size)}</span>
      </span>
      <Icon name="download" size={20} />
    </a>
  );
}
