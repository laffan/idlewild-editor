/**
 * Room for the iPad's window controls, when the window has them.
 *
 * From iPadOS 26 a window that does not fill the screen — Stage Manager,
 * Split View, the new windowing — carries the system's three window controls
 * in its top-left corner, drawn over whatever the app has there. Here that is
 * the header's back arrow, which is the only way back to the project list.
 *
 * There is no inset for them: `env(safe-area-inset-*)` says nothing about the
 * controls in a web view, and the UIKit API that would (a layout region with
 * corner adaptation) has no counterpart on the web side. So the page works it
 * out: a window that is not the size of its screen is windowed, and
 * `html.ipad-windowed` sets `--window-controls` to the room they take — see
 * `tokens.css`. A window that fills the screen has them in the status bar,
 * which `tauri-plugin-ipad-chrome` hides, and needs none.
 *
 * iPad only. A Mac's window has a title bar of its own above the page.
 *
 * **And room for the menu bar.** A full-screen window has neither status bar
 * nor window controls showing, and iPadOS brings its menu bar — controls and
 * all — down over the page whenever a trackpad or mouse pointer reaches the
 * top edge, which is where the header's buttons are. No app can turn that
 * off. So while the window fills the screen and a pointer is attached,
 * `html.menu-bar-room` holds the top inset open by the bar's height — see
 * `tokens.css`. "Attached" is a fine pointer the media query reports, or the
 * first mouse-type pointer event seen, whichever comes first; a trackpad
 * stays attached for the session once it has been used.
 */

/** A point or two of slack: the two sizes are measured by different parts of the system. */
const SLACK = 2;

/** An iPad, including one that says it is a Mac — iPadOS's Safari does. */
export function isIpad(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iPad/.test(nav.userAgent)) return true;
  return /Mac/.test(nav.platform) && nav.maxTouchPoints > 1;
}

/**
 * Whether a window of `view` on a screen of `screen` fills it. Either way
 * round, because a screen's size is its portrait size whichever way the
 * device is held.
 */
export function fillsScreen(
  view: { width: number; height: number },
  screen: { width: number; height: number },
): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= SLACK;
  return (
    (near(view.width, screen.width) && near(view.height, screen.height)) ||
    (near(view.width, screen.height) && near(view.height, screen.width))
  );
}

/**
 * Whether a pointer event came from a trackpad or a mouse — the only kind
 * that reveals the menu bar. An iPad reports both as `mouse`; a finger is
 * `touch` and an Apple Pencil `pen`.
 */
export function isAttachedPointer(event: Pick<PointerEvent, "pointerType">): boolean {
  return event.pointerType === "mouse";
}

/** Keep `html.ipad-windowed` and `html.menu-bar-room` true to the window. */
export function watchWindowChrome(): void {
  if (!isIpad(navigator)) return;
  const root = document.documentElement;
  root.classList.add("ipad");
  let pointer = window.matchMedia?.("(any-pointer: fine)").matches ?? false;
  const update = () => {
    const windowed = !fillsScreen(
      { width: window.innerWidth, height: window.innerHeight },
      { width: window.screen.width, height: window.screen.height },
    );
    root.classList.toggle("ipad-windowed", windowed);
    root.classList.toggle("menu-bar-room", !windowed && pointer);
  };
  update();
  window.addEventListener("resize", update);
  const seen = (event: PointerEvent) => {
    if (pointer || !isAttachedPointer(event)) return;
    pointer = true;
    update();
  };
  window.addEventListener("pointermove", seen, { capture: true, passive: true });
  window.addEventListener("pointerdown", seen, { capture: true, passive: true });
}
