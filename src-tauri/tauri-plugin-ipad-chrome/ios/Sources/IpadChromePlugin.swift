import SwiftRs
import Tauri
import UIKit
import WebKit

// Hides the status bar while a window fills the screen, and brings it
// back — window controls and all — while the pointer sits in the top-left
// corner. Everything is in ChromeControl.swift; this is the hook Tauri
// loads it through.
class IpadChromePlugin: Plugin {
    @objc public override func load(webview: WKWebView) {
        DispatchQueue.main.async {
            ChromeControl.install()
            ChromeControl.apply()
        }
    }
}

@_cdecl("init_plugin_ipad_chrome")
func initPlugin() -> Plugin {
    return IpadChromePlugin()
}
