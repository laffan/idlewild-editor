/**
 * Puts `-lz` and `-liconv` on the iOS app's link line.
 *
 * libgit2 is the whole reason publishing works on an iPad — see the `git2`
 * entry in `src-tauri/Cargo.toml` — and libgit2 needs two system libraries:
 * zlib, because a git object is a deflated blob, and libiconv, because
 * `libgit2-sys` compiles `GIT_USE_ICONV` in for **every** Apple target (it is
 * `target.contains("apple")` in its `build.rs`, with no feature to turn it
 * off) so that a path can be precomposed the way HFS wants it. Both ship in
 * the iOS SDK. Neither was being linked.
 *
 * **Why the macOS build never noticed.** On desktop, `cargo` drives the final
 * link itself, so the `cargo:rustc-link-lib=z` and `cargo:rustc-link-lib=iconv`
 * lines those two build scripts print become `-lz -liconv` on the command
 * rustc runs. On iOS nothing of the sort happens: Rust is built as a
 * `staticlib`, Xcode links it, and a `.a` carries no record of the native
 * libraries its objects still need. So the same tree that links on a Mac
 * fails on the device with a page of undefined symbols — `_deflate`,
 * `_crc32`, `_inflate`, `_iconv_open` — every one of them referenced from
 * `libapp.a` and none of them anything to do with this app's own code.
 *
 * Mach-O has a mechanism for exactly this, `LC_LINKER_OPTION`, which is what
 * puts the auto-linked frameworks on that same command; rustc does not emit
 * those for `#[link]` yet (rust-lang/rust#121293), and would not be reliable
 * from an archive member if it did. So the flags go on the Xcode side.
 *
 * **Two files, because they are read at different times.** `project.yml` is
 * the XcodeGen source and is what a regenerated project would be built from;
 * `project.pbxproj` is what `xcodebuild` actually reads, and patching it is
 * what makes the next build work without re-running XcodeGen. Both edits are
 * skipped if the setting is already there, so this is safe on every build.
 *
 * **The pbxproj half is the one that matters, and it is the one that broke.**
 * The first version of this anchored on `LIBRARY_SEARCH_PATHS[sdk=iphoneos*]`,
 * which is how **cargo-mobile2** spells it — and Tauri does not use
 * cargo-mobile2's template. It ships its own,
 * `templates/mobile/ios/project.yml`, which writes `[arch=arm64]` and
 * `[arch=x86_64]` instead. So nothing in the pbxproj matched, only the yml was
 * patched, XcodeGen does not run again on a build, and the link failed exactly
 * as it had before — while this script reported success. Hence `TARGET_ONLY`
 * below, which matches the stem rather than a bracketed variant and takes any
 * of three settings; and hence the warning, because a patch that recognises
 * nothing must not read as a patch that had nothing to do.
 *
 * `src-tauri/gen/` is not in the repository and `tauri ios init` writes it
 * fresh, which is why this is a script rather than a checked-in file. Tauri's
 * own pbxproj editing is line-based — it rewrites the lines it owns and leaves
 * the rest — so a build's `DEVELOPMENT_TEAM` and bundle-identifier sync does
 * not carry this away again.
 *
 * Runs from `beforeBuildCommand` beside `patch-ios-plist.mjs`, and from
 * `npm run ios:init`. Like that one it is `tauri ios build` that applies it
 * and `tauri ios dev` that does not, so run it by hand once after a bare
 * `tauri ios init` if you only ever run dev.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

/** The libraries libgit2 leaves undefined in `libapp.a`, and nothing else. */
const FLAGS = "$(inherited) -lz -liconv";
const SETTING = "OTHER_LDFLAGS";

/**
 * The XcodeGen source, with the setting added.
 *
 * Anchored on `ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES`, which is the last line
 * of the iOS target's own `settings.base` block in cargo-mobile2's template
 * and appears once in the file. A line rather than parsed YAML keeps this a
 * dependency-free script, and a template that moves that line gets a warning
 * rather than a mangled project.
 *
 * @returns the text, unchanged if the setting is already there, and null if
 *          the anchor could not be found at all.
 */
export function withLinkerFlagsYml(yml) {
  if (yml.includes(`${SETTING}:`)) return yml;
  const anchor = /^([ \t]*)ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES:.*$/m;
  const match = yml.match(anchor);
  if (!match) return null;
  return yml.replace(
    anchor,
    (line, indent) => `${line}\n${indent}${SETTING}: "${FLAGS}"`,
  );
}

