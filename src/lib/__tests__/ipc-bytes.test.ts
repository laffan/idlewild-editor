import { describe, expect, it } from "vitest";
import { packBytes, unpackBytes } from "../ipc-bytes";

describe("packBytes", () => {
  it("puts every buffer back where the arguments had it", () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const erase = new Uint8Array([9, 9, 9, 9]);
    const body = packBytes({
      id: "p",
      paint: { x: 1, width: 2, rgba, erase, skipped: undefined },
      parts: [{ name: "a", rgba: new Uint8Array([7]) }],
    });
    const back = unpackBytes(body) as any;
    expect(back.id).toBe("p");
    expect(back.paint.x).toBe(1);
    expect([...back.paint.rgba]).toEqual([...rgba]);
    expect([...back.paint.erase]).toEqual([...erase]);
    expect([...back.parts[0].rgba]).toEqual([7]);
    expect("skipped" in back.paint).toBe(false);
    expect("$lengths" in back).toBe(false);
  });

  it("writes the layout the Rust half reads", () => {
    const body = packBytes({ data: new Uint8Array([5, 6]) });
    const length = new DataView(body.buffer).getUint32(0, true);
    const json = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)));
    expect(json).toEqual({ data: { $bytes: 0 }, $lengths: [2] });
    expect([...body.subarray(4 + length)]).toEqual([5, 6]);
  });
});
