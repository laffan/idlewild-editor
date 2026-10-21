# The iPad

What the device asks for that a Mac does not, and the notes that only exist
because of it.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## The iPad's safe area

`viewport-fit=cover` hands the webview the whole screen, status bar and home
indicator included, so every piece of chrome that touches an edge has to inset
itself back out of them. `tokens.css` exposes the four `env(safe-area-inset-*)`
values as custom properties, which is what lets a rule do arithmetic on them
and gives a browser without them a zero to fall back to.

The chrome grows *into* the inset rather than being pushed off it: the editor
header stands `--bar-h` tall below the status bar and pads upward to cover it,
so its own colour runs to the top of the screen instead of leaving the light
body showing through. The console drawer does the same downward past the home
indicator, the home screen's bar does it at the top, and the code panel does it
only while it is floating — docked it is a row between two rows and insets
nothing.

### No status bar while the window fills the screen

`src-tauri/tauri-plugin-ipad-chrome` — a local Tauri plugin with a Swift half,
ported from hush's pencil plugin, where the same thing is a setting. iOS has no
app-wide switch any more (`UIApplication.statusBarHidden` does nothing for an
app linked against the iOS 27 SDK), so the plugin sets tao's root view
controller's `prefersStatusBarHidden` on each window that fills its screen,
and auto-hides the home indicator. That needs
`UIViewControllerBasedStatusBarAppearance` left at YES, which
`patch-ios-plist.mjs` now writes. With the bar gone the window controls go
with it, so while a trackpad or mouse pointer is in the top-left corner the
bar comes back, drawn over the page rather than pushing it down
(`CornerHover`, and a negative `additionalSafeAreaInsets.top` for the length
of the peek) — into the strip the page keeps clear for the menu bar, below. A windowed scene keeps its bar. On a Mac the window simply opens
in native full screen (`lib.rs`'s setup).

### Room for the menu bar, while a pointer is attached

A full-screen window shows no status bar and no window controls, but from
iPadOS 26 the system's **menu bar** — window controls included — comes down
over the top of the page whenever a trackpad or mouse pointer reaches the top
edge. That is where the header's buttons are, and the back arrow under the
controls is the first one lost. There is no API to turn the reveal off:
iPadOS 27 adds a user setting to keep the bar *always* shown (Settings →
Multitasking & Gestures), and nothing to keep it hidden.

So the page keeps the strip clear instead. `lib/window-chrome.ts` sets
`html.menu-bar-room` while the window fills its screen **and** a pointer is
attached — `(any-pointer: fine)`, or the first `mouse`-type pointer event,
which is what an iPad reports for a trackpad — and `tokens.css` makes
`--safe-top` the larger of the real inset and `--menu-bar-room` (28px). Every
top inset already reads `--safe-top`, so the header, the home screen's bar,
the sheets and the floating code panel all stand below the strip, and the bar
comes down over the header's own colour. A finger never reveals the bar, so a
touch-only iPad keeps the whole screen. The 28px is measured rather than
reported, and is worth checking against each new iPadOS.

`CornerHover`, the plugin's own peek that shows the status bar while the
pointer is in the top-left corner, used to trigger anywhere in the corner's
top 40pt — over the back arrow, so reaching for the arrow brought the bar down
on top of it. It now triggers only in the top 10pt and holds within the 28pt
strip.

### Room for the window controls

From iPadOS 26 a window that does not fill the screen carries the system's
three window controls in its top-left corner, over the page. Nothing reports
the room they take — `env(safe-area-inset-*)` does not include them, and
UIKit's corner-adapted layout region has no web counterpart — so
`lib/window-chrome.ts` compares the viewport with the screen (either way
round) and sets `html.ipad-windowed`, which sets `--window-controls` in
`tokens.css`. The editor header and the home screen's bar pad their left edge
by the larger of that and `--safe-left`, so the back arrow is never under the
controls. The width is measured rather than reported, and is the one number
here worth checking against a new iPadOS.

---

## The iPad needs a scene

Apps built against the **iOS 27 SDK** must adopt the UIKit scene life cycle or
they are refused at launch — "Apps built with the latest SDK must adopt the
scene-based life cycle or they fail to launch", in that release's UIKit
deprecations. The refusal is an `EXC_BREAKPOINT` inside
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before any of
this app's own code runs, so there is nothing in the console and nothing on
screen: the app quits as it opens.

It arrives with the *toolchain* rather than with the device. Updating the Mac
that builds is enough — the new Xcode brings the new SDK, the next build links
against it, and an iPad that was running yesterday's build stops running
today's. macOS is untouched throughout, because `UIScene` is UIKit's and the
desktop app is AppKit; the same bundle and the same Rust behave differently
because only one of the two platforms has the mandate.

**The switch is one Info.plist key, and it is not the one you would guess.**
This project is pinned to tao 0.35.3 — `tauri 2.11.5` depends on
`tauri-runtime-wry`, which requires `tao ^0.35.0` — and in that version a
single predicate decides whether the scene path is taken at all:

```rust
// tao 0.35.3, src/platform_impl/ios/scene.rs
pub unsafe fn multiple_scenes_enabled() -> bool {
  // Info.plist → UIApplicationSceneManifest → UIApplicationSupportsMultipleScenes
}
```

It gates three separate things, and all three have to happen:

| Call site | What it does when the key is true |
|---|---|
| `view.rs:750` | adds `application:configurationForConnectingSceneSession:options:` to the app delegate |
| `app_state.rs:611` | defers `did_finish_launching` to the first scene instead of running `on_app_ready()` |
| `view.rs:540` | attaches the `UIWindow` to a `UIWindowScene` |

So declaring a scene delegate statically and leaving the flag false is not a
lighter-touch version of the same fix: it produces a scene that connects, an
app that has already started up the old way, and a window that never joins the
scene. The flag is the fix, and `scripts/patch-ios-plist.mjs` writes it — a
third block beside the document types and the ATS exception, in the file that
exists for exactly the things `tauri.conf.json` cannot reach.

tao supplies the rest itself: `configuration_for_connecting_scene_session`
(`view.rs:629`) builds the `UISceneConfiguration` and sets `TaoSceneDelegate`
as its delegate class, so the plist does not have to. The block writes a
static `UISceneConfigurations` entry anyway, naming the same class under the
same configuration name tao uses — it is what UIKit falls back to if it ever
does not get an answer from the delegate, and matching the names is what stops
the two descriptions from disagreeing.

**What it costs is multi-window.** `UIApplicationSupportsMultipleScenes` is a
statement to the OS as well as a flag tao reads: on an iPad
`UIApplication.supportsMultipleScenes` is true, so the system will now offer a
second window of the editor. That sits badly beside **One game at a time** —
`PluginCache` is a module-level singleton and two editors over one store is the
condition that section exists to prevent — and nothing yet refuses the second
scene. It is listed under **Known gaps**. The trade was taken deliberately:
the alternative is an app that does not start.

**Why not just upgrade tao.** 0.37.0 fixes this properly — it always installs
`application:configurationForConnectingSceneSession:options:` and attaches
windows to a scene whenever one connects, rather than only when the plist
enables multiple scenes — and it would let the flag go back to false. It is not
reachable from stable Tauri 2: `tauri-runtime-wry 2.11.4` requires `tao
^0.35.0`, so `cargo update` can only ever land on 0.35.x, and only
`tauri-runtime-wry 3.0.0-alpha.1` moves to `^0.37.0`. A `[patch.crates-io]`
override is not a shortcut either, because 0.36 moved the mobile lifecycle
events onto `WindowEvent` and 2.x is not written against that. When a Tauri 2
release carries tao ≥ 0.37, this block and the gap below come out together.

**The patch script is now load-bearing rather than cosmetic.** It runs from
`beforeBuildCommand`, so `tauri ios build` applies it and `tauri ios dev` does
not — which used to mean a dev build with broken images and now means a dev
build that will not launch. Run `node scripts/patch-ios-plist.mjs` by hand
after `tauri ios init`; the generated plist is kept, so once is enough.

The other half of that release's launch prerequisites is a launch screen — the
final plist has to declare one of `UILaunchStoryboardName`, `UILaunchStoryboards`,
`UILaunchScreen` or `UILaunchScreens`. Tauri's generated plist carries
`UILaunchStoryboardName`, so nothing is added for it here; it is worth checking
rather than assuming after any `tauri ios init`.
