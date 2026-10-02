//! The page `ExportForPrint()` read, as one PNG at the project's DPI.
//!
//! The third format beside the PDF and the PSD: the page flattened into a
//! single picture — every sprite at its full-resolution twin, everything else
//! as the game rendered it — composited by the same code the PSD's flattened
//! copy is (`print_psd::flatten`). Transparent where nothing was drawn, so a
//! page laid on a coloured ground keeps it and a page on the paper is clear.
//!
//! **The file says its resolution.** A PNG carries pixels per metre in its
//! `pHYs` chunk, and the `image` crate's encoder does not write one, so it is
//! spliced in after the header: without it every viewer opens a 300 DPI page
//! at a seventy-second of an inch to the pixel, four times the size of the
//! paper.

use crate::print_pdf::{project_reader, PrintPage, PrintResult, Report};
use crate::store;

/// Write the PNG for a page a print project sent.
#[tauri::command(async)]
pub fn export_print_png(id: String, page: PrintPage) -> Result<PrintResult, String> {
    let meta = store::read_meta(&id)?;
    if !meta.output.is_print() {
        return Err("Only a print project prints".into());
    }
    let dpi = meta.output.dpi();
    let read = project_reader(&id)?;
    let mut report = Report::default();
    let flat = crate::print_psd::flatten(&page, dpi, &read, &mut report);
    let bytes = encode(&flat, dpi)?;
    let (rel, dest) = crate::print_files::export_path(&id, page.out.as_deref(), "png")?;
    std::fs::write(&dest, &bytes).map_err(|e| format!("Cannot write the PNG: {e}"))?;
    Ok(PrintResult {
        path: rel.clone(),
        bytes: bytes.len(),
        width: page.page.width,
        height: page.page.height,
        dpi,
        drawn: report.drawn,
        screen_only: report.screen_only,
        skipped: page.skipped + report.skipped,
        // The file is its own preview: a webview shows a PNG as it is.
        preview: Some(rel),
    })
}

/// A PNG of the image, with its resolution written in.
pub fn encode(image: &image::RgbaImage, dpi: u32) -> Result<Vec<u8>, String> {
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| format!("Cannot write the PNG: {e}"))?;
    Ok(with_resolution(out.into_inner(), dpi))
}

/// The PNG with a `pHYs` chunk after its `IHDR`: pixels per metre on both
/// axes, unit metre. A file that is not shaped like a PNG comes back as it was.
pub fn with_resolution(png: Vec<u8>, dpi: u32) -> Vec<u8> {
    // Signature (8) + IHDR length, type, 13 bytes of data, CRC.
    let header_end = 8 + 4 + 4 + 13 + 4;
    if png.len() < header_end || &png[12..16] != b"IHDR" {
        return png;
    }
    let per_metre = ((dpi as f64) / 0.0254).round() as u32;
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&per_metre.to_be_bytes());
    data.extend_from_slice(&per_metre.to_be_bytes());
    data.push(1);

    let mut chunk = Vec::with_capacity(21);
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut crc = flate2::Crc::new();
    crc.update(b"pHYs");
    crc.update(&data);
    chunk.extend_from_slice(b"pHYs");
    chunk.extend_from_slice(&data);
    chunk.extend_from_slice(&crc.sum().to_be_bytes());

    let mut out = Vec::with_capacity(png.len() + chunk.len());
    out.extend_from_slice(&png[..header_end]);
    out.extend_from_slice(&chunk);
    out.extend_from_slice(&png[header_end..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_says_its_dpi_and_still_decodes() {
        let image = image::RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255]));
        let bytes = encode(&image, 300).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (3, 2));
        let at = bytes.windows(4).position(|w| w == b"pHYs").unwrap();
        let per_metre = u32::from_be_bytes(bytes[at + 4..at + 8].try_into().unwrap());
        assert_eq!(per_metre, 11811);
        assert_eq!(bytes[at + 12], 1);
    }
}
