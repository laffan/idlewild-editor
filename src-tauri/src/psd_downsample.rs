//! A print project's PSD, at the resolution the screen wants.
//!
//! See `print.rs` for why a print project's files exist twice. This is the
//! smaller copy: the same stack — every layer and group, in the same order,
//! with the same names, visibility, opacity and blend modes — with every
//! layer's pixels and position divided by one factor, and the canvas with
//! them. psd-to-json then runs over it exactly as it runs over any file, into
//! `assets/`, and because nothing about the stack changed, every sprite it
//! writes has a full-resolution twin at the same path under `print/`.
//!
//! **Masks and clipping do not come across.** The fork's builder cannot write
//! either — the same limit every rewrite in this editor runs into — so a file
//! that uses them is still downsampled, and the screen copy shows the layers
//! unmasked. The full-resolution copy is psd-to-json's reading of the file as
//! it is, so nothing is lost from the print side.

use crate::psd_layers::{crop, items, unrebuildable_because, Item};
use image::{imageops::FilterType, RgbaImage};
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};

/// The downsampled file's bytes, and a warning when something will not survive.
pub fn downsample(bytes: &[u8], factor: f64) -> Result<(Vec<u8>, Option<String>), String> {
    let factor = if factor.is_finite() && factor > 1.0 {
        factor
    } else {
        1.0
    };
    resample(bytes, factor, false)
}

/// The file `times` times bigger, every pixel a `times`-square block of
/// itself — Pixel Art Rescale's copy, see `psd_pixel_scale.rs`. The same
/// stack rebuilt the same way, so it keeps and loses what the screen copy
/// does.
pub fn upscale_nearest(bytes: &[u8], times: u32) -> Result<(Vec<u8>, Option<String>), String> {
    resample(bytes, 1.0 / f64::from(times.max(1)), true)
}

/// Every layer and the canvas divided by `factor` — below one, multiplied —
/// smoothly, or nearest neighbour.
fn resample(
    bytes: &[u8],
    factor: f64,
    nearest: bool,
) -> Result<(Vec<u8>, Option<String>), String> {
    let doc = Psd::from_bytes(bytes).map_err(|e| format!("Cannot read the PSD: {e}"))?;
    let width = scaled(doc.width(), factor);
    let height = scaled(doc.height(), factor);
    let mut builder = PsdBuilder::new(width, height);
    let mut shrunk = shrink_all(&doc, factor, nearest);

    // `items` reads top-first and `add_*` stacks bottom-up.
    for item in items(&doc, None).into_iter().rev() {
        match built(&doc, item, &mut shrunk) {
            Some(Built::Layer(layer)) => {
                builder.add_layer(layer);
            }
            Some(Built::Group(group)) => {
                builder.add_group(group);
            }
            None => {}
        }
    }

    let bytes = builder
        .to_bytes()
        .map_err(|e| format!("Cannot write the screen copy: {e:?}"))?;
    Ok((bytes, unrebuildable_because(&doc)))
}

/// A length in the full file, in the small one. Never zero.
fn scaled(length: u32, factor: f64) -> u32 {
    ((length as f64) / factor).round().max(1.0) as u32
}

enum Built {
    Layer(LayerBuilder),
    Group(GroupBuilder),
}

/// How many layers are shrunk at once.
///
/// Two, not one per core. Each one in flight holds its layer's pixels twice
/// over — and, because `crop` reads through `PsdLayer::rgba`, a buffer the
/// size of the whole canvas besides: 112 MB for a letter page at 600 DPI. A
/// sketch is two big layers, the artwork and the grid mark, so two at a time
/// is the whole of the win for the commonest file, at a memory cost an iPad
/// can carry.
const AT_ONCE: usize = 2;

/// Every layer of the file, shrunk, by its index — worked out up front and
/// side by side, since no layer's pixels depend on another's.
fn shrink_all(doc: &Psd, factor: f64, nearest: bool) -> Vec<Option<LayerBuilder>> {
    let count = doc.layers().len();
    let next = std::sync::atomic::AtomicUsize::new(0);
    let done: Vec<std::sync::Mutex<Option<LayerBuilder>>> =
        (0..count).map(|_| std::sync::Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..AT_ONCE.min(count) {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if index >= count {
                    break;
                }
                let layer = shrink_layer(doc, index, factor, nearest);
                *done[index].lock().unwrap_or_else(|e| e.into_inner()) = layer;
            });
        }
    });
    done.into_iter()
        .map(|slot| slot.into_inner().unwrap_or_else(|e| e.into_inner()))
        .collect()
}

