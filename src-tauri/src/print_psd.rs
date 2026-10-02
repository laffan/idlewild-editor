//! The page `ExportForPrint()` read, as a layered PSD at the project's DPI.
//!
//! The PDF is the page as it will be printed. The PSD is the same page as
//! something to keep working on: one layer per thing on the page, in the order
//! the scene drew them, each one the full-resolution pixels of its sprite drawn
//! where the sprite stood — rotated, scaled and flipped — so a generated
//! composition can be finished by hand in Photoshop. Both are written from the
//! same `print_pdf::prepare`, so they cannot disagree about what is on the
//! page.
//!
//! **Each layer is resampled; the PDF is not.** A PDF places an image with a
//! matrix and leaves the transform to whatever renders it. A PSD layer is a
//! grid of pixels aligned to the document's, so a sprite turned thirty degrees
//! has to be redrawn turned — bilinear, in premultiplied alpha so its edge
//! does not darken. Alpha rides as the layer's opacity and the blend mode as
//! its blend mode, both editable afterwards.
//!
//! **The flattened image is composited here, normally.** Every layer is drawn
//! over the ones below it at its opacity; blend modes are carried on the layers
//! but not applied to the flattened copy, which is what a viewer that cannot
//! read layers — and the preview — shows. Photoshop recomposites on open.

use crate::print_pdf::{prepare, project_reader, PrintPage, PrintResult, Report};
use crate::store;
use image::RgbaImage;
use psd::{BlendMode, LayerBuilder, PsdBuilder};

/// Where the last PSD a project printed is written, and its preview.
pub const PSD_REL: &str = "print-out/page.psd";
pub const PREVIEW_REL: &str = "print-out/page-preview.png";

/// Write the layered PSD for a page a print project sent, and a preview of it.
#[tauri::command(async)]
pub fn export_print_psd(id: String, page: PrintPage) -> Result<PrintResult, String> {
    let meta = store::read_meta(&id)?;
    if !meta.output.is_print() {
        return Err("Only a print project prints".into());
    }
    let dpi = meta.output.dpi();
    let read = project_reader(&id)?;
    let mut report = Report::default();
    let built = build(&page, dpi, &read, &mut report)?;

    let dir = store::project_dir(&id)?;
    let dest = dir.join(PSD_REL);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, &built.bytes).map_err(|e| format!("Cannot write the PSD: {e}"))?;
    std::fs::write(dir.join(PREVIEW_REL), preview_png(&built.flattened, 1600)?)
        .map_err(|e| format!("Cannot write the preview: {e}"))?;

    Ok(PrintResult {
        path: PSD_REL.to_string(),
        bytes: built.bytes.len(),
        width: page.page.width,
        height: page.page.height,
        dpi,
        drawn: built.layers,
        screen_only: report.screen_only,
        skipped: page.skipped + report.skipped,
        preview: Some(PREVIEW_REL.to_string()),
    })
}

/// The PSD's bytes and its flattened image, straight alpha.
pub struct BuiltPsd {
    pub bytes: Vec<u8>,
    pub flattened: RgbaImage,
    pub layers: usize,
}

