//! The iPad's status bar, hidden while the window fills the screen, and the
//! Apple Pencil's double tap, reported to the page.
//!
//! Pure registration: there are no commands. The Swift half does the work as
//! it loads — `ios/Sources/ChromeControl.swift` keeps the bar hidden as a
//! window moves between full screen and windowed, and `PencilTap.swift` emits
//! a `pencil-double-tap` event the page listens for (`src/lib/pencil.ts`). A
//! no-op on every other target, so registering it unconditionally is safe.
//! Ported from hush's pencil plugin, which does both.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ipad_chrome);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ipad-chrome")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                _api.register_ios_plugin(init_plugin_ipad_chrome)?;
            }
            Ok(())
        })
        .build()
}
