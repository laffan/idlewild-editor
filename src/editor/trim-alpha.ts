/**
 * Taking the transparent field off a pasted raster.
 *
 * Copy a patch of a drawing out of Photoshop, Procreate or anything else that
 * works in layers and what reaches the pasteboard is a PNG **the size of the
 * document it came from**, with the copied marks somewhere inside it and
 * nothing but alpha around them. That is the right answer for pasting back
 * into the same document — the padding is what makes the patch land where it
 * was cut from — and the wrong one everywhere else: here the padding becomes
 * the artwork's size, so the footprint it is dropped onto is the size of
 * somebody else's canvas, the placement's handles are nowhere near the
 * picture, and the PSD written out of it is mostly nothing.
 *
 * So a paste is cropped to the pixels that are actually there. The box is the
 * smallest one holding every pixel with **any** alpha at all — nothing is
 * thresholded away, so the soft edge of a brush stroke survives intact — and
 * a raster with nothing to take off is handed back untouched rather than
 * re-encoded for no reason.
 *
 * It runs on the way in, before the bytes go to Rust, because the size is
 * needed *here*: the marks travel with the import and they describe where the
 * artwork sits, so cropping after they were worked out would mark the grid
 * for a picture that is no longer that shape. See `paste-actions.ts`.
 *
 * What it deliberately does not touch: a PSD, which the browser cannot decode
 * and which arrives as its author built it; and a **replacement** for a file
 * already in the project, which is held where it is rather than re-centred —
 * cropping one would slide the artwork out from under the placement standing
 * on it.
 */

/** A box in image pixels, top-left origin. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest box holding every pixel that is not fully transparent, or null
 * when there is no such pixel.
 *
 * `> 0` rather than a threshold: an eighth of an alpha is still ink somebody
 * drew, and a crop that ate it would take the feathered edge off every
 * pasted brush stroke. Fully transparent is the only thing this counts as
 * empty, which is also exactly what "the field around the copied portion" is.
 */
export function opaqueBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** What the import needs back: which bytes to send, and how big they are. */
export interface TrimmedImage {
  /** The crop, or the original file when there was nothing to take off. */
  file: File;
  /**
   * Its size in pixels, or null for a file the browser will not decode.
   *
   * Null is what says "this is already a document" — a PSD — which is the
   * same conclusion Rust reaches from the `8BPS` signature, from the only
   * evidence each side has. The caller marks nothing in that case.
   */
  size: { width: number; height: number } | null;
}

/**
 * Crop a pasted image to its own artwork.
 *
 * Every failure answers with the file as it arrived: a paste that cannot be
 * decoded, a canvas the platform will not give a context for, an encode that
 * comes back with nothing. None of those is a reason to refuse the import —
 * the padding is a nuisance, not a fault — so the worst case here is the
 * behaviour there was before it.
 */
export async function trimTransparent(file: File): Promise<TrimmedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, size: null };
  }

  const size = { width: bitmap.width, height: bitmap.height };
  try {
    if (size.width < 1 || size.height < 1) return { file, size: null };

    const read = context(size.width, size.height);
    if (!read) return { file, size };
    read.drawImage(bitmap, 0, 0);
    const pixels = read.getImageData(0, 0, size.width, size.height).data;

    const box = opaqueBounds(pixels, size.width, size.height);
    // Nothing to take off — and an image that is transparent *everywhere* is
    // left alone too, because a 0 × 0 import is not a better answer than the
    // empty rectangle somebody copied.
    if (!box || (box.width === size.width && box.height === size.height)) {
      return { file, size };
    }

    const cropped = await encode(bitmap, box, file.name);
    return cropped
      ? { file: cropped, size: { width: box.width, height: box.height } }
      : { file, size };
  } catch {
    return { file, size };
  } finally {
    bitmap.close();
  }
}

/** Draw the box out into a PNG of its own. */
async function encode(
  bitmap: ImageBitmap,
  box: Box,
  name: string,
): Promise<File | null> {
  const ctx = context(box.width, box.height);
  if (!ctx) return null;
  ctx.drawImage(
    bitmap,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    ctx.canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new File([blob], pngName(name), { type: "image/png" }) : null;
}

/**
 * A canvas of that size, ready to be read back.
 *
 * `willReadFrequently` is the hint for a context whose pixels are pulled into
 * JavaScript rather than composited — which is the whole of what the first
 * one here is for.
 */
function context(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * The crop is re-encoded, so it is a PNG whatever it arrived as — and the
 * name has to say so, since that is what everything downstream reads the type
 * off. (In practice only a format with alpha ever gets this far: a JPEG has
 * none, so its bounds are always the whole picture.)
 */
function pngName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem || "image"}.png`;
}
