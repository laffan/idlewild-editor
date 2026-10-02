//! What a project is *for*: a game played in a browser, or a page printed.
//!
//! New Project's last question. **Code** is everything this editor has always
//! been — a Phaser project, played and published. **Print** is the same canvas,
//! the same tools and the same code, pointed at a sheet of paper instead: the
//! page is a fixed rectangle of world, one world pixel is one PostScript point,
//! and what the project's own code has on screen when it calls
//! `ExportForPrint()` is written out as a PDF at the resolution chosen here.
//!
//! ## Two resolutions, and which one each part of the app sees
//!
//! A print project's PSDs are written at its DPI — 300 or 600 pixels to the
//! inch, which is `dpi / 72` pixels to the world pixel. A letter page at 600
//! DPI is 5100 × 6600 pixels, and every sprite cut from it is that dense. That
//! is the right size for paper and the wrong size for everything else: the
//! canvas, the running game and the project's own code would all be moving
//! textures sixteen times the size they need.
//!
//! So psd-to-json runs **twice** over every file. Once over the PSD as it is,
//! into `print/<key>/` — what the PDF is built from and nothing else reads —
//! and once over a copy downsampled to the resolution every *code* project's
//! files already have, into `assets/<key>/`. Two pixels to the world pixel is
//! the editor's standard (see `IMPORT_SCALE` on the frontend): everything the
//! editor draws lands at half size against it, so a downsampled file behaves
//! exactly as an ordinary one does and nothing downstream had to learn that
//! print exists. The two trees are made from the same layers with the same
//! names, so every sprite in `assets/` has its full-resolution twin at the same
//! path under `print/`, and that path is the whole of how the PDF finds it.
//!
//! ## What can change afterwards
//!
//! The kind and the DPI cannot. Every PSD in the project was written at that
//! DPI, and a file made at 300 does not have 600's worth of pixels to give.
//! The paper and its orientation can — they decide where the page falls on the
//! canvas, not how anything was drawn — and Page Setup is where they live.

use serde::{Deserialize, Serialize};

/// Code or print. See the module comment.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputKind {
    /// A game: played, published, exported as a site.
    #[default]
    Code,
    /// A page: exported as a PDF at the project's DPI.
    Print,
}

/// The resolution every processed asset is stored at, in pixels per world
/// pixel. The frontend places every import at half size against it — see
/// `IMPORT_SCALE` there — so a downsampled file has to land on this.
pub const SCREEN_SCALE: f64 = 2.0;

/// A sheet of paper, by name, in points.
pub struct Paper {
    pub id: &'static str,
    pub width: u32,
    pub height: u32,
}

/// The standard sizes, portrait. Mirrored by `PAPERS` in `src/lib/print.ts`.
pub const PAPERS: [Paper; 7] = [
    Paper { id: "letter", width: 612, height: 792 },
    Paper { id: "legal", width: 612, height: 1008 },
    Paper { id: "tabloid", width: 792, height: 1224 },
    Paper { id: "a5", width: 420, height: 595 },
    Paper { id: "a4", width: 595, height: 842 },
    Paper { id: "a3", width: 842, height: 1191 },
    Paper { id: "a2", width: 1191, height: 1684 },
];

/// What a project is for, and — for a print project — the sheet and the
/// resolution.
///
/// Flat and every field defaulting, the way `PublishTarget` is: a `meta.json`
/// written before this existed reads as a code project, which is what it is,
/// and a code project carries a DPI and a paper nobody reads rather than an
/// enum with payloads that would make a later switch lose what was typed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    #[serde(default)]
    pub kind: OutputKind,
    #[serde(default = "default_dpi")]
    pub dpi: u32,
    #[serde(default = "default_paper")]
    pub paper: String,
    #[serde(default)]
    pub landscape: bool,
    /// What Export writes: `pdf`, `psd`, or `both`. The PDF is the page as it
    /// prints; the PSD is the same page as layers at the project's DPI, to
    /// carry on with by hand — see `print_psd.rs`.
    #[serde(default = "default_formats")]
    pub formats: String,
}

impl Default for Output {
    fn default() -> Self {
        Output {
            kind: OutputKind::Code,
            dpi: default_dpi(),
            paper: default_paper(),
            landscape: false,
            formats: default_formats(),
        }
    }
}

fn default_formats() -> String {
    "pdf".to_string()
}

/// The answers `formats` can have.
pub const FORMATS: [&str; 3] = ["pdf", "psd", "both"];

fn default_dpi() -> u32 {
    300
}

fn default_paper() -> String {
    "letter".to_string()
}

impl Output {
    pub fn is_print(&self) -> bool {
        self.kind == OutputKind::Print
    }

    /// The DPI, brought onto one of the two this app writes.
    pub fn dpi(&self) -> u32 {
        if self.dpi >= 450 {
            600
        } else {
            300
        }
    }

    /// Pixels in a print project's PSD per world pixel — `dpi / 72`.
    pub fn source_scale(&self) -> f64 {
        self.dpi() as f64 / 72.0
    }

    /// How far a PSD is shrunk on its way into `assets/`, or None for a
    /// project whose files are already at screen resolution.
    pub fn downsample(&self) -> Option<f64> {
        self.is_print().then(|| self.source_scale() / SCREEN_SCALE)
    }

    /// What Export writes, falling back to a PDF for anything unknown.
    pub fn formats(&self) -> &'static str {
        FORMATS
            .iter()
            .find(|f| **f == self.formats)
            .copied()
            .unwrap_or("pdf")
    }

    /// The sheet, falling back to Letter for a name this build does not know.
    pub fn paper(&self) -> &'static Paper {
        PAPERS
            .iter()
            .find(|p| p.id == self.paper)
            .unwrap_or(&PAPERS[0])
    }

    /// The page in points, turned for landscape.
    pub fn page_size(&self) -> (u32, u32) {
        let paper = self.paper();
        if self.landscape {
            (paper.height, paper.width)
        } else {
            (paper.width, paper.height)
        }
    }

    /// What the generated config tells the project's own code, or null for a
    /// code project.
    pub fn to_config(&self) -> serde_json::Value {
        if !self.is_print() {
            return serde_json::Value::Null;
        }
        let (width, height) = self.page_size();
        serde_json::json!({
            "dpi": self.dpi(),
            "paper": self.paper().id,
            "landscape": self.landscape,
            "formats": self.formats(),
            "width": width,
            "height": height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_meta_without_one_is_a_code_project() {
        let out: Output = serde_json::from_str("{}").unwrap();
        assert!(!out.is_print());
        assert_eq!(out.downsample(), None);
    }

    #[test]
    fn the_downsample_lands_on_screen_resolution() {
        let out = Output {
            kind: OutputKind::Print,
            dpi: 600,
            ..Output::default()
        };
        let factor = out.downsample().unwrap();
        assert!((out.source_scale() / factor - SCREEN_SCALE).abs() < 1e-9);
        assert!((factor - 600.0 / 144.0).abs() < 1e-9);
    }

    #[test]
    fn landscape_turns_the_sheet() {
        let out = Output {
            kind: OutputKind::Print,
            paper: "a4".into(),
            landscape: true,
            ..Output::default()
        };
        assert_eq!(out.page_size(), (842, 595));
        let unknown = Output {
            paper: "napkin".into(),
            ..Output::default()
        };
        assert_eq!(unknown.page_size(), (612, 792));
    }
}