fn shrink_layer(doc: &Psd, index: usize, factor: f64, nearest: bool) -> Option<LayerBuilder> {
    let layer = doc.layer_by_idx(index);
    let (left, top, width, height, pixels) = crop(layer, doc.width(), doc.height());
    let out = if width == 0 || height == 0 {
        // An empty layer is still a layer somebody named; keep it as one
        // clear pixel so the stack is the same shape.
        LayerBuilder::new(layer.name().to_string()).rgba(1, 1, vec![0; 4])
    } else {
        let (w, h, rgba) = shrink(width, height, pixels, factor, nearest)?;
        LayerBuilder::new(layer.name().to_string())
            .rgba(w, h, rgba)
            .at(
                ((left as f64) / factor).round() as i32,
                ((top as f64) / factor).round() as i32,
            )
    };
    Some(
        out.opacity(layer.opacity())
            .visible(layer.visible())
            .blend_mode(layer.blend_mode()),
    )
}

fn built(doc: &Psd, item: Item, shrunk: &mut [Option<LayerBuilder>]) -> Option<Built> {
    match item {
        Item::Layer(index) => shrunk.get_mut(index)?.take().map(Built::Layer),
        Item::Group(id) => {
            let group = doc.groups().get(&id)?;
            let mut out = GroupBuilder::new(group.name().to_string())
                .opacity(group.opacity())
                .visible(group.visible())
                .blend_mode(group.blend_mode());
            for child in items(doc, Some(id)).into_iter().rev() {
                match built(doc, child, shrunk) {
                    Some(Built::Layer(layer)) => out = out.add_layer(layer),
                    Some(Built::Group(inner)) => out = out.add_group(inner),
                    None => {}
                }
            }
            Some(Built::Group(out))
        }
    }
}

/// Resample one layer's pixels down by `factor`.
///
/// Premultiplied on the way through: a plain resize of straight alpha blends
/// the colour of fully transparent pixels — usually black — into every edge,
/// and a sprite cut from a print file would come out of it with a dark fringe.
fn shrink(
    width: u32,
    height: u32,
    mut pixels: Vec<u8>,
    factor: f64,
    nearest: bool,
) -> Option<(u32, u32, Vec<u8>)> {
    let w = scaled(width, factor);
    let h = scaled(height, factor);
    if w == width && h == height {
        return Some((w, h, pixels));
    }
    // Nearest neighbour copies pixels rather than blending them, so there is
    // no edge to darken and nothing to premultiply for.
    if nearest {
        let image = RgbaImage::from_raw(width, height, pixels)?;
        let out = image::imageops::resize(&image, w, h, FilterType::Nearest).into_raw();
        return Some((w, h, out));
    }
    premultiply(&mut pixels);
    let image = RgbaImage::from_raw(width, height, pixels)?;
    let mut out = image::imageops::resize(&image, w, h, FilterType::CatmullRom).into_raw();
    unpremultiply(&mut out);
    Some((w, h, out))
}

/// `c * a / 255`, rounded, for every colour and alpha: a table rather than
/// the arithmetic, because this runs over every pixel of every layer of a
/// print file — seven million of them for one 300 DPI sketch — and a lookup
/// is the same answer for a fraction of the work.
fn premultiplied() -> &'static [[u8; 256]; 256] {
    static TABLE: std::sync::OnceLock<Box<[[u8; 256]; 256]>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = Box::new([[0u8; 256]; 256]);
        for a in 0..256u32 {
            for c in 0..256u32 {
                table[a as usize][c as usize] = ((c * a + 127) / 255) as u8;
            }
        }
        table
    })
}

/// And back: `c * 255 / a`, rounded and capped, where `a` is not zero.
fn unpremultiplied() -> &'static [[u8; 256]; 256] {
    static TABLE: std::sync::OnceLock<Box<[[u8; 256]; 256]>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = Box::new([[0u8; 256]; 256]);
        for a in 1..256u32 {
            for c in 0..256u32 {
                table[a as usize][c as usize] = ((c * 255 + a / 2) / a).min(255) as u8;
            }
        }
        table
    })
}

fn premultiply(pixels: &mut [u8]) {
    let table = premultiplied();
    for px in pixels.chunks_exact_mut(4) {
        match px[3] {
            255 => {}
            // Most of a sketch, and the reason a fringe was ever possible.
            0 => px[..3].fill(0),
            a => {
                let row = &table[a as usize];
                for c in &mut px[..3] {
                    *c = row[*c as usize];
                }
            }
        }
    }
}

