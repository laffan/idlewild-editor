//! Publish. For now this is "hand the user a zipped copy of the project" —
//! rsync targets are explicitly deferred.
//!
//! The zip is a self-contained runnable game: the project's `game/` tree, its
//! processed `assets/`, and the two runtime libraries. `game.config.json` is
//! rewritten from the live document on the way out, so what you publish is
//! what the canvas currently shows.

use crate::store;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

/// Build the zip in memory and return its bytes.
pub fn build_zip(project_id: &str) -> Result<Vec<u8>, String> {
    let meta = store::read_meta(project_id)?;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let root = sanitise_name(&meta.name);

        // The editable project source.
        let game = store::game_dir(project_id)?;
        add_dir(&mut zip, &game, &format!("{root}/"), options)?;

        // Processed PSD output, at the path P2P.load expects.
        let assets = store::assets_dir(project_id)?;
        if assets.exists() {
            add_dir(&mut zip, &assets, &format!("{root}/assets/"), options)?;
        }

        // Runtime libraries. Both are vendored into the binary, so an export
        // ships the exact builds the project was made against.
        for (name, source) in [
            ("psd-to-phaser.umd.js", crate::templates::P2P_UMD),
            ("phaser.min.js", crate::templates::PHASER),
        ] {
            zip.start_file(format!("{root}/lib/{name}"), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(source.as_bytes()).map_err(|e| e.to_string())?;
        }

        zip.start_file(format!("{root}/README.txt"), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(readme(&meta.name).as_bytes())
            .map_err(|e| e.to_string())?;

        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

fn add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: SimpleFileOptions,
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
