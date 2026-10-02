//! The page `ExportForPrint()` read off a running print project, as a PDF.
//!
//! The game sends what it had on screen — see `templates/print/js/shared/
//! print.js` — as a list of things to draw, back to front:
//!
//! - an **asset**: a sprite cut from a file in `assets/`, the part of that file
//!   it shows, and the matrix that puts that part on the page. Drawn here from
//!   the full-resolution twin of the same file under `print/`, so the page is
//!   at the project's DPI however small the copy the game was moving about;
//! - a **raster**: pixels the game rendered itself at print resolution, for
//!   whatever it drew with no file behind it.
//!
//! Each becomes an image XObject placed with one `cm`, so the PDF is exactly
//! the scene's geometry — rotation, scale and flip included — with no
//! resampling in between. Alpha and blend modes are an ExtGState each.
//!
//! The writer is a small one rather than a crate: one page, images and a
//! content stream is all a print here ever is, and the format for that is a
//! dozen objects and a cross-reference table.

use crate::pdf_writer::{num, Pdf};
use crate::store;
use image::{imageops::FilterType, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::rc::Rc;

/// Where the last PDF a project printed is written, inside the project.
pub const PDF_REL: &str = "print-out/page.pdf";

/// The page, as `ExportForPrint()` sends it.
#[derive(Debug, Clone, Deserialize)]
pub struct PrintPage {
    pub page: PageSize,
    /// The camera's background, `[r, g, b, a]` with 0–255 channels and a 0–1
    /// alpha — what is behind everything. White, or none, is the paper.
    #[serde(default)]
    pub background: Option<[f64; 4]>,
    #[serde(default)]
    pub items: Vec<PrintItem>,
    #[serde(default)]
    pub skipped: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PageSize {
    pub width: f64,
    pub height: f64,
}

/// One thing on the page. The matrix maps the image's own unit square — top
/// left 0,0, bottom right 1,1 — onto the page in points, y downwards.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrintItem {
    Asset {
        /// The file's path under `assets/`, and so under `print/`.
        path: String,
        /// The part of the screen copy the sprite shows: x, y, width, height.
        crop: [f64; 4],
        /// The screen copy's own size, which the full file is measured against.
        size: [f64; 2],
        matrix: [f64; 6],
        #[serde(default = "one")]
        alpha: f64,
        #[serde(default)]
        blend: String,
        #[serde(default)]
        tint: Option<u32>,
    },
    Raster {
        /// A PNG, as a data URL.
        data: String,
        matrix: [f64; 6],
        #[serde(default = "one")]
        alpha: f64,
        #[serde(default)]
        blend: String,
    },
}

fn one() -> f64 {
    1.0
}

/// What the editor is told about the PDF it asked for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintResult {
    /// The PDF's path inside the project, for the asset server to serve.
    pub path: String,
    pub bytes: usize,
    pub width: f64,
    pub height: f64,
    pub dpi: u32,
    /// How many things were drawn.
    pub drawn: usize,
    /// Sprites with no full-resolution twin, drawn from the screen copy.
    pub screen_only: Vec<String>,
    /// Things the game could not read, and things this could not draw.
    pub skipped: u32,
    /// A PNG of the page inside the project, where the file itself is not
    /// something a webview can show — a PSD's. None for a PDF.
    pub preview: Option<String>,
}

/// Write the PDF for a page a print project sent, and say what is in it.
#[tauri::command(async)]
pub fn export_print_pdf(id: String, page: PrintPage) -> Result<PrintResult, String> {
    let meta = store::read_meta(&id)?;
    if !meta.output.is_print() {
        return Err("Only a print project prints".into());
    }
    let dpi = meta.output.dpi();
    let read = project_reader(&id)?;
    let (bytes, report) = build(&page, dpi, &read)?;
    let dest = store::project_dir(&id)?.join(PDF_REL);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("Cannot write the PDF: {e}"))?;

    Ok(PrintResult {
        path: PDF_REL.to_string(),
        bytes: bytes.len(),
        width: page.page.width,
        height: page.page.height,
        dpi,
        drawn: report.drawn,
        screen_only: report.screen_only,
        skipped: page.skipped + report.skipped,
        preview: None,
    })
}

