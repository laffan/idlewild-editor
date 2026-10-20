//! Grid alignment for a PSD: the artwork laid into an isometric grid's plane.
//!
//! The same orientations a note on the canvas can take — along either of the
//! grid's diagonals, lying on the floor or standing up like a sign on a wall —
//! for a placed file. The editor works out the plane from the grid and sends
//! it: where the file's own x axis and y axis go on the canvas, as two unit
//! vectors (`GridAlign`). Kept in `ProjectMeta::grid_align`, by key.
//!
//! **The PSD itself is not changed**, the way Pixel Art Rescale does not
//! change it: every time the pipeline parses the file, a slanted copy of it is
//! written beside the project and *that* is what psd-to-json reads, so the
//! sprites in `assets/` (and `print/`) are slanted and the file in `psd/` is
//! as it was drawn. An edit to the file — in Photoshop or in PSD Edit mode —
//! comes back slanted the next time it is parsed. The game, a publish and a
//! print export all read the sprites, so all of them show it.
//!
//! **Rasterize** writes the slanted copy over the file and drops the setting,
//! for when the slant should be in the pixels for good.
//!
//! Every layer is resampled through the plane into its own new rectangle, and
//! the stack — groups, names, visibility, opacity, blend — is put back as it
//! was, the way Downsample rebuilds a file. The canvas grows to the box round
//! the slanted canvas. Smooth, premultiplied, except on a pixel-art project,
//! where it is nearest neighbour so hard edges stay hard.

use std::path::{Path, PathBuf};

use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};
use serde::{Deserialize, Serialize};

use crate::psd_downsample::{premultiply, unpremultiply};
use crate::psd_layers::{crop, items, unrebuildable_because, Item};
use crate::psd_pipeline::{process_held, safe_key, ProcessOptions};
use crate::store;

/// How a file lies in the grid's plane, as the editor's controls set it and
/// the plane those come to on this project's grid.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridAlign {
    /// Which diagonal the file's rows run along: `cx` (NW→SE) or `cy`.
    #[serde(default)]
    pub runs: String,
    /// Standing up: the file's columns run straight down the screen.
    #[serde(default)]
    pub upright: bool,
    /// Where the file's x axis goes, and its y axis — unit vectors.
    pub ax: f64,
    pub ay: f64,
    pub bx: f64,
    pub by: f64,
}

impl GridAlign {
    fn det(&self) -> f64 {
        self.ax * self.by - self.bx * self.ay
    }

    /// A plane that can be drawn through: finite, and not flat.
    fn usable(&self) -> bool {
        [self.ax, self.ay, self.bx, self.by].iter().all(|v| v.is_finite())
            && self.det().abs() > 1e-6
    }

    fn map(&self, x: f64, y: f64) -> (f64, f64) {
        (x * self.ax + y * self.bx, x * self.ay + y * self.by)
    }

    fn unmap(&self, x: f64, y: f64) -> (f64, f64) {
        let det = self.det();
        ((self.by * x - self.bx * y) / det, (-self.ay * x + self.ax * y) / det)
    }

    /// The box a rectangle comes out in: its corners through the plane.
    fn bounds(&self, left: f64, top: f64, width: f64, height: f64) -> (f64, f64, f64, f64) {
        let corners = [
            self.map(left, top),
            self.map(left + width, top),
            self.map(left, top + height),
            self.map(left + width, top + height),
        ];
        let min_x = corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min);
        let min_y = corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min);
        let max_x = corners.iter().map(|c| c.0).fold(f64::NEG_INFINITY, f64::max);
        let max_y = corners.iter().map(|c| c.1).fold(f64::NEG_INFINITY, f64::max);
        (min_x, min_y, max_x, max_y)
    }
}

/// A file's alignment, or None for one drawn flat.
pub fn align_of<'a>(meta: &'a crate::project::ProjectMeta, key: &str) -> Option<&'a GridAlign> {
    meta.grid_align.get(key).filter(|a| a.usable())
}