fn unpremultiply(pixels: &mut [u8]) {
    let table = unpremultiplied();
    for px in pixels.chunks_exact_mut(4) {
        match px[3] {
            0 => px[..3].fill(0),
            a => {
                let row = &table[a as usize];
                for c in &mut px[..3] {
                    *c = row[*c as usize];
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.iter()
            .copied()
            .cycle()
            .take((width * height * 4) as usize)
            .collect()
    }

    #[test]
    fn keeps_the_stack_and_divides_the_geometry() {
        let mut builder = PsdBuilder::new(400, 300);
        builder.add_layer(LayerBuilder::new("S | back".to_string()).rgba(
            400,
            300,
            solid(400, 300, [10, 20, 30, 255]),
        ));
        builder.add_group(
            GroupBuilder::new("G | hut".to_string()).add_layer(
                LayerBuilder::new("S | roof".to_string())
                    .rgba(80, 40, solid(80, 40, [200, 0, 0, 255]))
                    .at(120, 60),
            ),
        );
        let bytes = builder.to_bytes().unwrap();

        let (small, warning) = downsample(&bytes, 4.0).unwrap();
        assert!(warning.is_none());
        let doc = Psd::from_bytes(&small).unwrap();
        assert_eq!((doc.width(), doc.height()), (100, 75));
        let roof = doc
            .layers()
            .iter()
            .find(|l| l.name() == "S | roof")
            .unwrap();
        assert_eq!((roof.layer_left(), roof.layer_top()), (30, 15));
        assert_eq!((roof.width(), roof.height()), (20, 10));
        assert!(doc.groups().values().any(|g| g.name() == "G | hut"));
        assert!(doc.layers().iter().any(|l| l.name() == "S | back"));
    }

    #[test]
    fn an_edge_stays_its_own_colour() {
        // A red square on clear ground: no black creeps into its edge.
        let mut pixels = vec![0u8; 40 * 40 * 4];
        for y in 10..30 {
            for x in 10..30 {
                let i = (y * 40 + x) * 4;
                pixels[i..i + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let (_, _, out) = shrink(40, 40, pixels, 3.0, false).unwrap();
        for px in out.chunks_exact(4) {
            if px[3] > 8 {
                assert!(px[0] > 240, "edge pixel darkened: {px:?}");
            }
        }
    }

    /// The tables are the arithmetic they replaced, for every input.
    #[test]
    fn nearest_upscale_makes_blocks_and_multiplies_the_geometry() {
        // Two pixels side by side, red then blue, at 3, 1.
        let mut pixels = solid(2, 1, [255, 0, 0, 255]);
        pixels[4..8].copy_from_slice(&[0, 0, 255, 255]);
        let mut builder = PsdBuilder::new(8, 4);
        builder.add_layer(LayerBuilder::new("art".to_string()).rgba(2, 1, pixels).at(3, 1));
        let bytes = builder.to_bytes().unwrap();
        let (big, _) = upscale_nearest(&bytes, 4).unwrap();
        let doc = Psd::from_bytes(&big).unwrap();
        assert_eq!((doc.width(), doc.height()), (32, 16));
        let (left, top, width, height, rgba) = crop(doc.layer_by_idx(0), 32, 16);
        assert_eq!((left, top, width, height), (12, 4, 8, 4));
        // Every pixel of the left block is the red one, untouched.
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&rgba[12..16], &[255, 0, 0, 255]);
        assert_eq!(&rgba[16..20], &[0, 0, 255, 255]);
    }

    #[test]
    fn the_tables_are_the_arithmetic() {
        let mut every: Vec<u8> = Vec::with_capacity(256 * 256 * 4);
        for a in 0..=255u8 {
            for c in 0..=255u8 {
                every.extend_from_slice(&[c, c / 2, 255 - c, a]);
            }
        }
        let mut by_table = every.clone();
        premultiply(&mut by_table);
        let mut by_hand = every.clone();
        for px in by_hand.chunks_exact_mut(4) {
            let a = px[3] as u32;
            for c in &mut px[..3] {
                *c = ((*c as u32 * a + 127) / 255) as u8;
            }
        }
        assert_eq!(by_table, by_hand);

        let mut by_table = every.clone();
        unpremultiply(&mut by_table);
        let mut by_hand = every;
        for px in by_hand.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a == 0 {
                px[..3].fill(0);
                continue;
            }
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
        assert_eq!(by_table, by_hand);
    }
}
