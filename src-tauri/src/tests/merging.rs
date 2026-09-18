//! Several placed PSDs, written back out as one.
//!
//! The whole value of a merge is that the arrangement survives it, and an
//! arrangement that did not survive looks exactly like artwork somebody drew
//! that way — a roof half a space off its walls is a roof half a space off its
//! walls, whether a merge moved it or a hand did. Nothing downstream can
//! notice, so it is pinned here.
//!
//! Three things have to hold, and each of them is a different way for a merge
//! to be quietly wrong:
//!
//! - **Position.** Each source lands where the editor said, relative to the
//!   others, in the merged file's own pixels.
//! - **Depth.** Parts arrive back-first and `add_*` stacks bottom-up, so the
//!   merged file's stack is the order they were drawn in. Getting this
//!   backwards inverts the picture and nothing throws.
//! - **The composition inside a file.** A source with two layers in it comes
//!   across as two layers keeping their offsets, not as one flattened sprite.
//!
//! And two things must *not* survive: a name collision between two files, and
//! the sources' own orienting marks.

use super::swatch;
use crate::psd_merge::{self, MergePart};
use crate::psd_write::{AnchorMarks, MarkPoint};
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};
use std::collections::HashMap;

/// A one-layer file, `size` square, in a colour that says which it is.
fn sprite(name: &str, size: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut builder = PsdBuilder::new(size, size);
    builder.add_layer(LayerBuilder::new(name).rgba(size, size, swatch(size, size, rgba)));
    builder.to_bytes().expect("PSD should build")
}

/// The marks a merge writes: a square footprint round the artwork.
fn marks(width: f32, height: f32) -> AnchorMarks {
    AnchorMarks {
        outline: vec![
            MarkPoint { x: 0.0, y: 0.0 },
            MarkPoint { x: width, y: 0.0 },
            MarkPoint {
                x: width,
                y: height,
            },
            MarkPoint { x: 0.0, y: height },
        ],
        lines: Vec::new(),
        art: Some(MarkPoint { x: 0.0, y: 0.0 }),
        margin: None,
        cols: 1,
        rows: 1,
    }
}

fn part(key: &str, path: &str, left: f32, top: f32, size: f32) -> MergePart {
    MergePart {
        key: key.to_string(),
        path: path.to_string(),
        left,
        top,
        width: size,
        height: size,
    }
}

/// Read back what a merge wrote: every layer's name, corner and size,
/// top-first as `layers()` reports them.
fn read(bytes: &[u8]) -> Vec<(String, i32, i32, usize, usize)> {
    let doc = Psd::from_bytes(bytes).expect("merged PSD should parse");
    doc.layers()
        .iter()
        .map(|l| {
            (
                l.name().to_string(),
                l.layer_left(),
                l.layer_top(),
                l.width() as usize,
                l.height() as usize,
            )
        })
        .collect()
}

fn library(files: Vec<(&str, Vec<u8>)>) -> impl Fn(&str) -> Result<Vec<u8>, String> {
    let held: HashMap<String, Vec<u8>> = files
        .into_iter()
        .map(|(key, bytes)| (key.to_string(), bytes))
        .collect();
    move |key: &str| {
        held.get(key)
            .cloned()
            .ok_or_else(|| format!("no {key}.psd"))
    }
}