/// Build the layered PSD for a page.
pub fn build(
    page: &PrintPage,
    dpi: u32,
    read: &dyn Fn(&str) -> Result<(RgbaImage, bool), String>,
    report: &mut Report,
) -> Result<BuiltPsd, String> {
    let scale = dpi as f64 / 72.0;
    let width = ((page.page.width.max(1.0)) * scale).round() as u32;
    let height = ((page.page.height.max(1.0)) * scale).round() as u32;
    // Premultiplied, so drawing one layer over another is one multiply-add.
    let mut flat = vec![0u8; (width as usize) * (height as usize) * 4];
    let mut builder = PsdBuilder::new(width, height);
    let mut names: Vec<String> = Vec::new();
    let mut layers = 0usize;

    if let Some([r, g, b, a]) = page.background {
        let white = r >= 254.0 && g >= 254.0 && b >= 254.0;
        if a > 0.0 && !white {
            let px = [r as u8, g as u8, b as u8, 255];
            let fill: Vec<u8> = px.iter().copied().cycle().take(flat.len()).collect();
            over(&mut flat, width, 0, 0, width, height, &fill, 255);
            builder.add_layer(LayerBuilder::new("Background").rgba(width, height, fill));
            layers += 1;
        }
    }

    for item in prepare(page, dpi, read, report) {
        let m = item.matrix.map(|v| v * scale);
        let Some((left, top, w, h, pixels)) = draw(&item.image, m, width, height) else {
            continue;
        };
        let opacity = (item.alpha * 255.0).round() as u8;
        over(&mut flat, width, left, top, w, h, &pixels, opacity);
        let name = unique(&mut names, &item.name);
        builder.add_layer(
            LayerBuilder::new(name)
                .rgba(w, h, pixels)
                .at(left as i32, top as i32)
                .opacity(opacity)
                .blend_mode(blend_mode(item.blend)),
        );
        layers += 1;
        report.drawn += 1;
    }

    let flattened = unpremultiply(flat, width, height);
    builder.flattened_image(flattened.as_raw().clone());
    let bytes = builder
        .to_bytes()
        .map_err(|e| format!("Cannot write the PSD: {e:?}"))?;
    let bytes = crate::psd_resolution::stamp(&bytes, dpi).unwrap_or(bytes);
    Ok(BuiltPsd {
        bytes,
        flattened,
        layers,
    })
}

/// One image drawn through a matrix onto the document's pixel grid, cropped to
/// what it covers: left, top, width, height and straight-alpha pixels. None
/// when it covers nothing on the page.
fn draw(
    image: &RgbaImage,
    m: [f64; 6],
    canvas_w: u32,
    canvas_h: u32,
) -> Option<(u32, u32, u32, u32, Vec<u8>)> {
    let [a, b, c, d, e, f] = m;
    let det = a * d - b * c;
    if det.abs() < 1e-9 {
        return None;
    }
    let xs = [e, a + e, c + e, a + c + e];
    let ys = [f, b + f, d + f, b + d + f];
    let fold = |v: &[f64; 4], pick: fn(f64, f64) -> f64| v.iter().copied().fold(v[0], pick);
    let x0 = fold(&xs, f64::min).floor().max(0.0) as u32;
    let y0 = fold(&ys, f64::min).floor().max(0.0) as u32;
    let x1 = (fold(&xs, f64::max).ceil().min(canvas_w as f64)).max(0.0) as u32;
    let y1 = (fold(&ys, f64::max).ceil().min(canvas_h as f64)).max(0.0) as u32;
    if x1 <= x0 || y1 <= y0 {
        return None;
    }

    let (iw, ih) = (image.width() as f64, image.height() as f64);
    let (w, h) = (x1 - x0, y1 - y0);
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    let mut any = false;
    for row in 0..h {
        let py = (y0 + row) as f64 + 0.5 - f;
        for col in 0..w {
            let px = (x0 + col) as f64 + 0.5 - e;
            let u = (d * px - c * py) / det;
            let v = (-b * px + a * py) / det;
            if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
                continue;
            }
            let sample = bilinear(image, u * iw - 0.5, v * ih - 0.5);
            if sample[3] == 0 {
                continue;
            }
            any = true;
            let i = ((row * w + col) * 4) as usize;
            out[i..i + 4].copy_from_slice(&sample);
        }
    }
    any.then_some((x0, y0, w, h, out))
}