/// The best file there is for a sprite's path, in a project: its
/// full-resolution twin under `print/`, or the screen copy under `assets/`
/// when there is none — and which of the two it was.
pub(crate) fn project_reader(
    id: &str,
) -> Result<impl Fn(&str) -> Result<(RgbaImage, bool), String>, String> {
    let print_root = store::print_dir(id)?;
    let assets_root = store::assets_dir(id)?;
    Ok(move |path: &str| -> Result<(RgbaImage, bool), String> {
        let rel = store::safe_relative(path)?;
        let full = print_root.join(&rel);
        let (file, full_res) = if full.exists() {
            (full, true)
        } else {
            (assets_root.join(&rel), false)
        };
        let image = image::open(&file)
            .map_err(|e| format!("Cannot read {path}: {e}"))?
            .to_rgba8();
        Ok((image, full_res))
    })
}

/// Copy the last PDF or PSD a project printed to where the save dialog said.
#[tauri::command]
pub fn save_print_file(id: String, format: String, path: String) -> Result<(), String> {
    let rel = match format.as_str() {
        "pdf" => PDF_REL,
        "psd" => crate::print_psd::PSD_REL,
        other => return Err(format!("Not a print format: {other}")),
    };
    let from = store::project_dir(&id)?.join(rel);
    let dest = crate::psd_write::source_path(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, &dest)
        .map(|_| ())
        .map_err(|e| format!("Cannot save the {}: {e}", format.to_uppercase()))
}

#[derive(Default)]
pub struct Report {
    pub drawn: usize,
    pub screen_only: Vec<String>,
    pub skipped: u32,
}

/// The PDF's bytes. `read` answers a sprite's path with the best file there
/// is for it, and whether that was the full-resolution one.
pub fn build(
    page: &PrintPage,
    dpi: u32,
    read: &dyn Fn(&str) -> Result<(RgbaImage, bool), String>,
) -> Result<(Vec<u8>, Report), String> {
    let width = page.page.width.max(1.0);
    let height = page.page.height.max(1.0);
    let mut pdf = Pdf::default();
    let mut report = Report::default();
    let mut content = String::new();

    if let Some([r, g, b, a]) = page.background {
        let white = r >= 254.0 && g >= 254.0 && b >= 254.0;
        if a > 0.0 && !white {
            content.push_str(&format!(
                "{} {} {} rg 0 0 {} {} re f\n",
                num(r / 255.0),
                num(g / 255.0),
                num(b / 255.0),
                num(width),
                num(height)
            ));
        }
    }

    let mut images: HashMap<String, usize> = HashMap::new();
    let mut states: HashMap<String, usize> = HashMap::new();

    for item in prepare(page, dpi, read, &mut report) {
        let image_id = match images.get(&item.key) {
            Some(id) if !item.key.is_empty() => *id,
            _ => {
                let id = pdf.image(&item.image)?;
                if !item.key.is_empty() {
                    images.insert(item.key.clone(), id);
                }
                id
            }
        };
        let state_key = format!("{}|{}", num(item.alpha), item.blend);
        let state = *states
            .entry(state_key)
            .or_insert_with(|| pdf.state(item.alpha, item.blend));

        let [a, b, c, d, e, f] = item.matrix;
        // Page space is y-down from the top; PDF's is y-up from the bottom,
        // and an image's unit square has its first row at the top. Both flips
        // folded into the one matrix — see the module comment.
        content.push_str(&format!(
            "q /GS{state} gs {} {} {} {} {} {} cm /Im{image_id} Do Q\n",
            num(a),
            num(-b),
            num(-c),
            num(d),
            num(c + e),
            num(height - d - f)
        ));
        report.drawn += 1;
    }

    let bytes = pdf.finish(width, height, &content)?;
    Ok((bytes, report))
}

/// One thing on the page, ready to draw: its pixels — cut from the best file
/// there is, tinted, trimmed of clear margins and shrunk to the DPI it is drawn
/// at — and where they go. What the PDF and the PSD are both written from.
pub struct Prepared {
    pub image: Rc<RgbaImage>,
    /// The same part of the same file at the same drawn size has the same key,
    /// and the same pixels; empty for a raster, which is never shared.
    pub key: String,
    /// The image's unit square onto the page, in points, y down.
    pub matrix: [f64; 6],
    pub alpha: f64,
    /// PDF's name for the blend mode — see `blend_name`.
    pub blend: &'static str,
    /// What to call it, as a layer: the file's name, or "Drawn".
    pub name: String,
}

