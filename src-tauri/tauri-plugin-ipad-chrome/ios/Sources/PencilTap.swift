import Tauri
import UIKit
import WebKit

// The Apple Pencil's double tap on its barrel, handed to the page as the
// plugin event `pencil-double-tap` — ported from hush's pencil plugin, where
// it toggles the notebook's eraser. See `src/lib/pencil.ts` for the listener.
//
// `UIPencilInteraction` is the only thing iOS reports the tap to; there is no
// pointer event for it. It is attached to the web view itself rather than to
// its scroll view: hush found that a recognizer on the scroll view broke how
// the page received touches, where an interaction on the web view sees the
// Pencil's sensor and nothing else. The legacy delegate method, as hush has
// it, because it is the one every iPadOS this app runs on calls.
final class PencilTap: NSObject, UIPencilInteractionDelegate {
    private weak var plugin: Plugin?

    init(plugin: Plugin) {
        self.plugin = plugin
    }

    /// Attach to `webview`. The interaction is retained by the view; this
    /// object is retained by the plugin, since a delegate is held weakly.
    func attach(to webview: WKWebView) {
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        webview.addInteraction(interaction)
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        plugin?.trigger("pencil-double-tap", data: [:])
    }
}
