export interface CompressedImageResult {
  dataUrl: string;
  sizeKb: number;
  width: number;
  height: number;
}

const MAX_DIMENSION = 960;
const TARGET_MAX_BYTES = 140 * 1024; // Keep synced realtime payloads super snappy (~40-140KB)

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('לא ניתן לקרוא את קובץ התמונה'));
    };
    img.src = objectUrl;
  });
}

function estimateBase64Bytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Compresses any pasted, dropped, or uploaded image on the client side using Canvas.
 * Resizes proportionally to fit within 960x960 and encodes to WebP (with JPEG fallback),
 * stepping down quality if needed so realtime sync stays instant on Vercel + Supabase.
 */
export async function compressImageBlob(blob: Blob): Promise<CompressedImageResult> {
  const img = await loadImageFromBlob(blob);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('דפדפן לא תומך בדחיסת תמונה');
  }

  // Fill white background in case pasted PNG has transparency
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // Detect WebP support in canvas.toDataURL
  const supportsWebp = canvas.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
  const mimeType = supportsWebp ? 'image/webp' : 'image/jpeg';

  let quality = 0.82;
  let dataUrl = canvas.toDataURL(mimeType, quality);

  while (estimateBase64Bytes(dataUrl) > TARGET_MAX_BYTES && quality > 0.35) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL(mimeType, quality);
  }

  // If still large (very detailed image), scale down once more to 720px max
  if (estimateBase64Bytes(dataUrl) > TARGET_MAX_BYTES * 1.35) {
    const ratio = Math.min(720 / width, 720 / height);
    if (ratio < 1) {
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      dataUrl = canvas.toDataURL(mimeType, 0.72);
    }
  }

  const sizeKb = Math.max(1, Math.round(estimateBase64Bytes(dataUrl) / 1024));
  return { dataUrl, sizeKb, width, height };
}

/**
 * Extracts an image File/Blob from a paste ClipboardEvent or DragEvent DataTransfer.
 */
export function extractImageFileFromTransfer(transfer: DataTransfer | null): File | null {
  if (!transfer) return null;

  if (transfer.items && transfer.items.length > 0) {
    for (const item of Array.from(transfer.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }

  if (transfer.files && transfer.files.length > 0) {
    for (const file of Array.from(transfer.files)) {
      if (file.type.startsWith('image/')) {
        return file;
      }
    }
  }

  return null;
}

/**
 * Reads an image directly from navigator.clipboard.read() when Host clicks "הדבק מהלוח".
 */
export async function readImageFromClipboardApi(): Promise<Blob | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    throw new Error('הדפדפן לא תומך בקריאת תמונה בכפתור — פשוט לחצו Ctrl+V ישירות!');
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      return await item.getType(imageType);
    }
  }

  return null;
}