/// Every item on the page, prepared, back to front. Items that cannot be read
/// are counted in `report.skipped`; sprites drawn from the screen copy are
/// named in `report.screen_only`.
pub fn prepare(
    page: &PrintPage,
    dpi: u32,
    read: &dyn Fn(&str) -> Result<(RgbaImage, bool), String>,
    report: &mut Report,
) -> Vec<Prepared> {
    let mut sources: HashMap<String, (RgbaImage, bool)> = HashMap::new();
    // A prepared image and the part of the cut it kept, by key: five hundred
    // copies of one sprite are cut, trimmed and shrunk once.
    let mut done: HashMap<String, (Rc<RgbaImage>, [f64; 4])> = HashMap::new();
    let mut out = Vec::new();

    for item in &page.items {
        let (key, matrix, alpha, blend, name) = match item {
            PrintItem::Asset {
                path,
                crop,
                size,
                matrix,
                alpha,
                blend,
                tint,
            } => {
                // Position is not in the key; the size is, because a copy
                // drawn small is shrunk to the DPI it needs.
                let key = format!(
                    "{path}|{crop:?}|{tint:?}|{}|{}",
                    (matrix[0].hypot(matrix[1]) * 4.0).round(),
                    (matrix[2].hypot(matrix[3]) * 4.0).round()
                );
                if !done.contains_key(&key) {
                    if !sources.contains_key(path) {
                        match read(path) {
                            Ok(found) => {
                                sources.insert(path.clone(), found);
                            }
                            Err(_) => {
                                report.skipped += 1;
                                continue;
                            }
                        }
                    }
                    let (source, full_res) = &sources[path];
                    if !full_res && !report.screen_only.contains(path) {
                        report.screen_only.push(path.clone());
                    }
                    let Some(cut) = cut(source, *crop, *size, *tint) else {
                        report.skipped += 1;
                        continue;
                    };
                    // Clear margins cost bytes and say nothing.
                    let Some((pixels, kept)) = trim(cut) else {
                        continue;
                    };
                    let shown = within(*matrix, kept);
                    // A sprite drawn far smaller than its pixels needs only the
                    // project's DPI worth of them.
                    let pixels = fit_to_dpi(pixels, &shown, dpi);
                    done.insert(key.clone(), (Rc::new(pixels), kept));
                }
                let stem = path
                    .rsplit('/')
                    .next()
                    .unwrap_or(path)
                    .trim_end_matches(".png")
                    .to_string();
                (key, *matrix, *alpha, blend.as_str(), stem)
            }
            PrintItem::Raster {
                data,
                matrix,
                alpha,
                blend,
            } => {
                let Some(image) = decode_data_url(data) else {
                    report.skipped += 1;
                    continue;
                };
                let Some((pixels, kept)) = trim(image) else {
                    continue;
                };
                let shown = within(*matrix, kept);
                let pixels = fit_to_dpi(pixels, &shown, dpi);
                out.push(Prepared {
                    image: Rc::new(pixels),
                    key: String::new(),
                    matrix: shown,
                    alpha: alpha.clamp(0.0, 1.0),
                    blend: blend_name(blend),
                    name: "Drawn".to_string(),
                });
                continue;
            }
        };
        let (image, kept) = &done[&key];
        out.push(Prepared {
            image: image.clone(),
            key,
            matrix: within(matrix, *kept),
            alpha: alpha.clamp(0.0, 1.0),
            blend: blend_name(blend),
            name,
        });
    }
    out
}

/// The matrix for the part of an image a trim kept, given as a fraction of it.
fn within(m: [f64; 6], kept: [f64; 4]) -> [f64; 6] {
    let [fx, fy, sx, sy] = kept;
    let [a, b, c, d, e, f] = m;
    [
        a * sx,
        b * sx,
        c * sy,
        d * sy,
        a * fx + c * fy + e,
        b * fx + d * fy + f,
    ]
}

/// The part of a sprite's file the sprite shows, at the file's resolution.
fn cut(source: &RgbaImage, crop: [f64; 4], size: [f64; 2], tint: Option<u32>) -> Option<RgbaImage> {
    let rx = source.width() as f64 / size[0].max(1.0);
    let ry = source.height() as f64 / size[1].max(1.0);
    let x0 = (crop[0] * rx).round().max(0.0) as u32;
    let y0 = (crop[1] * ry).round().max(0.0) as u32;
    let x1 = ((crop[0] + crop[2]) * rx)
        .round()
        .min(source.width() as f64) as u32;
    let y1 = ((crop[1] + crop[3]) * ry)
        .round()
        .min(source.height() as f64) as u32;
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let mut out = image::imageops::crop_imm(source, x0, y0, x1 - x0, y1 - y0).to_image();
    if let Some(tint) = tint {
        let mul = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
        for px in out.pixels_mut() {
            for i in 0..3 {
                px[i] = ((px[i] as u32 * mul[i] + 127) / 255) as u8;
            }
        }
    }
    Some(out)
}

