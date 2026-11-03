# Idlewild

A game and page editor for iPad and macOS, built around
[psd-to-phaser](https://github.com/laffan/psd-to-phaser). You pick a
template (isometric, orthogonal or blank), draw and import images onto a grid,
and the project's code is written alongside. Everything you bring in is
stored as a PSD, and Play runs the result. Projects can also target print,
exporting a PDF, PSD, PNG or JPG.

## Installation

Download the installer for your system from the
[Releases](../../releases) page: `.dmg` (macOS), `.msi` or `.exe` (Windows),
`.AppImage`, `.deb` or `.rpm` (Linux).

The builds are not code-signed. On macOS, if the app is blocked on first
launch, move it to Applications and run:

```sh
xattr -cr "/Applications/Idlewild.app"
```

On Windows, choose "More info" then "Run anyway" when SmartScreen warns.

### Build from source

Requires [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri build    # installers end up in src-tauri/target/release/bundle/
npm run tauri dev      # run in development
```

## More detail

[README_DETAIL.md](README_DETAIL.md) describes the editor in full, [README-TECHNICAL.md](README-TECHNICAL.md) covers the internals, and the `Manual/` folder has user documentation.
