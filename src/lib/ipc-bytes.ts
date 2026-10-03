/**
 * Pixels over the bridge as bytes, not as base64 inside JSON.
 *
 * A 300 DPI sketch over most of a letter page is 27 MB of RGBA. Sent as a
 * base64 string in a JSON argument it cost 943 ms to encode and 193 ms to
 * serialise, on this thread, before Rust had seen any of it — and 3.6 s to
 * encode at 600 DPI. Tauri 2 takes a `Uint8Array` as the raw body of a
 * request, so the commands that carry pixels take one packed body instead:
 *
 * ```text
 * u32, little-endian   length of the JSON that follows
 * JSON                 the arguments, each buffer replaced by {"$bytes": n},
 *                      plus "$lengths": [len0, len1, …]
 * bytes                buffer 0, then buffer 1, … back to back
 * ```
 *
 * Building it is one copy of each buffer: 17 ms for the same 27 MB. The Rust
 * half, and why Android is refused, is `src-tauri/src/ipc_bytes.rs`.
 */

import { invoke } from "@tauri-apps/api/core";

type Buffer = Uint8Array | Uint8ClampedArray;

function isBuffer(value: unknown): value is Buffer {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray;
}

/**
 * The arguments with every buffer in them swapped for a reference, and the
 * buffers in the order the references count them.
 */
function extract(value: unknown, buffers: Buffer[]): unknown {
  if (isBuffer(value)) {
    buffers.push(value);
    return { $bytes: buffers.length - 1 };
  }
  if (Array.isArray(value)) return value.map((item) => extract(item, buffers));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = extract(item, buffers);
    }
    return out;
  }
  return value;
}

/** One request body: the arguments as JSON, then every buffer in them. */
export function packBytes(args: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const buffers: Buffer[] = [];
  const json = extract(args, buffers) as Record<string, unknown>;
  json.$lengths = buffers.map((buffer) => buffer.byteLength);
  const head = new TextEncoder().encode(JSON.stringify(json));

  const total = 4 + head.byteLength + buffers.reduce((n, b) => n + b.byteLength, 0);
  const body = new Uint8Array(total);
  new DataView(body.buffer).setUint32(0, head.byteLength, true);
  body.set(head, 4);
  let at = 4 + head.byteLength;
  for (const buffer of buffers) {
    body.set(buffer, at);
    at += buffer.byteLength;
  }
  return body;
}

/**
 * The other way round: the arguments, with each reference put back as the
 * bytes it named. Rust does this for real; this is for the browser harness,
 * which stands in for Rust, and for the tests.
 */
export function unpackBytes(body: Uint8Array): Record<string, unknown> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const length = view.getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)));
  const buffers: Uint8Array[] = [];
  let at = 4 + length;
  for (const n of json.$lengths as number[]) {
    buffers.push(body.subarray(at, at + n));
    at += n;
  }
  delete json.$lengths;
  const restore = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(restore);
    if (value && typeof value === "object") {
      const index = (value as { $bytes?: unknown }).$bytes;
      if (typeof index === "number") return buffers[index];
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, restore(item)]),
      );
    }
    return value;
  };
  return restore(json) as Record<string, unknown>;
}

/** `invoke`, for a command whose arguments carry buffers. */
export function invokeBytes<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, packBytes(args));
}
