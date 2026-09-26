/**
 * Shrink phone photos in the browser before uploading: a 12-megapixel JPEG
 * becomes a few hundred KB, so batches upload fast even on mobile data. It also
 * converts iPhone HEIC photos where the browser can decode them (Safari).
 * If anything fails, the original file is sent and the server handles it.
 */
const MAX_EDGE = 2400;

export async function prepareImage(file: File): Promise<Blob> {
  const isSmallJpeg = file.type === 'image/jpeg' && file.size < 1_500_000;
  if (isSmallJpeg || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file;
  }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|tiff?)$/i.test(file.name);
}

/** Natural sort so IMG_2.jpg comes before IMG_10.jpg. */
export function sortByName(files: File[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}
