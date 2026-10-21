//! Changing a project's scaffold after it was made.
//!
//! A scaffold used to be a fact: New Project wrote it into `game/` once, and
//! from then on the tree was the author's copy. That stays true of everything
//! the author wrote. What a switch replaces is the files a scaffold writes —
//! the new one's are written, the old one's that the new one does not have are
//! taken away — and **nothing is lost on the way**: every file it overwrites or
//! removes is first copied into `game/Backups/<when>-<from>/`, at the path it
//! had, so code can be salvaged from it in the code panel. A file the switch
//! would write unchanged is left where it is and not backed up.
//!
//! "The files a scaffold writes" is decided by name, which is the risk the
//! sheet warns about: a file of your own called `script.js`, moved onto by a
//! switch to Vanilla, is overwritten like the scaffold's own would be. It is in
//! the backup either way.
//!
//! The scene files are rewritten on every switch to a scaffold that has them.
//! For PSD to Phaser, the frontend sends each scene's placements as code —
//! `this.P2P.place` and what follows it, in draw order — and they are written
//! into that scene's `create`; see `templates::scene_file_with`. That is the
//! one moment the editor writes placement code into a scene file wholesale.
//!
//! Two generated files are not backed up: the config and the scene list. Both
//! are rewritten from the document on every save, so a copy of either is a copy
//! of something the editor can produce again.
//!
//! The backups directory is the author's from then on. It is listed in the
//! code panel like any other directory, and left out of a publish, because a
//! site carrying old copies of its own code is not the site.

use crate::game_config::config_rel;
use crate::project::{now_ms, ProjectMeta, Projection, Scaffold};
use crate::store::{game_dir, read_doc, read_meta, safe_relative, scene_index, write_meta};
use crate::templates::{scene_file_with, template_files, SCENES_DIR, SCENE_INDEX_REL};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;

/// Where backups go, at the root of `game/`.
pub const BACKUPS_DIR: &str = "Backups";