/// Crop to what is not fully clear. Returns the crop and the part kept, as
/// `[left, top, width, height]` fractions of the whole. None when nothing is.
fn trim(image: RgbaImage) -> Option<(RgbaImage, [f64; 4])> {
    let (w, h) = image.dimensions();
    let (mut l, mut t, mut r, mut b) = (w, h, 0u32, 0u32);
    for (x, y, px) in image.enumerate_pixels() {
        if px[3] > 0 {
            l = l.min(x);
            t = t.min(y);
            r = r.max(x + 1);
            b = b.max(y + 1);
        }
    }
    if r <= l || b <= t {
        return None;
    }
    if (l, t, r, b) == (0, 0, w, h) {
        return Some((image, [0.0, 0.0, 1.0, 1.0]));
    }
    let kept = [
        l as f64 / w as f64,
        t as f64 / h as f64,
        (r - l) as f64 / w as f64,
        (b - t) as f64 / h as f64,
    ];
    let cropped = image::imageops::crop_imm(&image, l, t, r - l, b - t).to_image();
    Some((cropped, kept))
}

/// Shrink an image drawn at well over the project's DPI down to it.
fn fit_to_dpi(image: RgbaImage, m: &[f64; 6], dpi: u32) -> RgbaImage {
    let per_point = dpi as f64 / 72.0;
    let want_w = (m[0].hypot(m[1]) * per_point).ceil();
    let want_h = (m[2].hypot(m[3]) * per_point).ceil();
    let (w, h) = image.dimensions();
    if want_w < 1.0 || want_h < 1.0 {
        return image;
    }
    if (w as f64) <= want_w * 1.5 && (h as f64) <= want_h * 1.5 {
        return image;
    }
    let nw = (want_w as u32).clamp(1, w);
    let nh = (want_h as u32).clamp(1, h);
    image::imageops::resize(&image, nw, nh, FilterType::CatmullRom)
}

