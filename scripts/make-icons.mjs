// Generate the app icon set from one flat mark: an accent-red ground with an
// off-white "I", zero radius — the Modernist system's own vocabulary.
//
// Run after changing the mark: `node scripts/make-icons.mjs`.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "icons");

const GROUND = [0xec, 0x30, 0x13];
const INK = [0xf3, 0xf2, 0xf2];

/** The mark, drawn procedurally so every size stays crisp. */
function pixels(size) {
  const data = Buffer.alloc(size * size * 4);
  // Serif "I": a stem with a slab top and bottom.
  const stemW = Math.max(2, Math.round(size * 0.14));
  const slabW = Math.max(4, Math.round(size * 0.42));
  const barH = Math.max(2, Math.round(size * 0.11));
  const top = Math.round(size * 0.24);
  const bottom = Math.round(size * 0.76);
  const midX = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - midX + 0.5);
      const inStem = dx <= stemW / 2 && y >= top && y <= bottom;
      const inTop = dx <= slabW / 2 && y >= top && y < top + barH;
      const inBottom = dx <= slabW / 2 && y > bottom - barH && y <= bottom;
      const [r, g, b] = inStem || inTop || inBottom ? INK : GROUND;
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function png(size) {
  const raw = pixels(size);
  // PNG stores each scanline behind a filter byte; filter 0 is "none".
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 4 + 1)] = 0;
    raw.copy(
      scanlines,
      y * (size * 4 + 1) + 1,
      y * size * 4,
      (y + 1) * size * 4,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });

const sizes = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
  "Square30x30Logo.png": 30,
  "Square44x44Logo.png": 44,
  "Square71x71Logo.png": 71,
  "Square89x89Logo.png": 89,
  "Square107x107Logo.png": 107,
  "Square142x142Logo.png": 142,
  "Square150x150Logo.png": 150,
  "Square284x284Logo.png": 284,
  "Square310x310Logo.png": 310,
  "StoreLogo.png": 50,
};

for (const [name, size] of Object.entries(sizes)) {
  writeFileSync(join(OUT, name), png(size));
}

// .ico and .icns are containers; let Tauri's own tooling build them from the
// 512px master rather than hand-rolling two more binary formats.
try {
  execFileSync(
    "npx",
    ["--yes", "@tauri-apps/cli", "icon", join(OUT, "icon.png"), "-o", OUT],
    { cwd: ROOT, stdio: "inherit" },
  );
} catch {
  console.warn(
    "tauri icon did not run; icon.ico / icon.icns were not regenerated",
  );
}

console.log(`Wrote ${Object.keys(sizes).length} PNG icons to ${OUT}`);