/// The image at a fractional pixel, straight alpha, blended in premultiplied.
fn bilinear(image: &RgbaImage, x: f64, y: f64) -> [u8; 4] {
    let max_x = image.width() as i64 - 1;
    let max_y = image.height() as i64 - 1;
    let (fx, fy) = (x.floor(), y.floor());
    let (tx, ty) = (x - fx, y - fy);
    let at = |ix: i64, iy: i64| {
        image
            .get_pixel(ix.clamp(0, max_x) as u32, iy.clamp(0, max_y) as u32)
            .0
    };
    let (ix, iy) = (fx as i64, fy as i64);
    let corners = [
        (at(ix, iy), (1.0 - tx) * (1.0 - ty)),
        (at(ix + 1, iy), tx * (1.0 - ty)),
        (at(ix, iy + 1), (1.0 - tx) * ty),
        (at(ix + 1, iy + 1), tx * ty),
    ];
    let mut acc = [0.0f64; 4];
    for (px, weight) in corners {
        let alpha = px[3] as f64 / 255.0 * weight;
        acc[0] += px[0] as f64 * alpha;
        acc[1] += px[1] as f64 * alpha;
        acc[2] += px[2] as f64 * alpha;
        acc[3] += alpha;
    }
    if acc[3] <= 0.0 {
        return [0, 0, 0, 0];
    }
    [
        (acc[0] / acc[3]).round().min(255.0) as u8,
        (acc[1] / acc[3]).round().min(255.0) as u8,
        (acc[2] / acc[3]).round().min(255.0) as u8,
        (acc[3] * 255.0).round().min(255.0) as u8,
    ]
}

/// Draw straight-alpha pixels over the premultiplied flattened image.
#[allow(clippy::too_many_arguments)]
fn over(
    flat: &mut [u8],
    canvas_w: u32,
    left: u32,
    top: u32,
    w: u32,
    h: u32,
    pixels: &[u8],
    opacity: u8,
) {
    for row in 0..h {
        for col in 0..w {
            let s = ((row * w + col) * 4) as usize;
            let alpha = pixels[s + 3] as u32 * opacity as u32 / 255;
            if alpha == 0 {
                continue;
            }
            let d = (((top + row) * canvas_w + left + col) * 4) as usize;
            let keep = 255 - alpha;
            for ch in 0..3 {
                let src = pixels[s + ch] as u32 * alpha / 255;
                flat[d + ch] = (src + flat[d + ch] as u32 * keep / 255).min(255) as u8;
            }
            flat[d + 3] = (alpha + flat[d + 3] as u32 * keep / 255).min(255) as u8;
        }
    }
}

fn unpremultiply(mut flat: Vec<u8>, width: u32, height: u32) -> RgbaImage {
    for px in flat.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a == 0 || a == 255 {
            continue;
        }
        for ch in &mut px[..3] {
            *ch = ((*ch as u32 * 255 + a / 2) / a).min(255) as u8;
        }
    }
    RgbaImage::from_raw(width, height, flat).unwrap_or_else(|| RgbaImage::new(width, height))
}

/// A layer name not already in the file: `roof`, `roof 2`, `roof 3`.
fn unique(names: &mut Vec<String>, wanted: &str) -> String {
    let base = if wanted.is_empty() { "Layer" } else { wanted };
    let mut name = base.to_string();
    let mut n = 2;
    while names.contains(&name) {
        name = format!("{base} {n}");
        n += 1;
    }
    names.push(name.clone());
    name
}

/// Photoshop's blend mode for the name `print_pdf::blend_name` gives.
fn blend_mode(name: &str) -> BlendMode {
    match name {
        "Multiply" => BlendMode::Multiply,
        "Screen" => BlendMode::Screen,
        "Overlay" => BlendMode::Overlay,
        "Darken" => BlendMode::Darken,
        "Lighten" => BlendMode::Lighten,
        "ColorDodge" => BlendMode::ColorDodge,
        "ColorBurn" => BlendMode::ColorBurn,
        "HardLight" => BlendMode::HardLight,
        "SoftLight" => BlendMode::SoftLight,
        "Difference" => BlendMode::Difference,
        "Exclusion" => BlendMode::Exclusion,
        "Hue" => BlendMode::Hue,
        "Saturation" => BlendMode::Saturation,
        "Color" => BlendMode::Color,
        "Luminosity" => BlendMode::Luminosity,
        _ => BlendMode::Normal,
    }
}

