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
    Paper {
        id: "letter",
        width: 612,
        height: 792,
    },
    Paper {
        id: "legal",
        width: 612,
        height: 1008,
    },
    Paper {
        id: "tabloid",
        width: 792,
        height: 1224,
    },
    Paper {
        id: "a5",
        width: 420,
        height: 595,
    },
    Paper {
        id: "a4",
        width: 595,
        height: 842,
    },
    Paper {
        id: "a3",
        width: 842,
        height: 1191,
    },
    Paper {
        id: "a2",
        width: 1191,
        height: 1684,
    },
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
    /// What a page is written as when the code does not say: `pdf`, `psd`,
    /// `png` or `jpg`. The PDF is the page as it prints; the PSD is the same page as
    /// layers at the project's DPI, to carry on with by hand; the PNG is the
    /// page as one picture at that DPI — with transparency, or as a JPG on
    /// white. See `print_pdf.rs`, `print_psd.rs` and `print_png.rs`.
    #[serde(default = "default_formats")]
    pub formats: String,
    /// A `custom` sheet's size, in points. Kept while a standard size is
    /// picked, so going back to Custom finds what was typed.
    #[serde(default = "default_custom_width")]
    pub custom_width: f64,
    #[serde(default = "default_custom_height")]
    pub custom_height: f64,
    /// Which unit a custom size is typed and shown in: `in` or `cm`. Only how
    /// it reads — the size itself is always points.
    #[serde(default = "default_unit")]
    pub unit: String,
    /// Where the page's top-left corner is in the world. The origin until the
    /// frame on the canvas is dragged somewhere else.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

impl Default for Output {
    fn default() -> Self {
        Output {
            kind: OutputKind::Code,
            dpi: default_dpi(),
            paper: default_paper(),
            landscape: false,
            formats: default_formats(),
            custom_width: default_custom_width(),
            custom_height: default_custom_height(),
            unit: default_unit(),
            x: 0.0,
            y: 0.0,
        }
    }
}

fn default_formats() -> String {
    "png".to_string()
}

fn default_custom_width() -> f64 {
    612.0
}

fn default_custom_height() -> f64 {
    792.0
}

fn default_unit() -> String {
    "in".to_string()
}

/// The answers `formats` can have.
pub const FORMATS: [&str; 4] = ["pdf", "psd", "png", "jpg"];

/// The paper id for a size somebody typed.
pub const CUSTOM: &str = "custom";

/// The smallest and largest custom sheet, in points: half an inch, and four
/// feet. The ceiling is the PSD's — 48 inches at 600 DPI is 28,800 pixels,
/// under the 30,000 a PSD can hold on a side.
pub const MIN_PAGE: f64 = 36.0;
pub const MAX_PAGE: f64 = 3456.0;

/// How far the page's corner may be dragged from the origin, either way. A
/// page a mile out is a typo, and the config is where it would land.
pub const MAX_ORIGIN: f64 = 1_000_000.0;

/// A change to the sheet, as Page Setup, the frame on the canvas and the
/// preview's bar send one: only what is named changes.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePatch {
    pub paper: Option<String>,
    pub landscape: Option<bool>,
    pub formats: Option<String>,
    pub custom_width: Option<f64>,
    pub custom_height: Option<f64>,
    pub unit: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

