/**
 * What the shell is running on, as the frontend needs to know it.
 *
 * The string is `std::env::consts::OS`, resolved once per session through the
 * `platform` command. Only a handful of places care, and they all care about
 * the same distinction: whether a document leaves the app to be edited, and
 * whether the file pickers are the phone's or the desktop's.
 */

const MOBILE = new Set(["ios", "android"]);

/** True where a document leaves the app rather than being edited in place. */
export function isMobile(os: string): boolean {
  return MOBILE.has(os);
}