/// The bytes laid into the plane. `nearest` keeps pixel art hard-edged.
pub fn aligned(bytes: &[u8], plane: &GridAlign, nearest: bool) -> Result<Vec<u8>, String> {
    if !plane.usable() {
        return Err("That grid alignment has no plane to draw through".into());
    }
    let doc = Psd::from_bytes(bytes).map_err(|e| format!("Cannot read the PSD: {e}"))?;
    let (w, h) = (doc.width(), doc.height());
    let (min_x, min_y, max_x, max_y) = plane.bounds(0.0, 0.0, w as f64, h as f64);
    // Everything moves by this, so the slanted canvas starts at 0, 0.
    let shift = (-min_x.floor(), -min_y.floor());
    let width = (max_x.ceil() - min_x.floor()).max(1.0) as u32;
    let height = (max_y.ceil() - min_y.floor()).max(1.0) as u32;
    if width.max(height) > 30_000 {
        return Err("Laid into the grid this file would be more than a PSD can hold".into());
    }
    let mut builder = PsdBuilder::new(width, height);
    let mut layers: Vec<Option<LayerBuilder>> = (0..doc.layers().len())
        .map(|index| Some(slant_layer(&doc, index, plane, shift, nearest)))
        .collect();
    for item in items(&doc, None).into_iter().rev() {
        match rebuilt(&doc, item, &mut layers) {
            Some(Rebuilt::Layer(layer)) => {
                builder.add_layer(layer);
            }
            Some(Rebuilt::Group(group)) => {
                builder.add_group(group);
            }
            None => {}
        }
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Cannot write the aligned copy: {e:?}"))
}

enum Rebuilt {
    Layer(LayerBuilder),
    Group(GroupBuilder),
}

fn rebuilt(doc: &Psd, item: Item, layers: &mut [Option<LayerBuilder>]) -> Option<Rebuilt> {
    match item {
        Item::Layer(index) => layers.get_mut(index)?.take().map(Rebuilt::Layer),
        Item::Group(id) => {
            let group = doc.groups().get(&id)?;
            let mut out = GroupBuilder::new(group.name().to_string())
                .opacity(group.opacity())
                .visible(group.visible())
                .blend_mode(group.blend_mode());
            for child in items(doc, Some(id)).into_iter().rev() {
                match rebuilt(doc, child, layers) {
                    Some(Rebuilt::Layer(layer)) => out = out.add_layer(layer),
                    Some(Rebuilt::Group(inner)) => out = out.add_group(inner),
                    None => {}
                }
            }
            Some(Rebuilt::Group(out))
        }
    }
}

/// One layer through the plane, into the rectangle round where it lands.
fn slant_layer(
    doc: &Psd,
    index: usize,
    plane: &GridAlign,
    shift: (f64, f64),
    nearest: bool,
) -> LayerBuilder {
    let layer = doc.layer_by_idx(index);
    let (left, top, w, h, mut pixels) = crop(layer, doc.width(), doc.height());
    let named = LayerBuilder::new(layer.name().to_string());
    let out = if w == 0 || h == 0 {
        // An empty layer is still a layer somebody named: one clear pixel,
        // where its corner lands.
        let (x, y) = plane.map(left as f64, top as f64);
        named
            .rgba(1, 1, vec![0; 4])
            .at((x + shift.0).round() as i32, (y + shift.1).round() as i32)
    } else {
        let (x0, y0, x1, y1) = plane.bounds(left as f64, top as f64, w as f64, h as f64);
        let ox = (x0 + shift.0).floor();
        let oy = (y0 + shift.1).floor();
        let ow = ((x1 + shift.0).ceil() - ox).max(1.0) as u32;
        let oh = ((y1 + shift.1).ceil() - oy).max(1.0) as u32;
        if !nearest {
            premultiply(&mut pixels);
        }
        let mut out = vec![0u8; (ow as usize) * (oh as usize) * 4];
        for py in 0..oh {
            for px in 0..ow {
                // The middle of this pixel, back in the layer's own pixels.
                let (u, v) = plane.unmap(
                    ox + px as f64 + 0.5 - shift.0,
                    oy + py as f64 + 0.5 - shift.1,
                );
                let sx = u - left as f64 - 0.5;
                let sy = v - top as f64 - 0.5;
                let at = ((py as usize) * (ow as usize) + px as usize) * 4;
                let px_out = &mut out[at..at + 4];
                if nearest {
                    sample_nearest(&pixels, w, h, sx, sy, px_out);
                } else {
                    sample_bilinear(&pixels, w, h, sx, sy, px_out);
                }
            }
        }
        if !nearest {
            unpremultiply(&mut out);
        }
        named.rgba(ow, oh, out).at(ox as i32, oy as i32)
    };
    out.opacity(layer.opacity())
        .visible(layer.visible())
        .blend_mode(layer.blend_mode())
}

fn texel(pixels: &[u8], w: u32, h: u32, x: i64, y: i64) -> [f64; 4] {
    if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
        return [0.0; 4];
    }
    let i = ((y as usize) * (w as usize) + x as usize) * 4;
    [pixels[i] as f64, pixels[i + 1] as f64, pixels[i + 2] as f64, pixels[i + 3] as f64]
}

