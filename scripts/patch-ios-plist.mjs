/**
 * Patches the generated iOS Info.plist with the three things Tauri's config
 * cannot reach.
 *
 * `UIApplicationSceneManifest` is the one the app will not launch without.
 * Apps built against the iOS 27 SDK must adopt the UIScene life cycle or
 * UIKit refuses to start them — see **The iPad needs a scene** in
 * `Docs/ipad.md`. Tauri's generated plist does not declare it, and the tao
 * this project is pinned to reads that key to decide whether to take the
 * scene path at all.
 *
 * `CFBundleDocumentTypes` puts the app in the iOS share sheet for PSDs and
 * images — `fileAssociations` in tauri.conf.json does not make it into the
 * iOS plist on its own.
 *
 * `NSAppTransportSecurity` lets the webview talk to the app's own asset
 * server. psd-to-phaser reads the project store over HTTP on `127.0.0.1` and
 * by no other route (see src-tauri/src/file_server.rs), and App Transport
 * Security refuses plain HTTP from web content by default —
 * `NSAllowsArbitraryLoadsInWebContent` is NO unless it is said otherwise, and
 * it is the key that governs WKWebView traffic specifically. There is no ATS
 * on macOS, so a project whose images load perfectly well on a Mac places
 * every one of them as an empty selection box on an iPad, and the only
 * symptom is one load failure per PSD.
 *
 * Every block is inserted independently and each is skipped if its key is
 * already there, so a plist patched by an earlier build still picks up the
 * rest. Safe to run on every build — it exits quietly when the iOS project
 * has not been initialised.
 *
 * Note it runs from `beforeBuildCommand`, so `tauri ios build` applies it and
 * `tauri ios dev` does not. Run `node scripts/patch-ios-plist.mjs` by hand
 * after `tauri ios init` if you are only ever running dev; the generated
 * plist is kept, so it only has to happen once. That used to cost a dev build
 * its images; since iOS 27 it costs it the launch.
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

// Scoped to web content rather than to the whole app: the only plain-HTTP
// traffic this app makes is the webview reading its own asset server over
// loopback, and the blanket NSAllowsArbitraryLoads is both broader than that
// and a thing App Review asks about. NSAllowsLocalNetworking is kept beside
// it for the same request seen as a local-network one.
const ATS_XML = `\t<key>NSAppTransportSecurity</key>
\t<dict>
\t\t<key>NSAllowsArbitraryLoadsInWebContent</key>
\t\t<true/>
\t\t<key>NSAllowsLocalNetworking</key>
\t\t<true/>
\t</dict>`;

// The UIScene life cycle, which iOS 27 made compulsory: an app built against
// that SDK and still starting up the old way is refused at launch, with an
// EXC_BREAKPOINT in UIKit's
// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`.
//
// `UIApplicationSupportsMultipleScenes` is doing more work here than its name
// suggests. In tao 0.35.3 — which is what `tauri 2.11.5` pins, through
// `tauri-runtime-wry`'s `tao ^0.35.0` — that one key is the switch for the
// whole scene path: `multiple_scenes_enabled()` reads it, and it gates
// installing `application:configurationForConnectingSceneSession:options:`
// (view.rs:750), deferring startup to the first scene (app_state.rs:611) and
// attaching the window to a `UIWindowScene` (view.rs:540). Declaring the
// delegate statically while leaving this false gets a scene delegate and a
// window that never joins the scene.
//
// The `UISceneConfigurations` entry below is belt and braces. tao builds its
// own configuration and sets the delegate class in
// `configuration_for_connecting_scene_session` (view.rs:629), so UIKit asks
// the app delegate and never reads this — but a statically named
// `TaoSceneDelegate` is what UIKit falls back to if it ever does not, and the
// name matches the one tao uses so the two cannot disagree.
const SCENE_MANIFEST_XML = `\t<key>UIApplicationSceneManifest</key>
\t<dict>
\t\t<key>UIApplicationSupportsMultipleScenes</key>
\t\t<true/>
\t\t<key>UISceneConfigurations</key>
\t\t<dict>
\t\t\t<key>UIWindowSceneSessionRoleApplication</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>UISceneConfigurationName</key>
\t\t\t\t\t<string>TaoScene</string>
\t\t\t\t\t<key>UISceneDelegateClassName</key>
\t\t\t\t\t<string>TaoSceneDelegate</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t</dict>
\t</dict>`;

const BLOCKS = [
  { key: "CFBundleDocumentTypes", xml: DOCUMENT_TYPES_XML },
  { key: "NSAppTransportSecurity", xml: ATS_XML },
  { key: "UIApplicationSceneManifest", xml: SCENE_MANIFEST_XML },
];

if (!existsSync(PLIST_PATH)) {
  // No iOS project — nothing to patch (desktop build or ios init not run yet)
  process.exit(0);
}

let plist = readFileSync(PLIST_PATH, "utf-8");
const added = [];

for (const block of BLOCKS) {
  if (plist.includes(`<key>${block.key}</key>`)) continue;
  // Insert before the closing </dict></plist>
  const patched = plist.replace(
    /(\n)<\/dict>\s*<\/plist>/,
    `\n${block.xml}\n</dict>\n</plist>`
  );
  if (patched === plist) {
    console.warn(`⚠ Could not find where to add ${block.key} to Info.plist`);
    continue;
  }
  plist = patched;
  added.push(block.key);
}

if (added.length === 0) process.exit(0);

writeFileSync(PLIST_PATH, plist, "utf-8");
console.log(`✓ Patched iOS Info.plist with ${added.join(", ")}`);
