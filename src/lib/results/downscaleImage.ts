/** Longest side allowed for a photo of the answer key, in pixels. */
export const MAX_EDGE = 2000;
/** The server refuses larger images. */
export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

export const TOO_BIG = "This photo is still too large after shrinking it. Please take it again closer to the page, or upload a PDF instead.";

/** Size that fits inside `max` on the longest side, never enlarging. */
export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const isImageFile = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);

/**
 * Shrinks a phone photo in the browser (long side at most 2000 px, JPEG) before it is uploaded.
 * PDFs are returned untouched. Rejects with a plain message when the result is still too large.
 */
export async function downscalePhoto(file: File): Promise<File> {
  if (!isImageFile(file)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo could not be opened. Please try another photo, or upload a PDF.");
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // a PNG with transparency would turn black as a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("This photo could not be prepared. Please try another photo, or upload a PDF.");
    if (blob.size > MAX_IMAGE_BYTES) throw new Error(TOO_BIG);
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