pub(crate) fn decode_data_url(data: &str) -> Option<RgbaImage> {
    use base64::Engine;
    let payload = data.split_once(',').map(|(_, rest)| rest).unwrap_or(data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .ok()?;
    Some(image::load_from_memory(&bytes).ok()?.to_rgba8())
}

/// PDF's name for a blend mode, from what `print.js` sends.
pub fn blend_name(raw: &str) -> &'static str {
    const NAMES: [&str; 16] = [
        "Normal",
        "Multiply",
        "Screen",
        "Overlay",
        "Darken",
        "Lighten",
        "ColorDodge",
        "ColorBurn",
        "HardLight",
        "SoftLight",
        "Difference",
        "Exclusion",
        "Hue",
        "Saturation",
        "Color",
        "Luminosity",
    ];
    NAMES
        .iter()
        .find(|n| **n == raw)
        .copied()
        .unwrap_or("Normal")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Where `needle` first appears in `bytes` at or after `from`. Bytes
    /// rather than a string, because the image streams are binary.
    fn find(bytes: &[u8], needle: &str, from: usize) -> Option<usize> {
        bytes[from..]
            .windows(needle.len())
            .position(|w| w == needle.as_bytes())
            .map(|at| at + from)
    }

    /// The page's content stream, inflated.
    fn content(bytes: &[u8]) -> String {
        use std::io::Read;
        let obj = find(bytes, "4 0 obj", 0).unwrap();
        let start = find(bytes, "stream\n", obj).unwrap() + 7;
        let end = find(bytes, "\nendstream", start).unwrap();
        let mut out = String::new();
        flate2::read::ZlibDecoder::new(&bytes[start..end])
            .read_to_string(&mut out)
            .unwrap();
        out
    }

    fn page(items: Vec<PrintItem>) -> PrintPage {
        PrintPage {
            page: PageSize {
                width: 612.0,
                height: 792.0,
            },
            background: None,
            items,
            skipped: 0,
        }
    }

    fn sprite(path: &str, matrix: [f64; 6]) -> PrintItem {
        PrintItem::Asset {
            path: path.into(),
            crop: [0.0, 0.0, 10.0, 10.0],
            size: [10.0, 10.0],
            matrix,
            alpha: 1.0,
            blend: "Normal".into(),
            tint: None,
        }
    }

    #[test]
    fn draws_the_full_resolution_twin_where_the_sprite_stood() {
        // The screen copy is 10 px; the print file is 42 — what 300 DPI makes
        // of a sprite the screen holds at two pixels to the point.
        let read = |path: &str| -> Result<(RgbaImage, bool), String> {
            match path {
                "hut/sprites/roof.png" => Ok((
                    RgbaImage::from_pixel(42, 42, image::Rgba([200, 0, 0, 255])),
                    true,
                )),
                "hut/sprites/door.png" => Ok((
                    RgbaImage::from_pixel(10, 10, image::Rgba([0, 0, 200, 255])),
                    false,
                )),
                _ => Err("missing".into()),
            }
        };
        let (bytes, report) = build(
            &page(vec![
                sprite("hut/sprites/roof.png", [10.0, 0.0, 0.0, 10.0, 100.0, 50.0]),
                sprite("hut/sprites/door.png", [10.0, 0.0, 0.0, 10.0, 0.0, 0.0]),
                sprite("hut/sprites/gone.png", [10.0, 0.0, 0.0, 10.0, 0.0, 0.0]),
            ]),
            300,
            &read,
        )
        .unwrap();
        let text = String::from_utf8_lossy(&bytes);
        let drawn = content(&bytes);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/MediaBox [0 0 612 792]"));
        assert!(text.contains("/Width 42 /Height 42"));
        // 100, 50 from the top-left, ten points square: the bottom of it is
        // 792 - 10 - 50 up from the bottom of the page.
        assert!(drawn.contains("10 0 0 10 100 732 cm"), "{drawn}");
        assert_eq!(report.drawn, 2);
        assert_eq!(report.screen_only, vec!["hut/sprites/door.png".to_string()]);
        assert_eq!(report.skipped, 1);
        assert!(text.trim_end().ends_with("%%EOF"));
    }

    #[test]
    fn the_cross_reference_table_points_at_every_object() {
        let read = |_: &str| -> Result<(RgbaImage, bool), String> {
            Ok((
                RgbaImage::from_pixel(4, 4, image::Rgba([1, 2, 3, 128])),
                true,
            ))
        };
        let (bytes, _) = build(
            &page(vec![sprite(
                "a/sprites/b.png",
                [10.0, 0.0, 0.0, 10.0, 0.0, 0.0],
            )]),
            300,
            &read,
        )
        .unwrap();
        // The table's own keyword, not the one inside `startxref`.
        let xref = find(&bytes, "\nxref\n", 0).unwrap() + 1;
        let tail = String::from_utf8_lossy(&bytes[xref..]).to_string();
        let start: usize = tail[tail.find("startxref\n").unwrap() + 10..]
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(start, xref);
        for (n, line) in tail
            .lines()
            .skip(3)
            .take_while(|l| l.ends_with(" n "))
            .enumerate()
        {
            let offset: usize = line[..10].parse().unwrap();
            assert_eq!(
                find(&bytes, &format!("{} 0 obj", n + 1), offset),
                Some(offset)
            );
        }
        let text = String::from_utf8_lossy(&bytes);
        // Half-transparent pixels carry a soft mask.
        assert!(text.contains("/SMask"));
    }

    #[test]
    fn a_small_copy_is_shrunk_to_the_dpi_it_needs() {
        let read = |_: &str| -> Result<(RgbaImage, bool), String> {
            Ok((
                RgbaImage::from_pixel(42, 42, image::Rgba([9, 9, 9, 255])),
                true,
            ))
        };
        // Five points at 300 DPI is twenty-one pixels, not forty-two.
        let (bytes, _) = build(
            &page(vec![sprite(
                "a/sprites/b.png",
                [5.0, 0.0, 0.0, 5.0, 0.0, 0.0],
            )]),
            300,
            &read,
        )
        .unwrap();
        let text: String = bytes.iter().map(|&b| b as char).collect();
        assert!(text.contains("/Width 21 /Height 21"));
    }

    #[test]
    fn numbers_never_use_an_exponent() {
        assert_eq!(num(0.00001), "0");
        assert_eq!(num(1e7), "10000000");
        assert_eq!(num(-0.0), "0");
        assert_eq!(num(2.5), "2.5");
    }
}
