/**
 * Square, centre-cropped copy of a picture (profile and server pictures), small enough to upload
 * quickly. WebP where the browser can encode it (Safari < 17 cannot), otherwise JPEG.
 */
export async function squareImage(file: Blob, size = 256): Promise<Blob> {
  const source = await load(file);
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!w || !h) throw new Error('Das Bild konnte nicht gelesen werden.');
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  if ('close' in source) source.close();
  const webp = await toBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg');
  if (!jpeg) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  return jpeg;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.88));
}

async function load(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through: e.g. HEIC on browsers whose bitmap decoder refuses it.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Dieses Bildformat wird nicht unterstützt. Bitte JPEG, PNG oder WebP wählen.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
