import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface LightboxProps {
  /** Shown under the picture and read out as the dialog's name. */
  title: string;
  /** Second line under the title, e.g. the file size or "via GIPHY". */
  detail?: string;
  /** Where "Original öffnen" / "Herunterladen" points; omitted = no such button. */
  href?: string;
  download?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Full-screen viewer for pictures and GIFs from the chat. Closes with Escape, the close button
 * or a tap next to the picture; focus returns to the thumbnail that opened it.
 */
export function Lightbox({ title, detail, href, download, onClose, children }: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="lightbox"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lightbox-bar">
        <div className="lightbox-title">
          <span>{title}</span>
          {detail && <small>{detail}</small>}
        </div>
        {href && (
          <a
            className="lightbox-button"
            href={href}
            download={download}
            target={download ? undefined : '_blank'}
            rel="noreferrer"
            aria-label={download ? 'Herunterladen' : 'Original öffnen'}
            title={download ? 'Herunterladen' : 'Original öffnen'}
            data-testid="lightbox-download"
          >
            <Icon name={download ? 'download' : 'share'} size={20} />
          </a>
        )}
        <button
          ref={closeRef}
          type="button"
          className="lightbox-button"
          aria-label="Schließen"
          title="Schließen (Esc)"
          data-testid="lightbox-close"
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A picture in the viewer: fits the screen; a tap zooms to full size (and back). */
export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <img
      className={zoomed ? 'lightbox-media zoomed' : 'lightbox-media'}
      src={src}
      alt={alt}
      data-testid="lightbox-image"
      data-zoomed={zoomed}
      onClick={(e) => {
        // Zoom around the spot that was tapped.
        const img = e.currentTarget;
        const rect = img.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        setZoomed((z) => !z);
        requestAnimationFrame(() => {
          const stage = img.parentElement;
          if (!stage || zoomed) return;
          stage.scrollLeft = fx * img.offsetWidth - stage.clientWidth / 2;
          stage.scrollTop = fy * img.offsetHeight - stage.clientHeight / 2;
        });
      }}
    />
  );
}