/**
 * Settings XcodeGen writes for the **app target** and for nothing else.
 *
 * A `buildSettings` block carrying any of them is one of the app target's two
 * configurations, debug or release. The project-level blocks carry none, which
 * is what keeps the flags off configurations the app is not built from.
 *
 * Three of them rather than one because this is the part that has already
 * broken once. Tauri ships its **own** `templates/mobile/ios/project.yml`
 * rather than using cargo-mobile2's, and the two disagree about exactly this:
 * cargo-mobile2 writes `LIBRARY_SEARCH_PATHS[sdk=iphoneos*]`, Tauri writes
 * `[arch=arm64]` and `[arch=x86_64]`. Matching the bare stem covers both, and
 * any one of the three surviving a template rewrite is enough.
 */
const TARGET_ONLY = [
  "ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES",
  "LIBRARY_SEARCH_PATHS",
  "INFOPLIST_FILE",
];

/**
 * What xcodebuild actually reads, with the setting added.
 *
 * The file is rebuilt by concatenation rather than by a regex over it: a
 * `buildSettings` block is brace-delimited and nothing but brace matching
 * finds its end reliably.
 *
 * @returns `{ text, added, seen }` — `added` is how many configurations were
 *          given the setting and `seen` how many already had it. Both zero on
 *          a file this could make no sense of, which is a thing to say out
 *          loud rather than a thing to pass over: see `patch`.
 */
export function withLinkerFlagsPbxproj(pbxproj) {
  const OPEN = "buildSettings = {";
  let out = "";
  let rest = pbxproj;
  let added = 0;
  let seen = 0;

  for (;;) {
    const at = rest.indexOf(OPEN);
    if (at < 0) break;
    const brace = at + OPEN.length - 1;
    const close = matchingBrace(rest, brace);
    if (close < 0) break;

    const block = rest.slice(brace + 1, close);
    out += rest.slice(0, brace + 1);
    if (TARGET_ONLY.some((key) => block.includes(key))) {
      if (block.includes(SETTING)) seen += 1;
      else {
        out += `\n${indentOf(block)}${SETTING} = "${FLAGS}";`;
        added += 1;
      }
    }
    out += block;
    rest = rest.slice(close);
  }

  return { text: out + rest, added, seen };
}

/** The index of the `}` closing the `{` at `from`, or -1. */
function matchingBrace(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The leading whitespace of a block's first setting, so the line lines up. */
function indentOf(block) {
  return block.match(/\n([ \t]*)\S/)?.[1] ?? "\t\t\t\t";
}

function patch(appleDir) {
  const done = [];
  let warning = "";

  const yml = join(appleDir, "project.yml");
  if (existsSync(yml)) {
    const before = readFileSync(yml, "utf-8");
    const after = withLinkerFlagsYml(before);
    if (after === null) {
      console.warn(`⚠ Could not find where to add ${SETTING} to project.yml`);
    } else if (after !== before) {
      writeFileSync(yml, after, "utf-8");
      done.push("project.yml");
    }
  }

  const project = readdirSync(appleDir).find((n) => n.endsWith(".xcodeproj"));
  const pbxproj = project && join(appleDir, project, "project.pbxproj");
  if (pbxproj && existsSync(pbxproj)) {
    const { text, added, seen } = withLinkerFlagsPbxproj(
      readFileSync(pbxproj, "utf-8"),
    );
    if (added > 0) {
      writeFileSync(pbxproj, text, "utf-8");
      done.push(`${project} ×${added}`);
    }
    // The one that has to be said. project.yml is only read when XcodeGen
    // runs, so a patch that reaches it and not the pbxproj changes nothing
    // about the build about to happen — and the way that shows up is the
    // linker error this script exists to prevent, three minutes later, with
    // nothing connecting the two. Recognising no configuration at all means
    // the settings below have moved again.
    if (added === 0 && seen === 0) {
      warning =
        `⚠ Found no app-target build settings in ${project} to add ${SETTING} to.\n` +
        `  The iOS link will fail on libgit2's zlib and iconv symbols. This\n` +
        `  script looks for a buildSettings block carrying one of:\n` +
        TARGET_ONLY.map((key) => `    ${key}\n`).join("") +
        `  If Tauri's project template has moved them, that list is the fix.`;
    }
  }

  return { done, warning };
}

// Run only when this is the program, so the two transforms above can be
// imported and tested without patching anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // An explicit root is for a test or a second checkout; the default is the
  // project this script lives in.
  const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const appleDir = join(root, "src-tauri", "gen", "apple");
  // No iOS project — a desktop build, or `tauri ios init` has not been run.
  if (existsSync(appleDir)) {
    const { done, warning } = patch(appleDir);
    if (done.length > 0) {
      console.log(`✓ Linked zlib and libiconv into the iOS app: ${done.join(", ")}`);
    }
    // After the tick, so the last thing on screen is the thing that is wrong.
    if (warning) console.warn(warning);
  }
}
