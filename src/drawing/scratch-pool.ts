/**
 * Scratch canvases for flattening a mark, sized to the mark rather than to
 * the canvas it lands on.
 *
 * A translucent stroke, a highlighter and every erasing mark are stamped at
 * full strength somewhere else and laid down once (`composited` in
 * `render.ts`). That somewhere used to be one scratch as big as the backing —
 * 4096² — and it is a detached canvas, so CPU-backed, used as a `drawImage`
 * source: WebKit takes the whole surface across each time, and Hush measured
 * that kind of read at around a quarter of a second. It was paid per mark, on
 * every re-bake, which put a plan of a few dozen 90 % strokes — or a layer
 * with a few eraser strokes on it — at seconds per pan.
 *
 * So a mark gets a scratch the size of its own box, rounded up to a power of
 * two on each side so a handful of canvases serve every mark without being
 * reallocated (assigning `canvas.width` reallocates; Hush #27).
 */

const MIN_SIDE = 64;
/** How many sizes are kept; the least recently used goes past this. */
const KEEP = 4;

const pool = new Map<string, CanvasRenderingContext2D>();

/** A cleared-by-the-caller scratch at least `width` × `height`, or null. */
export function scratchOf(width: number, height: number): CanvasRenderingContext2D | null {
  const w = bucket(width);
  const h = bucket(height);
  const key = `${w}x${h}`;
  let ctx = pool.get(key);
  if (ctx) {
    // Most recently used goes to the back of the line.
    pool.delete(key);
    pool.set(key, ctx);
    return ctx;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext("2d") ?? undefined;
  if (!ctx) return null;
  pool.set(key, ctx);
  if (pool.size > KEEP) {
    const [oldest, gone] = pool.entries().next().value as [string, CanvasRenderingContext2D];
    pool.delete(oldest);
    gone.canvas.width = 0;
    gone.canvas.height = 0;
  }
  return ctx;
}

function bucket(n: number): number {
  let side = MIN_SIDE;
  while (side < n) side *= 2;
  return side;
}
