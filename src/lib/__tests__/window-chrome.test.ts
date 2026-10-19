/**
 * Whether an iPad window has the system's window controls over its corner —
 * see `lib/window-chrome.ts`.
 */

import { describe, expect, it } from "vitest";
import { fillsScreen, isIpad } from "../window-chrome";

const IPAD_PRO = { width: 1024, height: 1366 };

describe("fillsScreen", () => {
  it("is true held either way round", () => {
    expect(fillsScreen({ width: 1024, height: 1366 }, IPAD_PRO)).toBe(true);
    expect(fillsScreen({ width: 1366, height: 1024 }, IPAD_PRO)).toBe(true);
  });

  it("is false for a window smaller than its screen", () => {
    expect(fillsScreen({ width: 900, height: 700 }, IPAD_PRO)).toBe(false);
    // Split View: the full height, half the width.
    expect(fillsScreen({ width: 683, height: 1024 }, IPAD_PRO)).toBe(false);
  });

  it("forgives a point of rounding", () => {
    expect(fillsScreen({ width: 1365.5, height: 1024 }, IPAD_PRO)).toBe(true);
  });
});

describe("isIpad", () => {
  it("knows an iPad that says it is a Mac by its touch points", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(isIpad({ userAgent: mac, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIpad({ userAgent: mac, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("is not a Windows touch screen", () => {
    expect(isIpad({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 10 })).toBe(false);
  });
});
