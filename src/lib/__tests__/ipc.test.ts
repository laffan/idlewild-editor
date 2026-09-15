/**
 * The one encoder every route out to Rust goes through.
 *
 * `toBase64` is not interesting until it is wrong, and when it is wrong it is
 * wrong in a way nothing else catches: the bytes reach Rust, decode into
 * *something*, and the artwork comes back subtly shifted or refused for a
 * length that does not match. It is also the hot path — a converted sketch is
 * ten megabytes — so it encodes in pieces rather than building one string, and
 * that is exactly the change that could have introduced a seam.
 *
 * So what is pinned here is that the pieces join back into the same string a
 * single pass would have produced, at every length around the boundaries: a
 * base64 group is three bytes, the piece size is a multiple of three, and a
 * buffer whose length is not a multiple of either is where padding appears.
 */

import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../ipc";

/** The straightforward one, as the reference. */
function whole(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Bytes that are not all the same, so a misplaced seam shows. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >> 5) * 7) & 0xff;
  return out;
}

describe("toBase64", () => {
  it("matches a single pass at every length around the seams", () => {
    // 48 KB is the piece; 3 bytes is a base64 group. Every length that could
    // put a seam in a different place relative to both.
    const piece = 3 * 16384;
    for (const n of [
      0, 1, 2, 3, 4, 5, 6, 7,
      piece - 2, piece - 1, piece, piece + 1, piece + 2, piece + 3,
      piece * 2 - 1, piece * 2, piece * 2 + 1,
      piece * 2 + 1234,
    ]) {
      const bytes = noise(n);
      expect(toBase64(bytes), `${n} bytes`).toBe(whole(bytes));
    }
  });

  /** Every raster in the editor arrives as one of these. */
  it("takes a clamped array, and its view's offset with it", () => {
    const backing = noise(3000);
    const clamped = new Uint8ClampedArray(backing.buffer, 300, 1200);
    expect(toBase64(clamped)).toBe(whole(backing.subarray(300, 1500)));
  });

  it("round-trips through the decoder beside it", () => {
    const bytes = noise(5000);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});