fn sample_nearest(pixels: &[u8], w: u32, h: u32, sx: f64, sy: f64, out: &mut [u8]) {
    let t = texel(pixels, w, h, sx.round() as i64, sy.round() as i64);
    for c in 0..4 {
        out[c] = t[c] as u8;
    }
}

fn sample_bilinear(pixels: &[u8], w: u32, h: u32, sx: f64, sy: f64, out: &mut [u8]) {
    let x0 = sx.floor();
    let y0 = sy.floor();
    let fx = sx - x0;
    let fy = sy - y0;
    let (x0, y0) = (x0 as i64, y0 as i64);
    let a = texel(pixels, w, h, x0, y0);
    let b = texel(pixels, w, h, x0 + 1, y0);
    let c = texel(pixels, w, h, x0, y0 + 1);
    let d = texel(pixels, w, h, x0 + 1, y0 + 1);
    for k in 0..4 {
        let top = a[k] + (b[k] - a[k]) * fx;
        let bottom = c[k] + (d[k] - c[k]) * fx;
        out[k] = (top + (bottom - top) * fy).round().clamp(0.0, 255.0) as u8;
    }
}

/// Where the slanted copy is written while it is parsed.
fn copy_path(project_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(store::project_dir(project_id)?
        .join(".grid")
        .join(format!("{}.psd", safe_key(key)?)))
}

/// Write the slanted copy of `bytes` beside the project and say where it is.
pub fn write_copy(
    project_id: &str,
    key: &str,
    bytes: &[u8],
    plane: &GridAlign,
    nearest: bool,
) -> Result<PathBuf, String> {
    let slanted = aligned(bytes, plane, nearest)?;
    let path = copy_path(project_id, key)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, slanted).map_err(|e| format!("Cannot write the aligned copy: {e}"))?;
    Ok(path)
}

