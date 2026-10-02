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
    let doc = Psd::from_bytes(bytes).map_err(|e| format!("Cannot read the PSD: {e}"))?;
    let factor = if factor.is_finite() && factor > 1.0 {
        factor
    } else {
        1.0
    };
    let width = scaled(doc.width(), factor);
    let height = scaled(doc.height(), factor);
    let mut builder = PsdBuilder::new(width, height);

    // `items` reads top-first and `add_*` stacks bottom-up.
    for item in items(&doc, None).into_iter().rev() {
        match built(&doc, item, factor) {
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

fn built(doc: &Psd, item: Item, factor: f64) -> Option<Built> {
    match item {
        Item::Layer(index) => {
            let layer = doc.layer_by_idx(index);
            let (left, top, width, height, pixels) = crop(layer, doc.width(), doc.height());
            let out = if width == 0 || height == 0 {
                // An empty layer is still a layer somebody named; keep it as one
                // clear pixel so the stack is the same shape.
                LayerBuilder::new(layer.name().to_string()).rgba(1, 1, vec![0; 4])
            } else {
                let (w, h, rgba) = shrink(width, height, pixels, factor)?;
                LayerBuilder::new(layer.name().to_string())
                    .rgba(w, h, rgba)
                    .at(
                        ((left as f64) / factor).round() as i32,
                        ((top as f64) / factor).round() as i32,
                    )
            };
            Some(Built::Layer(
                out.opacity(layer.opacity())
                    .visible(layer.visible())
                    .blend_mode(layer.blend_mode()),
            ))
        }
        Item::Group(id) => {
            let group = doc.groups().get(&id)?;
            let mut out = GroupBuilder::new(group.name().to_string())
                .opacity(group.opacity())
                .visible(group.visible())
                .blend_mode(group.blend_mode());
            for child in items(doc, Some(id)).into_iter().rev() {
                match built(doc, child, factor) {
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
) -> Option<(u32, u32, Vec<u8>)> {
    let w = scaled(width, factor);
    let h = scaled(height, factor);
    if w == width && h == height {
        return Some((w, h, pixels));
    }
    for px in pixels.chunks_exact_mut(4) {
        let a = px[3] as u32;
        for c in &mut px[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
    let image = RgbaImage::from_raw(width, height, pixels)?;
    let mut out = image::imageops::resize(&image, w, h, FilterType::CatmullRom).into_raw();
    for px in out.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a == 0 {
            px[0] = 0;
            px[1] = 0;
            px[2] = 0;
            continue;
        }
        for c in &mut px[..3] {
            *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
        }
    }
    Some((w, h, out))
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
        let (_, _, out) = shrink(40, 40, pixels, 3.0).unwrap();
        for px in out.chunks_exact(4) {
            if px[3] > 8 {
                assert!(px[0] > 240, "edge pixel darkened: {px:?}");
            }
        }
    }
}
