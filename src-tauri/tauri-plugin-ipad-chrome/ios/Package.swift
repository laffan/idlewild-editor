// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-ipad-chrome",
    // The app's own floor — bundle.iOS.minimumSystemVersion in tauri.conf.json.
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-ipad-chrome",
            type: .static,
            targets: ["tauri-plugin-ipad-chrome"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-ipad-chrome",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