impl PagePatch {
    /// Apply it, refusing anything this build does not know.
    pub fn apply(&self, output: &mut Output) -> Result<(), String> {
        if let Some(paper) = &self.paper {
            if paper != CUSTOM && !PAPERS.iter().any(|p| p.id == paper) {
                return Err(format!("Unknown paper size: {paper}"));
            }
            output.paper = paper.clone();
        }
        if let Some(landscape) = self.landscape {
            output.landscape = landscape;
        }
        if let Some(formats) = &self.formats {
            if !FORMATS.contains(&formats.as_str()) {
                return Err(format!("Unknown output: {formats}"));
            }
            output.formats = formats.clone();
        }
        let size = |v: f64| {
            if v.is_finite() {
                Ok(v.clamp(MIN_PAGE, MAX_PAGE))
            } else {
                Err("A page size has to be a number".to_string())
            }
        };
        if let Some(w) = self.custom_width {
            output.custom_width = size(w)?;
        }
        if let Some(h) = self.custom_height {
            output.custom_height = size(h)?;
        }
        if let Some(unit) = &self.unit {
            if unit != "in" && unit != "cm" {
                return Err(format!("Unknown unit: {unit}"));
            }
            output.unit = unit.clone();
        }
        let at = |v: f64| {
            if v.is_finite() {
                Ok(v.clamp(-MAX_ORIGIN, MAX_ORIGIN).round())
            } else {
                Err("A page position has to be a number".to_string())
            }
        };
        if let Some(x) = self.x {
            output.x = at(x)?;
        }
        if let Some(y) = self.y {
            output.y = at(y)?;
        }
        Ok(())
    }
}

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

    /// What a page is written as, falling back to a PNG for anything unknown —
    /// including `both`, which an earlier build offered.
    pub fn formats(&self) -> &'static str {
        FORMATS
            .iter()
            .find(|f| **f == self.formats)
            .copied()
            .unwrap_or("png")
    }

    /// Whether the sheet is a size somebody typed.
    pub fn is_custom(&self) -> bool {
        self.paper == CUSTOM
    }

    /// The standard sheet, falling back to Letter for a name this build does
    /// not know. Meaningless on a custom sheet — see `page_size`.
    pub fn paper(&self) -> &'static Paper {
        PAPERS
            .iter()
            .find(|p| p.id == self.paper)
            .unwrap_or(&PAPERS[0])
    }

    /// The page in points: a standard sheet turned for landscape, or the size
    /// that was typed. A typed size is already the way round it was typed, so
    /// orientation does not turn it.
    pub fn page_size(&self) -> (u32, u32) {
        if self.is_custom() {
            let clamp = |v: f64| {
                let v = if v.is_finite() { v } else { 612.0 };
                v.clamp(MIN_PAGE, MAX_PAGE).round() as u32
            };
            return (clamp(self.custom_width), clamp(self.custom_height));
        }
        let paper = self.paper();
        if self.landscape {
            (paper.height, paper.width)
        } else {
            (paper.width, paper.height)
        }
    }

    /// Where the page's corner is in the world, brought into range.
    pub fn origin(&self) -> (f64, f64) {
        let at = |v: f64| {
            if v.is_finite() {
                v.clamp(-MAX_ORIGIN, MAX_ORIGIN)
            } else {
                0.0
            }
        };
        (at(self.x), at(self.y))
    }

    /// What the generated config tells the project's own code, or null for a
    /// code project.
    pub fn to_config(&self) -> serde_json::Value {
        if !self.is_print() {
            return serde_json::Value::Null;
        }
        let (width, height) = self.page_size();
        let (x, y) = self.origin();
        serde_json::json!({
            "dpi": self.dpi(),
            "paper": if self.is_custom() { CUSTOM } else { self.paper().id },
            "landscape": self.landscape,
            "formats": self.formats(),
            "width": width,
            "height": height,
            "x": x,
            "y": y,
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
    fn a_custom_sheet_is_the_size_typed_and_kept_in_range() {
        let mut out = Output {
            kind: OutputKind::Print,
            ..Output::default()
        };
        PagePatch {
            paper: Some(CUSTOM.into()),
            custom_width: Some(20.0 / 2.54 * 72.0),
            custom_height: Some(9000.0),
            unit: Some("cm".into()),
            landscape: Some(true),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .unwrap();
        // 20 cm is 566.9 points; 9000 is past four feet; landscape is ignored.
        assert_eq!(out.page_size(), (567, 3456));
        assert!(PagePatch {
            paper: Some("napkin".into()),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .is_err());
        assert!(PagePatch {
            formats: Some("both".into()),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .is_err());
        PagePatch {
            x: Some(120.4),
            y: Some(-40.6),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .unwrap();
        assert_eq!(out.origin(), (120.0, -41.0));
        assert_eq!(out.to_config()["x"], 120.0);
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
