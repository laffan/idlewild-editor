/** Stubs for @tauri-apps/plugin-dialog. Tests set window.__pick / __save. */
export async function open(): Promise<string | null> {
  return (window as any).__pick ?? null;
}
export async function save(): Promise<string | null> {
  return (window as any).__save ?? null;
}
