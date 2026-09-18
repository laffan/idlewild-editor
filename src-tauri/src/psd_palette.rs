//! The palette, written into a PSD on its way out to another app.
//!
//! **Attach to PSDs** is a promise about *leaving*, not about the store: when
//! a file goes out through Open PSD or the iPadOS share sheet, the colours the
//! project is being drawn in go with it, as a strip of flat squares on the
//! topmost layer. Photoshop, Procreate and anything else that opens a PSD
//! then has the palette under its own eyedropper — which is the whole of what
//! this is for. There is no way to hand another app a swatch file it will
//! read, and there is no need for one: every drawing program on earth can
//! sample a pixel.
//!
//! ## It is a third editor's mark
//!
//! `psd_marks` already writes two layers nobody drew — `P | anchor` and
//! `Z | grid` — and this is the same kind of thing with two differences.
//!
//! It is **topmost and lit**, where those are underneath and dark. They are
//! there to be lined up against and would otherwise print a red dot over the
//! artwork; this is there to be *sampled*, and a hidden layer is a layer whose
//! eye has to be found before it is any use.
//!
//! And it is named **outside the pipe convention**, so psd-to-json ignores it
//! — see `psd_layers::category_of`. The two marks are a point and a zone
//! because the editor reads them back; nothing reads this one, and a palette
//! arriving in the running game as a sprite would be a bug in every project
//! that turned the toggle on.
//!
//! ## Why it syncs rather than appends
//!
//! Every send-out brings the file into line with the toggle as it stands: the
//! strip is replaced when it is on, and taken out when it is off. Appending
//! would stack a second strip on the third share, and leaving a stale one
//! behind would mean a toggle nobody could un-press. A file with no strip and
//! the toggle off is not rewritten at all, which is every project that has
//! never used this.
//!
//! The pipeline is deliberately **not** re-run afterwards. An ignored layer
//! changes nothing psd-to-json would emit, and making every Share PSD wait on
//! a re-parse would be a visible stall for no change to a single asset.

use crate::psd_layers::{self, unwritable_because, Item, LayerEdit};
use crate::psd_paint::Patch;
use crate::psd_pipeline;
use crate::psd_rebuild::rebuild;
use psd::Psd;
use serde::{Deserialize, Serialize};

/// What the strip's layer is called.
///
/// No pipe, so psd-to-json ignores it, and the editor's own name in it so a
/// layer somebody happened to call `palette` is never the one taken out. The
/// match below is on the whole trimmed name, case-insensitively.
pub const LAYER_NAME: &str = "Idlewild palette";

/// The palette as the editor sends it: the colours, and how big a square is.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteStrip {
    /// `#rrggbb` or `#rrggbbaa`, in the order the palette holds them.
    pub colors: Vec<String>,
    /// One square's side in pixels — a quarter of the project's grid.
    pub cell: u32,
}

/// What a sync did, for the line the editor logs afterwards.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteSync {
    /// Whether the file on disk was rewritten.
    pub changed: bool,
    /// Why nothing was written, when something was asked for.
    ///
    /// A *reason* rather than an error, because the thing being asked for is a
    /// courtesy: a PSD that cannot carry the palette is still a PSD somebody
    /// wants opened, and failing the share over it would be this feature
    /// taking the round trip down with it.
    pub skipped: Option<String>,
}