/// Take the copy away once it has been parsed.
pub fn remove_copy(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Set a file's alignment — None to draw it flat — and process it again.
/// Hands back the new manifest.
pub fn set(
    project_id: &str,
    key: &str,
    align: Option<GridAlign>,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let key = safe_key(key)?;
    if align.as_ref().is_some_and(|a| !a.usable()) {
        return Err("That grid alignment has no plane to draw through".into());
    }
    let _job = crate::psd_pipeline::exclusive();
    let mut meta = store::read_meta(project_id)?;
    let before = meta.grid_align.get(key).cloned();
    match &align {
        Some(a) => meta.grid_align.insert(key.to_string(), a.clone()),
        None => meta.grid_align.remove(key),
    };
    store::write_meta(&meta)?;
    let processed = process_held(project_id, key, &ProcessOptions::default(), &emit_log);
    if processed.is_err() {
        // Put back what the assets were made with.
        match before {
            Some(a) => meta.grid_align.insert(key.to_string(), a),
            None => meta.grid_align.remove(key),
        };
        let _ = store::write_meta(&meta);
        let _ = process_held(project_id, key, &ProcessOptions::default(), &emit_log);
    }
    processed
}

/// Rasterize: write the slanted copy over the file itself, drop the setting,
/// and process it. Refused on a file a rebuild would lose something from.
pub fn rasterize(project_id: &str, key: &str, emit_log: impl Fn(&str)) -> Result<String, String> {
    let key = safe_key(key)?;
    let _job = crate::psd_pipeline::exclusive();
    let mut meta = store::read_meta(project_id)?;
    let Some(plane) = align_of(&meta, key).cloned() else {
        return Err(format!("{key}.psd is not aligned to the grid"));
    };
    let path = crate::psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot read the PSD: {e}"))?;
    if let Some(reason) = unrebuildable_because(&doc) {
        return Err(format!("{key}.psd cannot be rewritten without losing something: {reason}"));
    }
    let slanted = aligned(&bytes, &plane, meta.options.pixel_art)?;
    std::fs::write(&path, slanted).map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    emit_log(&format!("Laid psd/{key}.psd into the grid"));
    meta.grid_align.remove(key);
    store::write_meta(&meta)?;
    process_held(project_id, key, &ProcessOptions::default(), &emit_log)
}

/// A file renamed or copied takes its alignment with it.
pub fn carry(project_id: &str, from: &str, to: &str, moved: bool) {
    let Ok(mut meta) = store::read_meta(project_id) else { return };
    let Some(align) = meta.grid_align.get(from).cloned() else { return };
    if moved {
        meta.grid_align.remove(from);
    }
    meta.grid_align.insert(to.to_string(), align);
    let _ = store::write_meta(&meta);
}

/// Grid alignment, from the inspector's PSD section.
#[tauri::command(async)]
pub fn set_psd_grid_align(
    app: tauri::AppHandle,
    id: String,
    key: String,
    align: Option<GridAlign>,
) -> Result<String, String> {
    set(&id, &key, align, crate::logger(&app))
}

/// Rasterize Grid Alignment, from the same section.
#[tauri::command(async)]
pub fn rasterize_psd_grid_align(app: tauri::AppHandle, id: String, key: String) -> Result<String, String> {
    rasterize(&id, &key, crate::logger(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The floor plane of a 2:1 isometric grid, along `cx`.
    fn floor() -> GridAlign {
        let len = (2.0f64 * 2.0 + 1.0).sqrt();
        GridAlign {
            runs: "cx".into(),
            upright: false,
            ax: 2.0 / len,
            ay: 1.0 / len,
            bx: -2.0 / len,
            by: 1.0 / len,
        }
    }

    fn square(size: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.iter().copied().cycle().take((size * size * 4) as usize).collect()
    }

    #[test]
    fn lays_a_square_into_a_diamond_and_keeps_the_stack() {
        let mut builder = PsdBuilder::new(100, 100);
        builder.add_layer(LayerBuilder::new("S | tile".to_string()).rgba(100, 100, square(100, [200, 40, 20, 255])));
        builder.add_group(
            GroupBuilder::new("G | sign".to_string())
                .add_layer(LayerBuilder::new("S | text".to_string()).rgba(10, 10, square(10, [0, 0, 0, 255])).at(40, 40)),
        );
        let bytes = builder.to_bytes().unwrap();
        let out = Psd::from_bytes(&aligned(&bytes, &floor(), false).unwrap()).unwrap();
        // A 100-square on the floor is a diamond twice as wide as it is tall.
        let (w, h) = (out.width() as f64, out.height() as f64);
        assert!((w / h - 2.0).abs() < 0.05, "{w} × {h}");
        assert!(out.groups().values().any(|g| g.name() == "G | sign"));
        let tile = out.layers().iter().find(|l| l.name() == "S | tile").unwrap();
        let rgba = tile.rgba();
        let at = |x: u32, y: u32| &rgba[((y * out.width() + x) * 4) as usize..((y * out.width() + x) * 4 + 4) as usize];
        // The diamond's middle is the square's colour, its corners are clear.
        assert_eq!(at(out.width() / 2, out.height() / 2)[3], 255);
        assert_eq!(at(out.width() / 2, out.height() / 2)[0], 200);
        assert_eq!(at(2, 2)[3], 0);
    }

    #[test]
    fn a_pixel_art_copy_keeps_hard_edges() {
        let mut builder = PsdBuilder::new(40, 40);
        builder.add_layer(LayerBuilder::new("art".to_string()).rgba(40, 40, square(40, [10, 200, 30, 255])));
        let bytes = builder.to_bytes().unwrap();
        let out = Psd::from_bytes(&aligned(&bytes, &floor(), true).unwrap()).unwrap();
        for px in out.layers()[0].rgba().chunks_exact(4) {
            assert!(px[3] == 0 || px[3] == 255, "a soft edge: {px:?}");
        }
    }

    #[test]
    fn refuses_a_flat_plane() {
        let mut flat = floor();
        flat.bx = flat.ax;
        flat.by = flat.ay;
        let bytes = PsdBuilder::new(4, 4).to_bytes().unwrap();
        assert!(aligned(&bytes, &flat, false).is_err());
    }
}
