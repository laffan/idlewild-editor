//! Orienting marks written into every imported PSD.
//!
//! An imported image arrives with no idea where the game will pin it, and
//! someone opening it in Photoshop to flesh the artwork out has nothing to
//! draw against. So the import writes two layers beside the artwork, both
//! named for psd-to-json's pipe convention:
//!
//!   `P | anchor`  a red dot on the grid space the image is anchored to
//!   `Z | grid`    the grid selection it was dropped into, spaces and all
//!
//! Neither reaches the game as pixels. psd-to-json exports images only for
//! sprites and tilesets — a point becomes its centre, a zone its bounds —
//! so both are visible while editing the PSD and invisible in the running
//! game. That is what makes them safe to draw over the artwork.
//!
//! The point is what the editor reads back. It is recorded in canvas
//! coordinates, so an artist can resize the canvas, move the artwork, or
//! redraw the whole thing, and as long as the dot stays on the spot that
//! should sit on the grid space, the placement follows it.

use crate::psd_write::AnchorMarks;
use psd::LayerBuilder;

/// The dot's diameter in pixels. psd-to-json reports a point as the centre
/// of its layer, so this is kept even: an odd diameter puts the recorded
/// centre half a pixel off the anchor it is meant to mark.
const DOT: u32 = 12;

const ACCENT: [u8; 3] = [236, 48, 19];

/// A point and a segment in the zone layer's own pixel space.
type Px = (f32, f32);
type Segment = (Px, Px);

/// Where everything sits once the artwork and the grid footprint are laid
/// out around a common anchor.
pub struct Layout {
    pub canvas_width: u32,
    pub canvas_height: u32,
    /// Where the artwork's top-left goes in canvas coordinates.
    pub art_left: i32,
    pub art_top: i32,
    /// The anchor itself, in canvas coordinates.
    pub anchor_x: i32,
    pub anchor_y: i32,
    /// The grid footprint's box in canvas coordinates.
    zone_left: i32,
    zone_top: i32,
    zone_width: u32,
    zone_height: u32,
}

/// Lay the artwork and the grid footprint out around the anchor.
///
/// An imported image has no opinion about where on its grid space it
/// belongs, so it is centred on the anchor — which is where the editor has
/// always put one. Something converted from what is already on the grid does
/// know, and says so in `art`.
///
/// The footprint sits wherever the grid selection actually was relative to
/// the anchor, and the canvas grows to hold both — a tall sprite dropped on
/// one tile keeps its own size and simply has the tile marked underneath it.
///
/// `marks.margin` is empty room around the lot. It is the one thing here that
/// changes the canvas without changing where anything sits *on the grid*:
/// every position below is relative to the anchor, the anchor moves out with
/// the canvas, and the artwork keeps its offset from it. What the margin buys
/// is somewhere to paint — a canvas cropped exactly to a block-out has no
/// room for the eaves that hang past the wall.
pub fn layout(image_width: u32, image_height: u32, marks: &AnchorMarks) -> Layout {
    let (art_x, art_y) = match marks.art {
        Some(p) => (p.x, p.y),
        None => (-(image_width as f32) / 2.0, -(image_height as f32) / 2.0),
    };
    let art = (art_x, art_y, image_width as f32, image_height as f32);

    let zone = outline_box(marks).unwrap_or(art);

    let (margin_x, margin_y) = match marks.margin {
        Some(p) => (p.x.max(0.0), p.y.max(0.0)),
        None => (0.0, 0.0),
    };

    let min_x = (art.0.min(zone.0) - margin_x).floor();
    let min_y = (art.1.min(zone.1) - margin_y).floor();
    let max_x = ((art.0 + art.2).max(zone.0 + zone.2) + margin_x).ceil();
    let max_y = ((art.1 + art.3).max(zone.1 + zone.3) + margin_y).ceil();

    Layout {
        canvas_width: (max_x - min_x).max(1.0) as u32,
        canvas_height: (max_y - min_y).max(1.0) as u32,
        art_left: (art.0 - min_x).round() as i32,
        art_top: (art.1 - min_y).round() as i32,
        anchor_x: (-min_x).round() as i32,
        anchor_y: (-min_y).round() as i32,
        zone_left: (zone.0 - min_x).round() as i32,
        zone_top: (zone.1 - min_y).round() as i32,
        zone_width: zone.2.max(1.0).round() as u32,
        zone_height: zone.3.max(1.0).round() as u32,
    }
}

/// The two marker layers, ready to add above the artwork.
pub fn layers(layout: &Layout, marks: &AnchorMarks) -> Vec<LayerBuilder> {
    let mut out = Vec::new();
    if let Some(zone) = zone_layer(layout, marks) {
        out.push(zone);
    }
    out.push(anchor_layer(layout));
    out
}

/// The footprint on its own.
///
/// Separate from `layers` because a rewrite puts each mark back *where it
/// was* in the stack rather than both on top — see `psd_write::rewrite_marked`
/// — and picking them out of a vector by position would be a sharp edge
/// waiting for whoever adds a third mark.
pub fn zone_layer(layout: &Layout, marks: &AnchorMarks) -> Option<LayerBuilder> {
    let pixels = zone_pixels(layout, marks)?;
    Some(
        LayerBuilder::new(format!("Z | {}", zone_name(marks)))
            .rgba(layout.zone_width, layout.zone_height, pixels)
            .at(layout.zone_left, layout.zone_top),
    )
}

