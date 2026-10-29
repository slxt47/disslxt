import { useState } from 'react';
import type { FileAttachmentDto } from '@disslxt/shared';
import { Icon } from './Icon';
import { Lightbox, ZoomImage } from './Lightbox';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Images show as a preview (tap opens the viewer); everything else as a download card. */
export function FileAttachment({ file }: { file: FileAttachmentDto }) {
  const [open, setOpen] = useState(false);
  if (file.isImage) {
    return (
      <>
        <button
          type="button"
          className="file-image"
          data-testid="file-image"
          aria-label={`Bild ansehen: ${file.name}`}
          title={`${file.name} · ${formatBytes(file.size)}`}
          onClick={() => setOpen(true)}
        >
          <img src={file.url} alt={file.name} loading="lazy" decoding="async" />
        </button>
        {open && (
          <Lightbox
            title={file.name}
            detail={formatBytes(file.size)}
            href={file.url}
            download={file.name}
            onClose={() => setOpen(false)}
          >
            <ZoomImage src={file.url} alt={file.name} />
          </Lightbox>
        )}
      </>
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
