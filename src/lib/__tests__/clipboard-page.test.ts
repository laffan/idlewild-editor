import { describe, expect, it } from "vitest";
import { pageFromPixels } from "../print-dimensions";
import { psdHeaderSize } from "../image-size";
import { PAGE_RANGE } from "../print";

describe("a page sized from the clipboard", () => {
  it("is the image's pixels at the DPI, in points", () => {
    // 3000 px at 300 DPI is ten inches: 720 points.
    expect(pageFromPixels({ width: 3000, height: 1500 }, 300)).toEqual({
      width: 720,
      height: 360,
      clamped: false,
    });
  });

  it("is fitted to the sizes a page can be, and says so", () => {
    const page = pageFromPixels({ width: 100_000, height: 10 }, 150);
    expect(page.width).toBe(PAGE_RANGE.max);
    expect(page.height).toBe(PAGE_RANGE.min);
    expect(page.clamped).toBe(true);
  });

  it("reads a PSD's size off its header", () => {
    const bytes = new Uint8Array(26);
    bytes.set([0x38, 0x42, 0x50, 0x53]); // 8BPS
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1);
    view.setUint32(14, 480); // height
    view.setUint32(18, 640); // width
    expect(psdHeaderSize(bytes)).toEqual({ width: 640, height: 480 });
    expect(psdHeaderSize(new Uint8Array(26))).toBeNull();
  });
});