/// Files a scaffold wrote once and writes no longer — a PSD to Phaser project
/// made before the scaffold stopped writing `js/shared/`, or a print project's
/// own copy of `ExportForPrint()`. They count as the scaffold's for a switch.
const RETIRED: [&str; 3] = [
    "js/shared/canvas.js",
    "js/shared/grid.js",
    "js/shared/print.js",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchReport {
    pub meta: ProjectMeta,
    /// The backup directory, relative to `game/`, or None when nothing had to
    /// be backed up.
    pub backup: Option<String>,
    /// Every file copied into it, relative to `game/`.
    pub backed_up: Vec<String>,
}

/// Switch project `id` to `to`. `placements` is each scene's placement code,
/// by scene id, for a PSD to Phaser scene's `create`; anything else ignores it.
pub fn switch_scaffold(
    id: &str,
    to: Scaffold,
    placements: &HashMap<String, String>,
) -> Result<SwitchReport, String> {
    let old = read_meta(id)?;
    if old.output.is_print() && to != Scaffold::P2p {
        return Err("A print project is always PSD to Phaser".into());
    }
    if old.projection == Projection::Isometric && to == Scaffold::Platformer {
        return Err("An isometric project cannot be a platformer".into());
    }

    let mut meta = old.clone();
    meta.genre = to;
    // On for a project arriving at a Game, as New Project defaults it; off
    // anywhere there is no character module to read it.
    meta.options.character =
        to.has_character() && (meta.options.character || !old.genre.has_character());
    meta.updated_at = now_ms();

    let dir = game_dir(id)?;
    let doc_text = read_doc(id)?;
    let config = crate::game_config::from_document(&meta, &doc_text)?;

    // What the new scaffold writes, path by path.
    let mut wanted: Vec<(String, String)> = template_files(&meta)?
        .into_iter()
        .filter(|(rel, _)| *rel != config_rel(meta.genre))
        .map(|(rel, body)| (rel.to_string(), body))
        .collect();
    if to.uses_p2p() {
        let scenes = scene_files_of(&config);
        for (scene_id, file) in &scenes {
            let code = placements.get(scene_id).map(String::as_str).unwrap_or("");
            wanted.push((
                format!("{SCENES_DIR}/{file}.js"),
                scene_file_with(file, &meta, code),
            ));
        }
    }

    // What the old one wrote, and what is generated, which goes either way.
    let generated = [config_rel(old.genre), SCENE_INDEX_REL];
    let mut theirs: BTreeSet<String> = template_files(&old)?
        .into_iter()
        .map(|(rel, _)| rel.to_string())
        .collect();
    theirs.extend(RETIRED.iter().map(|rel| rel.to_string()));
    theirs.extend(scene_files_on_disk(&dir));
    theirs.extend(generated.iter().map(|rel| rel.to_string()));

    let stamp = backup_name(meta.updated_at, old.genre);
    let backup_root = dir.join(BACKUPS_DIR).join(&stamp);
    let mut backed_up = Vec::new();
    let mut back_up = |rel: &str| -> Result<(), String> {
        if generated.contains(&rel) {
            return Ok(());
        }
        let from = dir.join(safe_relative(rel)?);
        let to = backup_root.join(safe_relative(rel)?);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&from, &to).map_err(|e| format!("Cannot back up {rel}: {e}"))?;
        backed_up.push(rel.to_string());
        Ok(())
    };

    // Overwritten: backed up first, unless the write would change nothing.
    for (rel, body) in &wanted {
        let path = dir.join(safe_relative(rel)?);
        match fs::read_to_string(&path) {
            Ok(current) if current == *body => continue,
            Ok(_) => back_up(rel)?,
            Err(_) if path.exists() => back_up(rel)?,
            Err(_) => {}
        }
    }
    // Removed: the old scaffold's files the new one does not write.
    // The generated pair are rewritten in place by the save below rather than
    // taken away, where the new scaffold keeps them at the same path.
    let mut keep: BTreeSet<&str> = wanted.iter().map(|(rel, _)| rel.as_str()).collect();
    keep.insert(config_rel(meta.genre));
    if to.uses_p2p() {
        keep.insert(SCENE_INDEX_REL);
    }
    let mut removed = Vec::new();
    for rel in &theirs {
        let path = dir.join(safe_relative(rel)?);
        if keep.contains(rel.as_str()) || !path.is_file() {
            continue;
        }
        back_up(rel)?;
        removed.push(path);
    }

    for path in &removed {
        fs::remove_file(path).map_err(|e| e.to_string())?;
        prune_empty(&dir, path.parent());
    }
    for (rel, body) in &wanted {
        let path = dir.join(safe_relative(rel)?);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, body).map_err(|e| format!("Cannot write {rel}: {e}"))?;
    }
    if to.uses_p2p() {
        let index = dir.join(safe_relative(SCENE_INDEX_REL)?);
        fs::write(&index, scene_index(&scene_files_of(&config))).map_err(|e| e.to_string())?;
    }

    write_meta(&meta)?;
    // The document carries the scaffold too, for the editor's own reading of
    // it — a platformer's layers sort differently — so it moves with the meta.
    if let Ok(mut doc) = serde_json::from_str::<Value>(&doc_text) {
        doc["genre"] = Value::String(to.as_str().to_string());
        let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
        crate::store::write_doc(id, &text)?;
    }
    let _ = crate::store::sync_game_config(id);

    Ok(SwitchReport {
        meta: read_meta(id)?,
        backup: (!backed_up.is_empty()).then(|| format!("{BACKUPS_DIR}/{stamp}")),
        backed_up,
    })
}

/// Every scene in a config, as (id, file).
fn scene_files_of(config: &Value) -> Vec<(String, String)> {
    config
        .get("scenes")
        .and_then(Value::as_array)
        .map(|scenes| {
            scenes
                .iter()
                .filter_map(|scene| {
                    Some((
                        scene.get("id")?.as_str()?.to_string(),
                        scene.get("file")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The scene files a tree has now, whatever wrote them.
fn scene_files_on_disk(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir.join(SCENES_DIR)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let is_js = name.ends_with(".js") && entry.path().is_file();
            is_js.then(|| format!("{SCENES_DIR}/{name}"))
        })
        .collect()
}

/// Take away directories a removal left empty, up to `game/` itself.
fn prune_empty(root: &Path, from: Option<&Path>) {
    let mut at = from.map(Path::to_path_buf);
    while let Some(dir) = at {
        if dir == root || !dir.starts_with(root) {
            return;
        }
        if fs::remove_dir(&dir).is_err() {
            return;
        }
        at = dir.parent().map(Path::to_path_buf);
    }
}

/// `2026-10-21-143005-topdown`: when, in UTC, and what it was switched from.
/// Sorts in the order the switches were made.
fn backup_name(ms: u64, from: Scaffold) -> String {
    let secs = ms / 1000;
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}-{:02}{:02}{:02}-{}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        from.as_str()
    )
}

/// Days since 1970-01-01 as a proleptic Gregorian date — Howard Hinnant's
/// `civil_from_days`, because a timestamp is the one thing here that wants a
/// calendar and a crate for it would be the only reason to have one.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backup_is_named_for_when_and_what() {
        // 2026-10-21 14:30:05 UTC.
        assert_eq!(
            backup_name(1_792_593_005_000, Scaffold::Topdown),
            "2026-10-21-143005-topdown"
        );
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