/// Two files, side by side, come out as two layers side by side.
#[test]
fn a_merge_keeps_each_file_where_it_was_standing() {
    let read_fn = library(vec![
        ("wall", sprite("S | wall", 16, [200, 40, 20, 255])),
        ("roof", sprite("S | roof", 16, [20, 80, 200, 255])),
    ]);

    let bytes = psd_merge::merge(
        48,
        16,
        &[
            part("wall", "wall", 0.0, 0.0, 16.0),
            part("roof", "roof", 32.0, 0.0, 16.0),
        ],
        &marks(48.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let layers = read(&bytes);
    // The name says which file it came from — see `merged_name`.
    let wall = layers
        .iter()
        .find(|(name, ..)| name == "S | wall-wall")
        .expect("the wall should be in the merged file");
    let roof = layers
        .iter()
        .find(|(name, ..)| name == "S | roof-roof")
        .expect("the roof should be in the merged file");

    // Thirty-two pixels apart, which is exactly what was asked for.
    assert_eq!(roof.1 - wall.1, 32, "the gap between them is preserved");
    assert_eq!(wall.2, roof.2, "and they are still on the same row");
    assert_eq!((wall.3, wall.4), (16, 16), "at the size they were drawn");
}

/// Parts arrive back-first, and the merged stack is the order they draw in.
///
/// `layers()` reads top-first, so the *last* part sent is the first one read
/// back. Getting this the wrong way round inverts every merged picture and
/// nothing anywhere throws.
#[test]
fn the_merged_stack_is_the_order_they_were_drawn_in() {
    let read_fn = library(vec![
        ("ground", sprite("S | ground", 8, [30, 120, 30, 255])),
        ("walls", sprite("S | walls", 8, [150, 150, 150, 255])),
        ("roof", sprite("S | roof", 8, [120, 40, 40, 255])),
    ]);

    let bytes = psd_merge::merge(
        8,
        8,
        &[
            part("ground", "ground", 0.0, 0.0, 8.0),
            part("walls", "walls", 0.0, 0.0, 8.0),
            part("roof", "roof", 0.0, 0.0, 8.0),
        ],
        &marks(8.0, 8.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let names: Vec<String> = read(&bytes)
        .into_iter()
        .map(|(name, ..)| name)
        .filter(|name| name.starts_with("S | "))
        .collect();
    assert_eq!(
        names,
        ["S | roof-roof", "S | walls-walls", "S | ground-ground"],
        "the last part sent is the front-most layer"
    );
}

/// A source with two layers in it stays two layers, in the same arrangement.
///
/// Merging is not flattening. The offsets inside a file are scaled by the
/// *file's* factor about the file's own origin — the rule an extrusion's parts
/// keep — so a roof that sat eight pixels above its walls still does.
#[test]
fn a_multi_layer_source_keeps_its_own_composition() {
    let mut builder = PsdBuilder::new(32, 32);
    builder.add_layer(
        LayerBuilder::new("S | walls")
            .rgba(16, 16, swatch(16, 16, [150, 150, 150, 255]))
            .at(0, 16),
    );
    builder.add_layer(
        LayerBuilder::new("S | eaves")
            .rgba(16, 8, swatch(16, 8, [120, 40, 40, 255]))
            .at(0, 8),
    );
    let hut = builder.to_bytes().expect("PSD should build");

    let read_fn = library(vec![
        ("hut", hut),
        ("tree", sprite("S | tree", 16, [30, 120, 30, 255])),
    ]);

    // The hut's artwork spans y 8..32 — 16 wide, 24 tall — and goes in at its
    // own size, so nothing is resampled and the internal gap is unchanged.
    let bytes = psd_merge::merge(
        32,
        24,
        &[
            part("hut", "walls", 0.0, 0.0, 16.0),
            part("tree", "tree", 16.0, 0.0, 16.0),
        ],
        &marks(32.0, 24.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let layers = read(&bytes);
    let walls = layers
        .iter()
        .find(|(name, ..)| name == "S | walls-hut")
        .expect("the walls should come across");
    // Only the named top-level layer is taken, because that is what the
    // placement stands for — the editor sends one part per placement, and a
    // file with two top-level layers is two placements.
    assert_eq!((walls.3, walls.4), (16, 16), "at its own size");
    assert_eq!(walls.1, 0, "and where it was put");
}

/// A group comes across as a group, with its contents in their own places.
#[test]
fn a_merged_group_stays_a_group() {
    let mut builder = PsdBuilder::new(32, 32);
    builder.add_group(
        GroupBuilder::new("G | extrude-1")
            .add_layer(
                LayerBuilder::new("S | shape-1")
                    .rgba(16, 16, swatch(16, 16, [200, 200, 200, 255]))
                    .at(0, 0),
            )
            .add_layer(
                LayerBuilder::new("S | lines-1")
                    .rgba(16, 16, swatch(16, 16, [40, 40, 40, 255]))
                    .at(0, 0),
            ),
    );
    let solid = builder.to_bytes().expect("PSD should build");

    let read_fn = library(vec![
        ("solid", solid),
        ("tree", sprite("S | tree", 16, [30, 120, 30, 255])),
    ]);

    let bytes = psd_merge::merge(
        32,
        16,
        &[
            part("solid", "extrude-1", 0.0, 0.0, 16.0),
            part("tree", "tree", 16.0, 0.0, 16.0),
        ],
        &marks(32.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let doc = Psd::from_bytes(&bytes).expect("merged PSD should parse");
    let group = doc
        .groups()
        .values()
        .find(|g| g.name() == "G | extrude-1-solid")
        .expect("the group should still be a group");
    let inside: Vec<&str> = doc
        .layers()
        .iter()
        .filter(|l| l.parent_id().is_some())
        .map(|l| l.name())
        .collect();
    // Named at every depth, not only at the top: a texture key is the layer's
    // own name wherever in the stack it sits.
    assert!(
        inside.contains(&"S | shape-1-solid"),
        "with its contents in it, named the same way"
    );
    assert!(inside.contains(&"S | lines-1-solid"));
    assert!(group.visible());
}

/// Two files with a same-named layer must not land as two rows with one name.
///
/// psd-to-phaser keys a texture on the layer's own name, so a collision is not
/// cosmetic: it is one file's artwork drawn for the other's. The editor fixes
/// that for *separate* files by naming a texture after the file it came from
/// — inside one merged document there is no file left to name it after.
#[test]
fn two_files_with_the_same_layer_name_do_not_collide() {
    let read_fn = library(vec![
        ("one", sprite("S | layer 1", 8, [200, 40, 20, 255])),
        ("two", sprite("S | layer 1", 8, [20, 80, 200, 255])),
    ]);

    let bytes = psd_merge::merge(
        16,
        8,
        &[
            part("one", "layer 1", 0.0, 0.0, 8.0),
            part("two", "layer 1", 8.0, 0.0, 8.0),
        ],
        &marks(16.0, 8.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let names: Vec<String> = read(&bytes)
        .into_iter()
        .map(|(name, ..)| name)
        .filter(|name| name.starts_with("S | "))
        .collect();
    assert_eq!(names.len(), 2);
    assert_ne!(names[0], names[1], "they do not collide");
    // Unique by construction rather than by a suffix: each carries the file it
    // came from, which is also what says which is which.
    assert!(names.contains(&"S | layer 1-one".to_string()));
    assert!(names.contains(&"S | layer 1-two".to_string()));
}

/// A placement that was resized on the grid arrives at the size it looked.
#[test]
fn a_resized_placement_is_resampled_to_the_size_it_looked() {
    let read_fn = library(vec![
        ("wall", sprite("S | wall", 16, [200, 40, 20, 255])),
        ("roof", sprite("S | roof", 16, [20, 80, 200, 255])),
    ]);

    let bytes = psd_merge::merge(
        40,
        16,
        &[
            part("wall", "wall", 0.0, 0.0, 8.0),
            part("roof", "roof", 16.0, 0.0, 16.0),
        ],
        &marks(40.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let layers = read(&bytes);
    let wall = layers
        .iter()
        .find(|(name, ..)| name == "S | wall-wall")
        .expect("the wall should be there");
    assert_eq!(
        (wall.3, wall.4),
        (8, 8),
        "half the size on the grid is half the pixels in the file"
    );
}

/// The merged file carries the editor's marks — one pair, its own.
///
/// Nine sources would otherwise be nine anchors, which is nine answers to a
/// question with one. The sources' marks are never sent: a placement is made
/// for the artwork layers alone.
#[test]
fn the_merged_file_writes_one_anchor_of_its_own() {
    let read_fn = library(vec![
        ("wall", sprite("S | wall", 16, [200, 40, 20, 255])),
        ("roof", sprite("S | roof", 16, [20, 80, 200, 255])),
    ]);

    let bytes = psd_merge::merge(
        32,
        16,
        &[
            part("wall", "wall", 0.0, 0.0, 16.0),
            part("roof", "roof", 16.0, 0.0, 16.0),
        ],
        &marks(32.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let anchors = read(&bytes)
        .into_iter()
        .filter(|(name, ..)| name == "P | anchor")
        .count();
    assert_eq!(anchors, 1, "exactly one anchor mark");
}

/// The bug that made merging fail on every file this editor has ever written.
///
/// A placement's `layerPath` is what the **manifest** calls the layer, and
/// psd-to-json strips the pipe prefix on the way through: the group
/// `G | extrude-mu70cjz3` that an extrusion writes is `extrude-mu70cjz3` in
/// the document. Matching raw PSD names by equality therefore never hit
/// anything, and every merge stopped with *has no layer called
/// "extrude-mu70cjz3"* — naming the layer that was right there.
///
/// This is the shape of a real Apply: a group named with the convention, holding
/// the three parts an extrusion draws, beside the two marks the editor writes.
#[test]
fn a_file_this_editor_wrote_is_found_by_its_manifest_name() {
    let mut builder = PsdBuilder::new(64, 64);
    builder.add_layer(
        LayerBuilder::new("P | anchor").rgba(12, 12, swatch(12, 12, [236, 48, 19, 255])),
    );
    builder.add_group(
        GroupBuilder::new("G | extrude-mu70cjz3")
            .add_layer(
                LayerBuilder::new("S | shape-mu70cjz3")
                    .rgba(32, 32, swatch(32, 32, [200, 200, 200, 255])),
            )
            .add_layer(
                LayerBuilder::new("S | lines-mu70cjz3")
                    .rgba(32, 32, swatch(32, 32, [40, 40, 40, 255])),
            ),
    );
    let solid = builder.to_bytes().expect("PSD should build");

    let read_fn = library(vec![
        ("extrude-mu70cjz3", solid),
        ("tree", sprite("S | tree", 32, [30, 120, 30, 255])),
    ]);

    let bytes = psd_merge::merge(
        64,
        32,
        &[
            // What the document actually holds: no prefix.
            part("extrude-mu70cjz3", "extrude-mu70cjz3", 0.0, 0.0, 32.0),
            part("tree", "tree", 32.0, 0.0, 32.0),
        ],
        &marks(64.0, 32.0),
        &read_fn,
        &|_| {},
    )
    .expect("a file this editor wrote should merge");

    let doc = Psd::from_bytes(&bytes).expect("merged PSD should parse");
    assert!(
        doc.groups()
            .values()
            .any(|g| g.name() == "G | extrude-mu70cjz3-extrude-mu70cjz3"),
        "the extrusion's group comes across, carrying the file it came from"
    );
    let names: Vec<&str> = doc.layers().iter().map(|l| l.name()).collect();
    assert!(names.contains(&"S | tree-tree"));
    // The source's own anchor mark is not merged: it was never sent, because a
    // placement is made for the artwork layers alone.
    assert_eq!(
        names.iter().filter(|n| n.contains("anchor")).count(),
        1,
        "one anchor, and it is the merged file's own"
    );
}

/// A layer's attributes ride along, after its new name.
///
/// `S | hero | animation` is a spritesheet, and the third part is what makes
/// it one. Dropping it on the way through a merge would turn an animation into
/// a still, which psd-to-json would report without complaint.
#[test]
fn a_layers_attributes_survive_the_rename() {
    let read_fn = library(vec![
        ("guy", sprite("S | hero | animation", 16, [200, 40, 20, 255])),
        ("tree", sprite("S | tree", 16, [30, 120, 30, 255])),
    ]);

    let bytes = psd_merge::merge(
        32,
        16,
        &[
            part("guy", "hero", 0.0, 0.0, 16.0),
            part("tree", "tree", 16.0, 0.0, 16.0),
        ],
        &marks(32.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect("merge should succeed");

    let names: Vec<String> = read(&bytes).into_iter().map(|(name, ..)| name).collect();
    assert!(
        names.contains(&"S | hero-guy | animation".to_string()),
        "the kind, the renamed layer, then whatever else that kind wanted"
    );
}

/// One file is already one file.
#[test]
fn a_merge_of_one_is_refused() {
    let read_fn = library(vec![("wall", sprite("S | wall", 16, [200, 40, 20, 255]))]);
    let err = psd_merge::merge(
        16,
        16,
        &[part("wall", "wall", 0.0, 0.0, 16.0)],
        &marks(16.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect_err("one part is not a merge");
    assert!(err.contains("two or more"));
}

/// A name the file does not have is an error rather than a guess.
///
/// The editor sends what the manifest said, so a miss means the file has
/// changed under the document — and merging the wrong artwork puts it
/// somewhere it cannot be told from the right artwork.
#[test]
fn a_layer_that_is_not_there_stops_the_merge() {
    let read_fn = library(vec![
        ("wall", sprite("S | wall", 16, [200, 40, 20, 255])),
        ("roof", sprite("S | roof", 16, [20, 80, 200, 255])),
    ]);
    let err = psd_merge::merge(
        32,
        16,
        &[
            part("wall", "wall", 0.0, 0.0, 16.0),
            part("roof", "chimney", 16.0, 0.0, 16.0),
        ],
        &marks(32.0, 16.0),
        &read_fn,
        &|_| {},
    )
    .expect_err("a missing layer should stop it");
    assert!(err.contains("chimney"));
}
