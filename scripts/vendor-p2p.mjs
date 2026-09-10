// Build psd-to-phaser from source into vendor/psd-to-phaser/.
//
// psd-to-phaser `main` targets Phaser 4 but publishes no dist/ and has no
// `prepare` script, so neither `npm i psd-to-phaser` (registry: 0.0.5, the
// Phaser 3 line) nor a git dependency yields a usable build. This clones a
// pinned ref, builds it, and copies the artifacts in. The results are
// committed so a fresh clone works offline; re-run this to move the pin.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, ".p2p-src");
const OUT = join(ROOT, "vendor", "psd-to-phaser");
const REPO = "https://github.com/laffan/psd-to-phaser";
const REF = process.env.P2P_REF ?? "main";

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (existsSync(SRC)) rmSync(SRC, { recursive: true, force: true });
run("git", ["clone", REPO, SRC]);
run("git", ["checkout", REF], SRC);
run("npm", ["install", "--no-audit", "--no-fund"], SRC);
run("npm", ["run", "build"], SRC);

mkdirSync(OUT, { recursive: true });
for (const f of ["psd-to-phaser.es.js", "psd-to-phaser.umd.js", "index.d.ts"]) {
  const from = join(SRC, "dist", f);
  if (existsSync(from)) cpSync(from, join(OUT, f));
}

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: SRC })
  .toString()
  .trim();
writeFileSync(
  join(OUT, "PINNED.json"),
  `${JSON.stringify({ repo: REPO, ref: REF, commit: sha }, null, 2)}\n`,
);

// Exported games load both runtimes as plain <script> tags, and the Rust
// side include_str!s them, so keep src-tauri/vendor in step with what the
// editor itself runs.
const vendorForExport = join(ROOT, "src-tauri", "vendor");
mkdirSync(vendorForExport, { recursive: true });
const umd = join(OUT, "psd-to-phaser.umd.js");
if (existsSync(umd)) cpSync(umd, join(vendorForExport, "psd-to-phaser.umd.js"));

const phaser = join(ROOT, "node_modules", "phaser", "dist", "phaser.min.js");
if (existsSync(phaser)) {
  cpSync(phaser, join(vendorForExport, "phaser.min.js"));
} else {
  console.warn("phaser.min.js not found — run npm install first");
}

console.log(`Vendored psd-to-phaser @ ${sha}`);
