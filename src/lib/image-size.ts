/**
 * How big a picture is, in pixels, without importing it.
 *
 * A PSD is read off its header — the browser cannot decode one, and the
 * header is the first twenty-six bytes — and anything else is handed to
 * `createImageBitmap`, which knows PNG, JPEG, GIF and whatever else the
 * webview can show. Used by the Clipboard row under a custom page size; see
 * `lib/print-dimensions.ts`.
 */

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * A PSD's canvas, from its header: `8BPS`, version, six reserved bytes,
 * channels, then height and width as big-endian 32-bit numbers. Null for
 * bytes that are not a PSD.
 */
export function psdHeaderSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 26) return null;
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (sig !== "8BPS") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function imageSize(file: Blob): Promise<PixelSize> {
  const head = new Uint8Array(await file.slice(0, 26).arrayBuffer());
  const psd = psdHeaderSize(head);
  if (psd) return psd;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("The clipboard is holding something that is not an image");
  }
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
