//! Giving a PSD the anchor mark it came without — the "No anchor" warning's
//! button. Its own file for the 700-line rule; it is one more edit through
//! `psd_layers`' rebuild, like New layer.

use psd::Psd;

use crate::psd_layers::{identity_edits, name_of, rows, unwritable_because, LayerEdit};
use crate::psd_pipeline;
use crate::psd_rebuild::rebuild;

/// Give a file with no `P | anchor` one: the editor's dot, centred on `x, y`
/// in the file's own pixels, at the bottom of the stack and turned off —
/// where and how an import writes it (see `psd_marks.rs`). What the "No
/// anchor" warning's button does. Refused on a file that already has one at
/// its root, and on one this cannot rewrite without losing something.
pub fn add_anchor(
    project_id: &str,
    key: &str,
    x: i32,
    y: i32,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let _job = psd_pipeline::exclusive();
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;
    if let Some(reason) = unwritable_because(&doc) {
        return Err(reason);
    }
    let rows = rows(&doc);
    let anchored = rows
        .iter()
        .any(|row| row.depth == 0 && name_of(&doc, row).replace(' ', "").eq_ignore_ascii_case("P|anchor"));
    if anchored {
        return Err(format!("{key}.psd already has a P | anchor"));
    }
    // Kept inside the canvas, so the dot survives the clip a paint goes
    // through and psd-to-json reads its centre where it was asked for.
    let dot = crate::psd_marks::DOT as i32;
    let half = dot / 2;
    let cx = x.clamp(half, (doc.width() as i32 - half).max(half));
    let cy = y.clamp(half, (doc.height() as i32 - half).max(half));
    let mut edits = identity_edits(&doc);
    let mut mark = LayerEdit {
        index: None,
        name: "P | anchor".to_string(),
        depth: 0,
        visible: Some(false),
        paint: None,
        opacity: None,
    };
    mark.paint = Some(crate::psd_paint::Paint {
        x: cx - half,
        y: cy - half,
        width: dot as u32,
        height: dot as u32,
        rgba: crate::psd_marks::dot_pixels(),
        erase: None,
    });
    edits.push(mark);
    std::fs::write(&path, rebuild(&doc, &edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    emit_log(&format!("Added a P | anchor to psd/{key}.psd at {cx}, {cy}"));
    psd_pipeline::process_held(
        project_id,
        key,
        &psd_pipeline::ProcessOptions::default(),
        emit_log,
    )
}