/// A smaller copy of the flattened page, over white, for the Export
/// section's preview — the PSD itself is not something a webview can show.
pub fn preview_png(flattened: &RgbaImage, longest: u32) -> Result<Vec<u8>, String> {
    let (w, h) = flattened.dimensions();
    let ratio = (longest as f64 / w.max(h) as f64).min(1.0);
    let (nw, nh) = (
        ((w as f64 * ratio).round() as u32).max(1),
        ((h as f64 * ratio).round() as u32).max(1),
    );
    let small = image::imageops::resize(flattened, nw, nh, image::imageops::FilterType::Triangle);
    let mut white = image::RgbImage::new(nw, nh);
    for (x, y, px) in small.enumerate_pixels() {
        let a = px[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        white.put_pixel(x, y, image::Rgb([mix(px[0]), mix(px[1]), mix(px[2])]));
    }
    let mut out = std::io::Cursor::new(Vec::new());
    white
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| format!("Cannot write the preview: {e}"))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print_pdf::{PageSize, PrintItem};

    fn sprite(path: &str, matrix: [f64; 6], alpha: f64) -> PrintItem {
        PrintItem::Asset {
            path: path.into(),
            crop: [0.0, 0.0, 10.0, 10.0],
            size: [10.0, 10.0],
            matrix,
            alpha,
            blend: "Multiply".into(),
            tint: None,
        }
    }

    #[test]
    fn one_layer_per_thing_at_the_project_dpi() {
        let read = |_: &str| -> Result<(RgbaImage, bool), String> {
            Ok((
                RgbaImage::from_pixel(25, 25, image::Rgba([200, 0, 0, 255])),
                true,
            ))
        };
        let page = PrintPage {
            page: PageSize {
                width: 72.0,
                height: 36.0,
            },
            background: None,
            items: vec![
                sprite("hut/sprites/roof.png", [6.0, 0.0, 0.0, 6.0, 6.0, 6.0], 1.0),
                sprite("hut/sprites/roof.png", [6.0, 0.0, 0.0, 6.0, 30.0, 6.0], 0.5),
            ],
            skipped: 0,
        };
        let mut report = Report::default();
        let built = build(&page, 300, &read, &mut report).unwrap();
        assert_eq!(built.layers, 2);
        assert_eq!(built.flattened.dimensions(), (300, 150));

        let doc = psd::Psd::from_bytes(&built.bytes).unwrap();
        assert_eq!((doc.width(), doc.height()), (300, 150));
        let names: Vec<&str> = doc.layers().iter().map(|l| l.name()).collect();
        assert!(
            names.contains(&"roof") && names.contains(&"roof 2"),
            "{names:?}"
        );
        // Six points at 300 DPI is 25 pixels, from 6 points in: pixel 25.
        let first = doc.layers().iter().find(|l| l.name() == "roof").unwrap();
        assert_eq!((first.layer_left(), first.layer_top()), (25, 25));
        assert_eq!((first.width(), first.height()), (25, 25));
        let second = doc.layers().iter().find(|l| l.name() == "roof 2").unwrap();
        assert_eq!(second.opacity(), 128);
        // The flattened copy has the first square opaque and the second half.
        assert_eq!(built.flattened.get_pixel(37, 37)[3], 255);
        assert_eq!(built.flattened.get_pixel(137, 37)[3], 128);
        assert!(crate::psd_resolution::stamp(&built.bytes, 300).is_none());
    }

    #[test]
    fn a_turned_sprite_is_redrawn_turned() {
        // A quarter turn: x runs down the page. The image's top-left corner
        // lands at the top-right of the square it covers.
        let mut image = RgbaImage::from_pixel(10, 10, image::Rgba([0, 0, 255, 255]));
        image.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        let (left, top, w, h, px) =
            draw(&image, [0.0, 10.0, -10.0, 0.0, 20.0, 0.0], 40, 40).unwrap();
        assert_eq!((left, top, w, h), (10, 0, 10, 10));
        let i = (9 * 4) as usize; // row 0, last column
        assert!(px[i] > 120 && px[i + 2] < 140, "{:?}", &px[i..i + 4]);
    }
}
