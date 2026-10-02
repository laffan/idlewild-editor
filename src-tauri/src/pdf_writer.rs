//! The objects of a one-page PDF, and the numbers in them.
//!
//! Split from `print_pdf.rs` for the 700-line rule: that file decides what
//! goes on the page, and this is the file format it goes into — a catalog, a
//! page, a content stream, image XObjects with their alpha as soft masks, and
//! ExtGStates for alpha and blend modes, with the cross-reference table that
//! points at each of them.

use flate2::{write::ZlibEncoder, Compression};
use image::RgbaImage;
use std::io::Write;

/// A number as PDF wants one: no exponent, no trailing zeros.
pub fn num(value: f64) -> String {
    let value = if value.is_finite() { value } else { 0.0 };
    let text = format!("{value:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" || text.is_empty() {
        "0".to_string()
    } else {
        text.to_string()
    }
}

fn deflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

/// The objects of a one-page PDF, numbered as they are added.
#[derive(Default)]
pub struct Pdf {
    /// Every object after the four fixed ones, in order: its body.
    objects: Vec<Vec<u8>>,
    images: Vec<(usize, usize)>,
    states: Vec<usize>,
}

/// Catalog, pages, page and contents are 1–4; everything else follows.
const FIRST_FREE: usize = 5;

impl Pdf {
    fn add(&mut self, body: Vec<u8>) -> usize {
        self.objects.push(body);
        FIRST_FREE + self.objects.len() - 1
    }

    fn stream(dict: &str, data: Vec<u8>) -> Vec<u8> {
        let mut out = format!("<< {dict} /Length {} >>\nstream\n", data.len()).into_bytes();
        out.extend_from_slice(&data);
        out.extend_from_slice(b"\nendstream");
        out
    }

    /// An RGB image with its alpha as a soft mask. Returns the image's index.
    pub fn image(&mut self, image: &RgbaImage) -> Result<usize, String> {
        let (w, h) = image.dimensions();
        let raw = image.as_raw();
        let mut rgb = Vec::with_capacity(raw.len() / 4 * 3);
        let mut alpha = Vec::with_capacity(raw.len() / 4);
        let mut opaque = true;
        for px in raw.chunks_exact(4) {
            rgb.extend_from_slice(&px[..3]);
            alpha.push(px[3]);
            opaque &= px[3] == 255;
        }
        let mask = if opaque {
            String::new()
        } else {
            let id = self.add(Self::stream(
                &format!(
                    "/Type /XObject /Subtype /Image /Width {w} /Height {h} \
                     /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode"
                ),
                deflate(&alpha)?,
            ));
            format!(" /SMask {id} 0 R")
        };
        let id = self.add(Self::stream(
            &format!(
                "/Type /XObject /Subtype /Image /Width {w} /Height {h} \
                 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode{mask}"
            ),
            deflate(&rgb)?,
        ));
        self.images.push((self.images.len(), id));
        Ok(self.images.len() - 1)
    }

    /// An ExtGState for an alpha and a blend mode. Returns its index.
    pub fn state(&mut self, alpha: f64, blend: &str) -> usize {
        let id = self.add(
            format!(
                "<< /Type /ExtGState /ca {a} /CA {a} /BM /{blend} >>",
                a = num(alpha)
            )
            .into_bytes(),
        );
        self.states.push(id);
        self.states.len() - 1
    }

    pub fn finish(self, width: f64, height: f64, content: &str) -> Result<Vec<u8>, String> {
        let xobjects: String = self
            .images
            .iter()
            .map(|(index, id)| format!("/Im{index} {id} 0 R "))
            .collect();
        let states: String = self
            .states
            .iter()
            .enumerate()
            .map(|(index, id)| format!("/GS{index} {id} 0 R "))
            .collect();
        let size = format!("[0 0 {} {}]", num(width), num(height));

        let mut bodies: Vec<Vec<u8>> = vec![
            b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox {size} /TrimBox {size} \
                 /Resources << /XObject << {xobjects}>> /ExtGState << {states}>> >> \
                 /Contents 4 0 R >>"
            )
            .into_bytes(),
            Self::stream("/Filter /FlateDecode", deflate(content.as_bytes())?),
        ];
        bodies.extend(self.objects);
        bodies.push(b"<< /Producer (Idlewild) /Creator (Idlewild ExportForPrint) >>".to_vec());
        let info = bodies.len();

        let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = Vec::with_capacity(bodies.len());
        for (i, body) in bodies.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref = out.len();
        out.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", bodies.len() + 1).as_bytes(),
        );
        for offset in offsets {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                bodies.len() + 1
            )
            .as_bytes(),
        );
        Ok(out)
    }
}
