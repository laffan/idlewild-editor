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

/** Keep `html.ipad-windowed` true to the window, for as long as the page is up. */
export function watchWindowChrome(): void {
  if (!isIpad(navigator)) return;
  const root = document.documentElement;
  root.classList.add("ipad");
  const update = () => {
    const windowed = !fillsScreen(
      { width: window.innerWidth, height: window.innerHeight },
      { width: window.screen.width, height: window.screen.height },
    );
    root.classList.toggle("ipad-windowed", windowed);
  };
  update();
  window.addEventListener("resize", update);
}
