//! Laying new pixels into a layer a PSD already has.
//!
//! What pen mode applies. The editor draws over the canvas in its own ink,
//! rasterises the strokes at the file's own resolution, and hands the result
//! here to be composited into one named layer — so drawing into a PSD from
//! the editor and painting into it in Photoshop leave the same kind of file
//! behind.
//!
//! It has to happen on this side. The editor could composite against the
//! sprite psd-to-json exported, but that PNG is quantised on the way out
//! (`png_quality_range`), so a round trip through it would degrade the
//! artwork a little every time somebody drew on it. The layer's real pixels
//! are only in the PSD.
//!
//! Two rules are worth naming, because both are decisions rather than
//! mechanics:
//!
//! - **Ink is laid over, not instead of.** A layer painted into keeps what
//!   was in it, and the rectangle the layer occupies grows to hold both.
//! - **A blank layer has no rectangle worth keeping.** An empty layer is
//!   written as a single transparent pixel at the origin (see
//!   `psd_layers::add`), and treating that pixel as part of the artwork would
//!   leave every layer drawn into from scratch carrying a transparent margin
//!   back to the corner of the canvas.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;

/// A rectangle of RGBA8 pixels, placed on the PSD's canvas.
pub struct Patch {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
    /// `width * height * 4` bytes, row-major, straight (un-premultiplied).
    pub rgba: Vec<u8>,
}

impl Patch {
    fn at(&self, x: u32, y: u32) -> usize {
        ((y as usize) * (self.width as usize) + (x as usize)) * 4
    }

    /// Whether nothing in it would show. See the module note.
    pub fn is_blank(&self) -> bool {
        self.rgba.chunks_exact(4).all(|px| px[3] == 0)
    }
}

/// Ink as the editor sends it: where it goes on the canvas, and the pixels.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paint {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// RGBA8, `width * height * 4` bytes, base64 over the bridge.
    pub rgba_base64: String,
}

impl Paint {
    pub fn decode(&self) -> Result<Patch, String> {
        let rgba = STANDARD
            .decode(&self.rgba_base64)
            .map_err(|e| format!("Cannot read the ink: {e}"))?;
        let expected = (self.width as usize) * (self.height as usize) * 4;
        if rgba.len() != expected {
            return Err(format!(
                "The ink is {} bytes, expected {expected} for {}x{}",
                rgba.len(),
                self.width,
                self.height
            ));
        }
        Ok(Patch {
            left: self.x,
            top: self.y,
            width: self.width,
            height: self.height,
            rgba,
        })
    }
}

/// Take the part of a patch that is actually on the canvas.
///
/// None when none of it is. A stroke drawn past the edge of the PSD's canvas
/// is not an error — the frame pen mode draws is a boundary to work inside,
/// not a wall — so what falls outside is simply dropped.
pub fn clip(patch: Patch, canvas_w: u32, canvas_h: u32) -> Option<Patch> {
    let x0 = patch.left.max(0);
    let y0 = patch.top.max(0);
    let x1 = (patch.left + patch.width as i32).min(canvas_w as i32);
    let y1 = (patch.top + patch.height as i32).min(canvas_h as i32);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    // Wholly inside, which is the ordinary case: nothing to copy.
    if x0 == patch.left
        && y0 == patch.top
        && x1 == patch.left + patch.width as i32
        && y1 == patch.top + patch.height as i32
    {
        return Some(patch);
    }

    let width = (x1 - x0) as u32;
    let height = (y1 - y0) as u32;
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        let src_y = (y0 - patch.top) as u32 + y;
        let src = patch.at((x0 - patch.left) as u32, src_y);
        let dst = ((y as usize) * (width as usize)) * 4;
        let run = (width as usize) * 4;
        rgba[dst..dst + run].copy_from_slice(&patch.rgba[src..src + run]);
    }
    Some(Patch {
        left: x0,
        top: y0,
        width,
        height,
        rgba,
    })
}

/// Lay `ink` over `base`, source-over, on the rectangle covering both.
///
/// Straight alpha in and out, which is what `psd`'s `LayerBuilder` takes and
/// what `PsdLayer::rgba` hands back — so the composite has to un-premultiply
/// nothing and the arithmetic is the plain Porter-Duff `over`.
pub fn over(base: Option<Patch>, ink: Patch) -> Patch {
    let Some(base) = base else { return ink };

    let left = base.left.min(ink.left);
    let top = base.top.min(ink.top);
    let right = (base.left + base.width as i32).max(ink.left + ink.width as i32);
    let bottom = (base.top + base.height as i32).max(ink.top + ink.height as i32);
    let width = (right - left) as u32;
    let height = (bottom - top) as u32;

    let mut out = Patch {
        left,
        top,
        width,
        height,
        rgba: vec![0u8; (width as usize) * (height as usize) * 4],
    };
    blit(&mut out, &base);
    for y in 0..ink.height {
        for x in 0..ink.width {
            let src = ink.at(x, y);
            let alpha = ink.rgba[src + 3];
            if alpha == 0 {
                continue;
            }
            let dst = out.at(
                (ink.left - left) as u32 + x,
                (ink.top - top) as u32 + y,
            );
            if alpha == 255 {
                out.rgba[dst..dst + 4].copy_from_slice(&ink.rgba[src..src + 4]);
                continue;
            }
            let sa = alpha as f32 / 255.0;
            let da = out.rgba[dst + 3] as f32 / 255.0;
            let a = sa + da * (1.0 - sa);
            for c in 0..3 {
                let sc = ink.rgba[src + c] as f32 / 255.0;
                let dc = out.rgba[dst + c] as f32 / 255.0;
                let blended = (sc * sa + dc * da * (1.0 - sa)) / a;
                out.rgba[dst + c] = (blended * 255.0).round().clamp(0.0, 255.0) as u8;
            }
            out.rgba[dst + 3] = (a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

/// Copy one patch into another that contains it, pixels as they are.
fn blit(into: &mut Patch, from: &Patch) {
    let dx = (from.left - into.left) as u32;
    let dy = (from.top - into.top) as u32;
    for y in 0..from.height {
        let src = from.at(0, y);
        let dst = into.at(dx, dy + y);
        let run = (from.width as usize) * 4;
        into.rgba[dst..dst + run].copy_from_slice(&from.rgba[src..src + run]);
    }
}