/// The anchor dot on its own.
pub fn anchor_layer(layout: &Layout) -> LayerBuilder {
    LayerBuilder::new("P | anchor")
        .rgba(DOT, DOT, dot_pixels())
        .at(
            layout.anchor_x - DOT as i32 / 2,
            layout.anchor_y - DOT as i32 / 2,
        )
}

fn zone_name(marks: &AnchorMarks) -> String {
    if marks.cols <= 1 && marks.rows <= 1 {
        "grid".to_string()
    } else {
        format!("grid-{}x{}", marks.cols.max(1), marks.rows.max(1))
    }
}

/// The outline's bounding box, in anchor-relative pixels.
fn outline_box(marks: &AnchorMarks) -> Option<(f32, f32, f32, f32)> {
    let first = marks.outline.first()?;
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (first.x, first.y, first.x, first.y);
    for p in &marks.outline {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    if max_x - min_x < 1.0 || max_y - min_y < 1.0 {
        return None;
    }
    Some((min_x, min_y, max_x - min_x, max_y - min_y))
}

/// A filled disc in the accent, feathered by one pixel so it does not read
/// as a square at small sizes.
fn dot_pixels() -> Vec<u8> {
    let n = DOT as f32;
    let r = n / 2.0;
    let mut out = Vec::with_capacity((DOT * DOT * 4) as usize);
    for y in 0..DOT {
        for x in 0..DOT {
            let dx = x as f32 + 0.5 - r;
            let dy = y as f32 + 0.5 - r;
            let d = (dx * dx + dy * dy).sqrt();
            let alpha = ((r - d).clamp(0.0, 1.0) * 255.0) as u8;
            out.extend_from_slice(&[ACCENT[0], ACCENT[1], ACCENT[2], alpha]);
        }
    }
    out
}

/// How the footprint is drawn: a solid outer edge, a lighter line on each
/// division between spaces, and a wash over the whole thing.
const OUTLINE_ALPHA: u8 = 220;
const DIVISION_ALPHA: u8 = 110;
const WASH_ALPHA: u8 = 26;
/// Half the stroke width, in pixels.
const LINE_HALF: f32 = 0.75;

/// The grid footprint: the outline, the divisions between the spaces inside
/// it, and a translucent wash.
///
/// Drawn from the polygon and segments the editor sends rather than from a
/// rectangle and a step, so an isometric selection is the diamond it really
/// is and its divisions run along the diamond's own diagonals. The outline
/// wins where the two meet, so the boundary always reads as the boundary.
fn zone_pixels(layout: &Layout, marks: &AnchorMarks) -> Option<Vec<u8>> {
    let (ox, oy, _, _) = outline_box(marks)?;
    // Into layer-local coordinates: the marks are anchor-relative, the
    // layer's own origin is its top-left.
    let poly: Vec<Px> = marks
        .outline
        .iter()
        .map(|p| (p.x - ox, p.y - oy))
        .collect();
    if poly.len() < 3 {
        return None;
    }
    let divisions: Vec<Segment> = marks
        .lines
        .iter()
        .map(|l| ((l.a.x - ox, l.a.y - oy), (l.b.x - ox, l.b.y - oy)))
        .collect();

    let (w, h) = (layout.zone_width, layout.zone_height);
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let alpha = if distance_to_outline(px, py, &poly) <= LINE_HALF * 2.0 {
                OUTLINE_ALPHA
            } else if near_any(px, py, &divisions) {
                DIVISION_ALPHA
            } else if point_in_polygon(px, py, &poly) {
                WASH_ALPHA
            } else {
                0
            };
            out.extend_from_slice(&[ACCENT[0], ACCENT[1], ACCENT[2], alpha]);
        }
    }
    Some(out)
}

fn near_any(x: f32, y: f32, lines: &[Segment]) -> bool {
    lines
        .iter()
        .any(|(a, b)| point_to_segment(x, y, *a, *b) <= LINE_HALF)
}

fn point_in_polygon(x: f32, y: f32, poly: &[Px]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn distance_to_outline(x: f32, y: f32, poly: &[Px]) -> f32 {
    let mut best = f32::MAX;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        best = best.min(point_to_segment(x, y, poly[j], poly[i]));
        j = i;
    }
    best
}

fn point_to_segment(px: f32, py: f32, a: Px, b: Px) -> f32 {
    let (vx, vy) = (b.0 - a.0, b.1 - a.1);
    let (wx, wy) = (px - a.0, py - a.1);
    let vv = vx * vx + vy * vy;
    if vv == 0.0 {
        return (wx * wx + wy * wy).sqrt();
    }
    let t = ((wx * vx + wy * vy) / vv).clamp(0.0, 1.0);
    let dx = px - (a.0 + vx * t);
    let dy = py - (a.1 + vy * t);
    (dx * dx + dy * dy).sqrt()
}
