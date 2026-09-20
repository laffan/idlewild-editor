//! Taking layers **out of** a PSD, which is the other half of Extract.
//!
//! The editor's Extract writes a new file out of layers picked off the canvas
//! — `psd_merge` does that half, because a new file made of pieces of others
//! is exactly a merge — and then the layers have to leave the files they came
//! from, or the artwork is in the project twice and an edit to one copy is an
//! edit nobody can find the other half of. This is that second half.
//!
//! **Dropping a row is how a deletion has always worked here.** `psd_layers`
//! rebuilds a file from an edit list and says so: a row left out of the list
//! is left out of the file. So this reads the stack, works out which rows the
//! extracted layers are, and rewrites the file from what is left — through
//! the same `write_held` the inspector's own layer editor uses, which also
//! re-parses the file so the manifest the canvas reloads from is the file's
//! own.
//!
//! **The match is `psd_merge`'s.** A placement's `layerPath` is what the
//! *manifest* calls a layer, and psd-to-json strips the pipe prefix on the way
//! through — so `S | wall` in the file is `wall` in the document. Using the
//! merge's own `pick` rather than a second matcher is the whole of why this
//! is correct: the layer the merge took is by construction the layer the
//! rewrite drops, and two matchers that agreed most of the time would leave a
//! copy of somebody's roof in the file it was extracted from.
//!
//! **A file with nothing placeable left is left alone**, rather than deleted
//! or written empty. A PSD with no layers is not a file, and deleting one is
//! not this command's to decide: another scene may be drawing it, and Merge
//! already set the precedent that a source file survives what is done to its
//! placements. The caller is told, and says so.

use crate::psd_layers::{self, category_of, name_of, rows, Item, LayerEdit, Row};
use crate::psd_merge;
use crate::psd_pipeline;
use psd::Psd;
use serde::Serialize;

/// What became of one source file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Extraction {
    /// The fresh manifest, or None for a file that was left as it was.
    pub manifest: Option<String>,
    /// True when every placeable layer was taken, so nothing was written.
    pub emptied: bool,
    /// How many rows of the stack went, the subtrees of groups included.
    pub dropped: usize,
}

/// Take the named layers out of a PSD and re-parse what is left.
///
/// The command that calls this is in `lib.rs` with the rest of them, because
/// that is where the app handle the console lines go through lives.
pub fn drop_layers(
    project_id: &str,
    key: &str,
    paths: &[String],
    emit_log: impl Fn(&str),
) -> Result<Extraction, String> {
    if paths.is_empty() {
        return Err("Nothing to take out of the file".to_string());
    }
    // One job at a time, as every other write to a PSD takes: the rewrite
    // below goes through `write_held`, which expects its caller to be holding
    // the lock already.
    let _job = psd_pipeline::exclusive();

    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    let all = rows(&doc);
    let doomed = doomed_rows(&doc, &all, paths)?;
    let kept: Vec<LayerEdit> = all
        .iter()
        .enumerate()
        .filter(|(index, _)| !doomed.contains(index))
        .map(|(index, row)| LayerEdit::keep(index, name_of(&doc, row), row.depth))
        .collect();

    // Nothing the game could place is left — the file was taken whole. It
    // keeps its artwork and stays in the project; see the note at the top.
    if !kept.iter().any(|edit| placeable(&edit.name)) {
        emit_log(&format!(
            "psd/{key}.psd has nothing left to place; the file is unchanged"
        ));
        return Ok(Extraction {
            manifest: None,
            emptied: true,
            dropped: doomed.len(),
        });
    }

    let manifest = psd_layers::write_held(project_id, key, &kept, &emit_log)?;
    Ok(Extraction {
        manifest: Some(manifest),
        emptied: false,
        dropped: doomed.len(),
    })
}

/// Which rows of the stack the named layers are, subtrees included.
///
/// A placement's path names a **top-level** item, so what goes is that item
/// and everything indented under it — a group extracted whole leaves no
/// children behind to become top-level layers of their own. Walking forward
/// from the row until the depth comes back is the whole of that rule, and it
/// works because `rows` is the tree flattened depth-first.
///
/// A path that matches nothing is an error rather than a skip: the editor
/// sends what the manifest said, so a miss means the file has changed under
/// the document, and quietly rewriting it without the layer somebody asked
/// for is the one outcome that cannot be noticed afterwards.
fn doomed_rows(
    doc: &Psd,
    all: &[Row],
    paths: &[String],
) -> Result<std::collections::BTreeSet<usize>, String> {
    let mut out = std::collections::BTreeSet::new();
    for path in paths {
        let Some(item) = psd_merge::pick(doc, path) else {
            return Err(format!("No layer called \"{path}\" to take out"));
        };
        let at = all
            .iter()
            .position(|row| same_item(row.item, item))
            .ok_or_else(|| format!("No row for \"{path}\" in the stack"))?;
        out.insert(at);
        let depth = all[at].depth;
        for (index, row) in all.iter().enumerate().skip(at + 1) {
            if row.depth <= depth {
                break;
            }
            out.insert(index);
        }
    }
    Ok(out)
}

fn same_item(a: Item, b: Item) -> bool {
    match (a, b) {
        (Item::Layer(x), Item::Layer(y)) => x == y,
        (Item::Group(x), Item::Group(y)) => x == y,
        _ => false,
    }
}

/// Whether a row is something the game would be given.
///
/// The two orienting marks an import writes — `P | anchor` and `Z | grid` —
/// are not: psd-to-json exports no pixels for either, and a file left holding
/// only those is a file with nothing in it however many rows it has. They
/// survive the rewrite regardless, because the anchor is what says where on
/// the grid the rest of the artwork belongs.
fn placeable(name: &str) -> bool {
    !matches!(category_of(name).as_str(), "point" | "zone")
}
