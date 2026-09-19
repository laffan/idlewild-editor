//! What a scene's file is called.
//!
//! Split from `game_config` for the 700-line rule, and along a seam that file
//! already had: everything there answers *what the generated config holds*,
//! and this answers a different question — how a name somebody typed in the
//! sidebar becomes a filename, a class name and a Phaser key, which are three
//! things a free-text label is not.
//!
//! Three places need the same answer and would otherwise each have their own.
//! `game_config` writes the name into the config, so a scene can say which
//! file it is in; `store::sync_scene_files` writes, renames and deletes the
//! files themselves from that record; and `templates::scene_file` scaffolds a
//! class under it. A second derivation of the same rule would mean a project
//! whose config named a file the store never wrote.

use crate::game_config::Scene;
use std::collections::HashSet;

/// What each scene's file is called, in document order.
///
/// A name in the sidebar is free text — "Title Screen", "cave 2", "" — and a
/// file name, a class name and a Phaser key are none of those things. So the
/// name is reduced to letters and digits with each word capitalised, which is
/// what a Phaser scene class is normally called anyway.
///
/// Two scenes may share a name; two files may not. A collision takes a
/// counter, and the scene earlier in the document keeps the bare name — so
/// renaming the *second* of two Caves is the only thing that moves.
///
/// `Index` is reserved because `js/scenes/index.js` is the generated list
/// beside them, and a scene called Index would be written over it.
pub fn scene_file_names(scenes: &[Scene]) -> Vec<String> {
    let mut taken: HashSet<String> = HashSet::new();
    taken.insert("Index".into());
    let mut out = Vec::with_capacity(scenes.len());
    for scene in scenes {
        let base = scene_file_name(&scene.name);
        let mut name = base.clone();
        let mut n = 2;
        while !taken.insert(name.clone()) {
            name = format!("{base}{n}");
            n += 1;
        }
        out.push(name);
    }
    out
}

/// One scene name, as a class name.
///
/// Anything that is not a letter or a digit is a word break. A name that
/// reduces to nothing is `Scene`, and one that would start with a digit is
/// prefixed, because neither is a legal identifier.
pub fn scene_file_name(name: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if upper {
                out.extend(ch.to_uppercase());
            } else {
                out.push(ch);
            }
            upper = false;
        } else {
            upper = true;
        }
    }
    if out.is_empty() {
        return "Scene".into();
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        return format!("Scene{out}");
    }
    out
}
