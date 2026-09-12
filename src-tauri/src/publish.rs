//! Publish. For now this is "hand the user a zipped copy of the project" —
//! rsync targets are explicitly deferred.
//!
//! The zip is a self-contained runnable game: the project's `game/` tree, its
//! processed `assets/`, and the two runtime libraries — the exact builds the
//! editor itself runs, since both are vendored into this binary.
//!
//! `game.config.json` is the one file the export does not copy. The on-disk
//! copy is kept in step with the document on every save, so copying it would
//! usually be right — but "usually" is not a guarantee to hand a zip, and
//! this is the one place that sees the document and the archive at the same
//! time. It is written from the document here, deliberately, and left out of
//! the directory walk so no reader has to choose between two entries of the
//! same name. See `game_config`.

use crate::store;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

/// Build the zip and write it where the user asked for it.
///
/// The bytes are built in memory first because the archive writer wants a
/// seekable sink and the export is assembled out of order; what this adds is
/// that they go to disk from here rather than back through the IPC boundary
/// as base64.
pub fn write_zip(project_id: &str, dest: &std::path::Path) -> Result<(), String> {
    let bytes = build_zip(project_id)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(dest, bytes).map_err(|e| format!("Cannot write {dest:?}: {e}"))
}

/// Build the zip in memory and return its bytes.
pub fn build_zip(project_id: &str) -> Result<Vec<u8>, String> {
    let meta = store::read_meta(project_id)?;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let root = sanitise_name(&meta.name);

        // The editable project source, minus the generated config.
        let game = store::game_dir(project_id)?;
        let generated = crate::game_config::CONFIG_REL;
        add_dir(&mut zip, &game, &format!("{root}/"), options, &[generated])?;

        // The document, in the shape `WorldScene.js` reads. A project whose
        // document will not parse still exports — as the empty game the
        // scaffold wrote, which is a runnable thing to hand back — rather
        // than failing at the last step with a zip half written.
        let config = match store::read_doc(project_id)
            .and_then(|doc| crate::game_config::from_document(&meta, &doc))
        {
            Ok(config) => config,
            Err(_) => crate::game_config::empty(&meta),
        };
        zip.start_file(format!("{root}/{generated}"), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            serde_json::to_string_pretty(&config)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;

        // Processed PSD output, at the path P2P.load expects.
        let assets = store::assets_dir(project_id)?;
        if assets.exists() {
            add_dir(&mut zip, &assets, &format!("{root}/assets/"), options, &[])?;
        }

        // Runtime libraries. Both are vendored into the binary, so an export
        // ships the exact builds the project was made against. They go where
        // this project's own page asks for them — see `runtime_dir`.
        let runtime = runtime_dir(&game);
        for (name, source) in [
            ("psd-to-phaser.umd.js", crate::templates::P2P_UMD),
            ("phaser.min.js", crate::templates::PHASER),
        ] {
            zip.start_file(format!("{root}/{runtime}{name}"), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(source.as_bytes())
                .map_err(|e| e.to_string())?;
        }

        zip.start_file(format!("{root}/README.txt"), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(readme(&meta.name).as_bytes())
            .map_err(|e| e.to_string())?;

        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Where this project's `index.html` loads Phaser and psd-to-phaser from.
///
/// The scaffold keeps them in `js/lib/`, beside the code that uses them. A
/// project made before the tree was restructured loads them from `lib/`, and
/// its `game/` tree is its own copy — nothing rewrites a page someone may have
/// edited — so the page is what gets asked. A project whose index says neither
/// gets the current layout, which is the only thing this build can be right
/// about.
fn runtime_dir(game: &Path) -> &'static str {
    let index = std::fs::read_to_string(game.join("index.html")).unwrap_or_default();
    if !index.contains(crate::templates::RUNTIME_DIR)
        && index.contains(crate::templates::LEGACY_RUNTIME_DIR)
    {
        return crate::templates::LEGACY_RUNTIME_DIR;
    }
    crate::templates::RUNTIME_DIR
}

/// Copy a directory into the archive, skipping the relative paths in `skip`.
///
/// A zip may carry two entries with the same name and most readers take the
/// last, which is not something to rely on — so the file this export
/// generates is left out here and written once, deliberately.
fn add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: SimpleFileOptions,
    skip: &[&str],
) -> Result<(), String> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if skip.contains(&rel.as_str()) {
                continue;
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            zip.start_file(format!("{prefix}{rel}"), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn readme(name: &str) -> String {
    format!(
        "{name}\n\
         \n\
         Exported from Idlewild.\n\
         \n\
         Serve this directory over HTTP and open index.html — the scene uses\n\
         ES modules and a JSON import, so opening the file directly from disk\n\
         will not work.\n\
         \n\
             npx serve .\n\
         \n\
         Requires a WebGL context: psd-to-phaser builds layer masks on\n\
         Phaser 4's Filter system. Under Canvas, masked layers still place and\n\
         render, just unmasked.\n"
    )
}

/// Project names reach the filesystem here, so strip anything that would make
/// a bad archive entry.
pub fn sanitise_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "idlewild-game".to_string()
    } else {
        trimmed.replace(' ', "-").to_lowercase()
    }
}
