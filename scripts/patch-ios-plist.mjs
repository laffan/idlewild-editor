/**
 * Patches the generated iOS Info.plist with CFBundleDocumentTypes so the app
 * appears in the iOS share sheet for PSD and image files.
 *
 * Ported from Phaser Bench: Tauri's `fileAssociations` config does not reach
 * the iOS Info.plist on its own, so the entries are injected on every build.
 *
 * Safe to run on every build — skips silently when the iOS project hasn't
 * been initialized (no Info.plist exists) or when the entries are already
 * present.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLIST_PATH = join(
  __dirname,
  "..",
  "src-tauri",
  "gen",
  "apple",
  "idlewild-editor_iOS",
  "Info.plist"
);

const DOCUMENT_TYPES_XML = `\t<key>CFBundleDocumentTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleTypeName</key>
\t\t\t<string>Photoshop Document</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Viewer</string>
\t\t\t<key>LSHandlerRank</key>
\t\t\t<string>Alternate</string>
\t\t\t<key>LSItemContentTypes</key>
\t\t\t<array>
\t\t\t\t<string>com.adobe.photoshop-image</string>
\t\t\t</array>
\t\t</dict>
\t\t<dict>
\t\t\t<key>CFBundleTypeName</key>
\t\t\t<string>PNG Image</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Viewer</string>
\t\t\t<key>LSHandlerRank</key>
\t\t\t<string>Alternate</string>
\t\t\t<key>LSItemContentTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.png</string>
\t\t\t</array>
\t\t</dict>
\t\t<dict>
\t\t\t<key>CFBundleTypeName</key>
\t\t\t<string>JPEG Image</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Viewer</string>
\t\t\t<key>LSHandlerRank</key>
\t\t\t<string>Alternate</string>
\t\t\t<key>LSItemContentTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.jpeg</string>
\t\t\t</array>
\t\t</dict>
\t\t<dict>
\t\t\t<key>CFBundleTypeName</key>
\t\t\t<string>GIF Image</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Viewer</string>
\t\t\t<key>LSHandlerRank</key>
\t\t\t<string>Alternate</string>
\t\t\t<key>LSItemContentTypes</key>
\t\t\t<array>
\t\t\t\t<string>com.compuserve.gif</string>
\t\t\t</array>
\t\t</dict>
\t</array>`;

if (!existsSync(PLIST_PATH)) {
  // No iOS project — nothing to patch (desktop build or ios init not run yet)
  process.exit(0);
}

let plist = readFileSync(PLIST_PATH, "utf-8");

if (plist.includes("CFBundleDocumentTypes")) {
  // Already patched
  process.exit(0);
}

// Insert before the closing </dict></plist>
plist = plist.replace(
  /(\n)<\/dict>\s*<\/plist>/,
  `\n${DOCUMENT_TYPES_XML}\n</dict>\n</plist>`
);

writeFileSync(PLIST_PATH, plist, "utf-8");
console.log("✓ Patched iOS Info.plist with CFBundleDocumentTypes");