/// Bring `<key>.psd`'s palette layer into line with what the editor carries.
///
/// `strip` is `None` when the toggle is off, or when the palette is empty —
/// an empty palette attaches nothing whatever the toggle says, since a strip
/// of no squares is a layer of one transparent pixel and a lie about the
/// feature being on.
pub fn sync(
    project_id: &str,
    key: &str,
    strip: Option<&PaletteStrip>,
) -> Result<PaletteSync, String> {
    let _job = psd_pipeline::exclusive();
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    let rows = psd_layers::rows(&doc);
    let held: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| {
            row.depth == 0
                && matches!(row.item, Item::Layer(_))
                && psd_layers::name_of(&doc, row).trim().eq_ignore_ascii_case(LAYER_NAME)
        })
        .map(|(index, _)| index)
        .collect();

    // Nothing wanted and nothing there: the common case, and the one that has
    // to cost nothing. Every project that has never turned the toggle on goes
    // out through here without the file being touched.
    if strip.is_none() && held.is_empty() {
        return Ok(PaletteSync::default());
    }

    if let Some(reason) = unwritable_because(&doc) {
        return Ok(PaletteSync {
            changed: false,
            skipped: Some(reason),
        });
    }

    let mut edits: Vec<LayerEdit> = Vec::with_capacity(rows.len() + 1);
    if let Some(strip) = strip {
        let patch = draw(strip, doc.width())?;
        edits.push(LayerEdit {
            index: None,
            name: LAYER_NAME.to_string(),
            depth: 0,
            // Lit, unlike the other two marks. See the module note.
            visible: Some(true),
            paint: Some(crate::psd_paint::Paint::from_patch(&patch)),
        });
    }
    for (index, row) in rows.iter().enumerate() {
        if held.contains(&index) {
            continue;
        }
        edits.push(LayerEdit::keep(
            index,
            psd_layers::name_of(&doc, row),
            row.depth,
        ));
    }

    // A file whose only layer was the strip. `rebuild` would be asked for a
    // PSD of nothing, which the fork will not write.
    if edits.is_empty() {
        return Ok(PaletteSync {
            changed: false,
            skipped: Some(format!("{key}.psd has no layers besides the palette")),
        });
    }

    std::fs::write(&path, rebuild(&doc, &edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;

    Ok(PaletteSync {
        changed: true,
        skipped: None,
    })
}

/// The strip itself: flat squares, left to right, wrapped to the canvas.
///
/// Flush rather than spaced, and with no outline. Both are about what this is
/// *for*: somebody is going to put an eyedropper in the middle of one of these
/// squares, and a hairline between two of them is a colour that is in the file
/// and not in the palette. Wrapped rather than run off the edge because the
/// canvas is whatever size the artwork made it — a sprite one grid space wide
/// would otherwise show two of a twelve-colour palette.
fn draw(strip: &PaletteStrip, canvas_width: u32) -> Result<Patch, String> {
    let cell = strip.cell.max(1);
    let colors: Vec<[u8; 4]> = strip.colors.iter().map(|hex| rgba(hex)).collect();
    if colors.is_empty() {
        return Err("The palette has no colours in it".to_string());
    }

    // At least one per row even on a canvas narrower than a square: the clip
    // in `psd_paint` then trims what hangs off, which is better than dividing
    // by zero over it.
    let per_row = (canvas_width / cell).max(1) as usize;
    let across = per_row.min(colors.len());
    let down = colors.len().div_ceil(per_row);

    let width = (across as u32) * cell;
    let height = (down as u32) * cell;
    let mut rgba_buf = vec![0u8; (width as usize) * (height as usize) * 4];

    for (at, color) in colors.iter().enumerate() {
        let col = (at % per_row) as u32;
        let row = (at / per_row) as u32;
        for y in 0..cell {
            let top = (row * cell + y) as usize;
            for x in 0..cell {
                let left = (col * cell + x) as usize;
                let px = (top * (width as usize) + left) * 4;
                rgba_buf[px..px + 4].copy_from_slice(color);
            }
        }
    }

    // Top-left corner. There is no good general answer to where a strip goes
    // on a canvas the editor knows nothing about, and the corner is the one
    // place an artist can always find it — and the one place a canvas with a
    // margin round the artwork (see `psd_marks::layout`) is usually empty.
    Ok(Patch {
        left: 0,
        top: 0,
        width,
        height,
        rgba: rgba_buf,
    })
}

/// A hex colour as straight RGBA8.
///
/// Tolerant in the same four shapes `lib/color.ts` is — `rgb`, `rgba`,
/// `rrggbb`, `rrggbbaa` — because the editor normalises before sending and a
/// second reader of the same strings should not be the place that disagrees
/// about what one is. Anything unreadable comes back opaque black rather than
/// failing the send: one wrong square is a worse outcome than no palette.
fn rgba(hex: &str) -> [u8; 4] {
    let clean = hex.trim().trim_start_matches('#');
    let full: String = if clean.len() == 3 || clean.len() == 4 {
        clean.chars().flat_map(|c| [c, c]).collect()
    } else {
        clean.to_string()
    };
    let byte = |at: usize| u8::from_str_radix(full.get(at..at + 2).unwrap_or("00"), 16).unwrap_or(0);
    if full.len() < 6 {
        return [0, 0, 0, 255];
    }
    [
        byte(0),
        byte(2),
        byte(4),
        if full.len() >= 8 { byte(6) } else { 255 },
    ]
}
