import SwiftRs
import Tauri
import UIKit
import WebKit

// Hides the status bar while a window fills the screen, and brings it
// back — window controls and all — while the pointer sits in the top-left
// corner; that is all in ChromeControl.swift. And reports the Apple Pencil's
// double tap to the page, which is PencilTap.swift. This is the hook Tauri
// loads both through.
class IpadChromePlugin: Plugin {
    private var pencilTap: PencilTap?

    @objc public override func load(webview: WKWebView) {
        DispatchQueue.main.async {
            ChromeControl.install()
            ChromeControl.apply()
            let tap = PencilTap(plugin: self)
            tap.attach(to: webview)
            self.pencilTap = tap
        }
    }
}

@_cdecl("init_plugin_ipad_chrome")
func initPlugin() -> Plugin {
    return IpadChromePlugin()
}
