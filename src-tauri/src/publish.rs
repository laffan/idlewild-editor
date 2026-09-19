//! Publish: what a published site is made of, and the zip that hands one over.
//!
//! A site is a self-contained runnable game: the project's `game/` tree, its
//! processed `assets/`, and the two runtime libraries — the exact builds the
//! editor itself runs, since both are vendored into this binary.
//!
//! **The site is a list before it is a file.** `site_entries` answers with
//! every path a published site has and where its bytes come from, and the two
//! things that consume that list are `build_zip`, which hands the user an
//! archive, and `deploy::stage`, which writes the same site into a directory
//! for rsync or git to push. Without that seam the second one would have been
//! the first one copied and edited, and a site that was right in a zip and
//! wrong on a server is the kind of difference nobody finds until it is live.
//!
//! `game.config.json` is the one file a site does not copy. The on-disk copy
//! is kept in step with the document on every save, so copying it would
//! usually be right — but "usually" is not a guarantee to hand anybody, and
//! this is the one place that sees the document and the output at the same
//! time. It is written from the document here, deliberately, and left out of
//! the directory walk so no reader has to choose between two entries of the
//! same name. See `game_config`.

use crate::store;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

/// **Export site**: a zip you can serve.
///
/// Written straight to the path the save dialog gave, like the two exports
/// beside it — an archive carrying every processed asset has no business
/// crossing the IPC boundary as base64 first. The dialog hands back a `file://`
/// URL on iPadOS rather than a path, which is what `source_path` is for.
#[tauri::command]
pub fn publish_site(id: String, path: String) -> Result<(), String> {
    write_zip(&id, &crate::psd_write::source_path(&path))
}

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
///
/// One entry per row of `site_entries`, under a directory named after the
/// project — an archive that unpacks its contents into whatever directory you
/// happened to be in is an archive people learn to open twice.
pub fn build_zip(project_id: &str) -> Result<Vec<u8>, String> {
    let (root, entries) = site_entries(project_id)?;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for entry in entries {
            zip.start_file(format!("{root}/{}", entry.rel), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&entry.read()?).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Where one file of a published site gets its bytes.
///
/// A processed project is tens of megabytes of sprite sheets, and it is copied
/// rather than read — so a file on disk stays a path until the moment it is
/// written. Only the three files a publish *generates* are ever bytes.
pub enum SiteSource {
    Disk(std::path::PathBuf),
    Generated(Vec<u8>),
}

/// One file of a published site.
pub struct SiteEntry {
    /// Relative to the site root, with forward slashes — the path a browser
    /// asks for and the path rsync and git put it at.
    pub rel: String,
    pub source: SiteSource,
}

impl SiteEntry {
    /// The bytes, read now.
    pub fn read(&self) -> Result<Vec<u8>, String> {
        match &self.source {
            SiteSource::Disk(path) => {
                std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))
            }
            SiteSource::Generated(bytes) => Ok(bytes.clone()),
        }
    }
}

/// Everything a published site is made of, and what to call its root.
///
/// The root is the project's name, sanitised — a zip unpacks into it, and an
/// rsync or a git publish ignores it, because those put the site *at* a
/// destination somebody chose rather than inside a directory this code named.
pub fn site_entries(project_id: &str) -> Result<(String, Vec<SiteEntry>), String> {
    let meta = store::read_meta(project_id)?;
    let root = sanitise_name(&meta.name);
    let mut entries = Vec::new();

    // The editable project source, minus the generated config.
    let game = store::game_dir(project_id)?;
    let generated = crate::game_config::config_rel(meta.genre);
    collect(&game, "", &mut entries, &[generated])?;

    // The document, in the shape `shared/canvas.js` reads. A project whose
    // document will not parse still publishes — as the empty game the
    // scaffold wrote, which is a runnable thing to hand back — rather than
    // failing at the last step with half a site written.
    let config = match store::read_doc(project_id)
        .and_then(|doc| crate::game_config::from_document(&meta, &doc))
    {
        Ok(config) => config,
        Err(_) => crate::game_config::empty(&meta),
    };
    entries.push(SiteEntry {
        rel: generated.to_string(),
        source: SiteSource::Generated(
            serde_json::to_string_pretty(&config)
                .map_err(|e| e.to_string())?
                .into_bytes(),
        ),
    });

    // Processed PSD output, at the path P2P.load expects.
    let assets = store::assets_dir(project_id)?;
    if assets.exists() {
        collect(&assets, "assets/", &mut entries, &[])?;
    }

    // Runtime libraries. Both are vendored into the binary, so a publish
    // ships the exact builds the project was made against. They go where this
    // project's own page asks for them — see `runtime_dir`.
    //
    // A vanilla project asks for neither: its `index.html` loads no Phaser and
    // no psd-to-phaser, and 1.5 MB of JavaScript nothing on the page includes
    // is 1.5 MB somebody has to work out they can delete.
    if meta.genre.is_phaser() {
        let runtime = runtime_dir(&game);
        for (name, source) in [
            ("psd-to-phaser.umd.js", crate::templates::P2P_UMD),
            ("phaser.min.js", crate::templates::PHASER),
        ] {
            entries.push(SiteEntry {
                rel: format!("{runtime}{name}"),
                source: SiteSource::Generated(source.as_bytes().to_vec()),
            });
        }
    }

    entries.push(SiteEntry {
        rel: "README.txt".to_string(),
        source: SiteSource::Generated(readme(&meta.name, meta.genre).into_bytes()),
    });

    // Sorted so a site is the same list in the same order every time: a zip
    // that reorders itself between two runs of the same project is a zip
    // nobody can diff, and rsync's own output reads better down a tree.
    entries.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok((root, entries))
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

/// Every file under a directory, as entries, skipping the relative paths in
/// `skip`.
///
/// The one path that is ever skipped is the generated config, which is written
/// once and deliberately: a zip may carry two entries with the same name and
/// most readers take the last, which is not something to rely on.
fn collect(
    dir: &Path,
    prefix: &str,
    out: &mut Vec<SiteEntry>,
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
            out.push(SiteEntry {
                rel: format!("{prefix}{rel}"),
                source: SiteSource::Disk(path),
            });
        }
    }
    Ok(())
}

/// The note beside a published site.
///
/// The half about serving it is true of every scaffold and for the same
/// reason: all four are ES modules that read `game.config.json`, and a module
/// opened over `file://` cannot fetch or import anything. What a vanilla site
/// does not carry is Phaser, so the WebGL paragraph is left off it rather than
/// being a requirement nothing in the directory has.
fn readme(name: &str, scaffold: crate::project::Scaffold) -> String {
    let webgl = if scaffold.is_phaser() {
        "\n\
         Requires a WebGL context: psd-to-phaser builds layer masks on\n\
         Phaser 4's Filter system. Under Canvas, masked layers still place and\n\
         render, just unmasked.\n"
    } else {
        ""
    };
    format!(
        "{name}\n\
         \n\
         Exported from Idlewild.\n\
         \n\
         Serve this directory over HTTP and open index.html — the page uses\n\
         ES modules and reads game.config.json, so opening the file directly\n\
         from disk will not work.\n\
         \n\
             npx serve .\n\
         {webgl}"
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
