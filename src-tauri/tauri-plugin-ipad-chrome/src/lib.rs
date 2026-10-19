//! The iPad's status bar, hidden while the window fills the screen.
//!
//! Pure registration: there are no commands. The Swift half
//! (`ios/Sources/ChromeControl.swift`) does the work as it loads, and keeps
//! doing it as a window moves between full screen and windowed. A no-op on
//! every other target, so registering it unconditionally is safe. Ported
//! from hush's pencil plugin, where the same thing is a setting.

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
