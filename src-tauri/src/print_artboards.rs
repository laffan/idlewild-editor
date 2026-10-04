//! A print project's artboards: the sheets laid out on its canvas.
//!
//! A print project used to have one page — the sheet it was made with, a
//! rectangle of world from its corner at `output.x, output.y`. It can have
//! several now, the way a drawing app's artboards are several frames on one
//! canvas, and `ExportForPrint()` captures every one of them in a single call,
//! each saved as `<name>-<artboard>`.
//!
//! **The first artboard is still the page.** Its paper, size and corner are
//! mirrored into `Output`'s own flat fields every time the list changes, so
//! everything that read the one page before — the game's fixed box
//! (`game_config::presentation_of`), the camera's corner in `canvas.js`, the
//! New Project sheet, a `.idlewild` written by an earlier build — reads the
//! first artboard and is right. A `meta.json` with no list reads as one
//! artboard made from those fields (`Output::boards`), which is what it was.

use serde::{Deserialize, Serialize};

use crate::print::{Output, PagePatch, CUSTOM, MAX_ORIGIN, MAX_PAGE, MIN_PAGE, PAPERS};

/// The id the artboard made from a project's flat fields goes by.
pub const FIRST_ID: &str = "main";

/// The longest name an artboard may have — it ends up in file names.
const MAX_NAME: usize = 60;

/// One sheet on the canvas. Flat and defaulting, like `Output`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artboard {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_paper")]
    pub paper: String,
    #[serde(default)]
    pub landscape: bool,
    #[serde(default = "default_custom_width")]
    pub custom_width: f64,
    #[serde(default = "default_custom_height")]
    pub custom_height: f64,
    #[serde(default = "default_unit")]
    pub unit: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

fn default_paper() -> String {
    "letter".into()
}
fn default_custom_width() -> f64 {
    612.0
}
fn default_custom_height() -> f64 {
    792.0
}
fn default_unit() -> String {
    "in".into()
}

impl Artboard {
    /// The sheet in points: a standard one turned for landscape, or the size
    /// that was typed.
    pub fn page_size(&self) -> (u32, u32) {
        if self.paper == CUSTOM {
            let clamp = |v: f64| {
                let v = if v.is_finite() { v } else { 612.0 };
                v.clamp(MIN_PAGE, MAX_PAGE).round() as u32
            };
            return (clamp(self.custom_width), clamp(self.custom_height));
        }
        let paper = PAPERS
            .iter()
            .find(|p| p.id == self.paper)
            .unwrap_or(&PAPERS[0]);
        if self.landscape {
            (paper.height, paper.width)
        } else {
            (paper.width, paper.height)
        }
    }

    /// The corner, brought into range.
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

    /// What the generated config tells the project's code about it.
    pub fn to_config(&self) -> serde_json::Value {
        let (width, height) = self.page_size();
        let (x, y) = self.origin();
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "width": width,
            "height": height,
            "x": x,
            "y": y,
        })
    }
}

impl Output {
    /// The artboard the flat fields describe — the first, or the only one a
    /// project made before artboards has.
    pub fn flat_board(&self) -> Artboard {
        Artboard {
            id: FIRST_ID.into(),
            name: "Artboard 1".into(),
            paper: self.paper.clone(),
            landscape: self.landscape,
            custom_width: self.custom_width,
            custom_height: self.custom_height,
            unit: self.unit.clone(),
            x: self.x,
            y: self.y,
        }
    }

    /// Every artboard, first to last. Never empty.
    pub fn boards(&self) -> Vec<Artboard> {
        if self.artboards.is_empty() {
            vec![self.flat_board()]
        } else {
            self.artboards.clone()
        }
    }

    /// Store the list, and mirror its first artboard into the flat fields.
    fn set_boards(&mut self, boards: Vec<Artboard>) {
        if let Some(first) = boards.first() {
            self.paper = first.paper.clone();
            self.landscape = first.landscape;
            self.custom_width = first.custom_width;
            self.custom_height = first.custom_height;
            self.unit = first.unit.clone();
            self.x = first.x;
            self.y = first.y;
        }
        self.artboards = boards;
    }
}

/// A name nobody else in `boards` has, trimmed and cut to length; empty
/// becomes `Artboard N`.
fn unique_name(boards: &[Artboard], skip: Option<usize>, wanted: &str) -> String {
    let trimmed: String = wanted.trim().chars().take(MAX_NAME).collect();
    let base = if trimmed.is_empty() {
        format!("Artboard {}", boards.len() + usize::from(skip.is_none()))
    } else {
        trimmed
    };
    let taken = |name: &str| {
        boards
            .iter()
            .enumerate()
            .any(|(i, b)| Some(i) != skip && b.name.eq_ignore_ascii_case(name))
    };
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base} {n}"))
        .find(|name| !taken(name))
        .unwrap_or(base)
}

/// An id nobody else has.
fn unique_id(boards: &[Artboard]) -> String {
    let free = |id: &str| !boards.iter().any(|b| b.id == id);
    (1..)
        .map(|n| format!("board-{n}"))
        .find(|id| free(id))
        .unwrap_or_default()
}

/// The artboard half of a `PagePatch`: add, remove, or change one.
///
/// The patch's sheet fields — paper, orientation, size, unit, corner — apply
/// to the artboard it names (the first, when it names none); `add` makes a
/// new one first, a copy of that artboard, and applies them to the copy —
/// which goes on the end of the list, with an id of its own.
/// The last artboard cannot be removed.
pub fn apply_boards(patch: &PagePatch, output: &mut Output) -> Result<(), String> {
    let mut boards = output.boards();
    let named = patch.artboard.as_deref();
    let found = named.and_then(|id| boards.iter().position(|b| b.id == id));

    if patch.remove == Some(true) {
        let index = found.ok_or("No such artboard")?;
        if boards.len() <= 1 {
            return Err("A print project needs at least one artboard".into());
        }
        boards.remove(index);
        output.set_boards(boards);
        return Ok(());
    }

    let index = if patch.add == Some(true) {
        let mut board = boards[found.unwrap_or(0)].clone();
        board.id = unique_id(&boards);
        board.name = unique_name(&boards, None, patch.name.as_deref().unwrap_or(""));
        boards.push(board);
        boards.len() - 1
    } else {
        match (named, found) {
            (Some(_), None) => return Err("No such artboard".into()),
            (_, Some(i)) => i,
            (None, None) => 0,
        }
    };

    let board = &mut boards[index];
    if let Some(paper) = &patch.paper {
        board.paper = paper.clone();
    }
    if let Some(landscape) = patch.landscape {
        board.landscape = landscape;
    }
    if let Some(w) = patch.custom_width {
        board.custom_width = w;
    }
    if let Some(h) = patch.custom_height {
        board.custom_height = h;
    }
    if let Some(unit) = &patch.unit {
        board.unit = unit.clone();
    }
    if let Some(x) = patch.x {
        board.x = x;
    }
    if let Some(y) = patch.y {
        board.y = y;
    }
    if patch.add != Some(true) {
        if let Some(name) = &patch.name {
            let name = unique_name(&boards, Some(index), name);
            boards[index].name = name;
        }
    }
    output.set_boards(boards);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print::OutputKind;

    fn print() -> Output {
        Output {
            kind: OutputKind::Print,
            ..Output::default()
        }
    }

    #[test]
    fn a_project_from_before_has_one_artboard_made_of_its_page() {
        let mut out = print();
        out.paper = "a4".into();
        out.x = 40.0;
        let boards = out.boards();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].id, FIRST_ID);
        assert_eq!(boards[0].page_size(), (595, 842));
        assert_eq!(boards[0].x, 40.0);
    }

    #[test]
    fn adding_copies_the_sheet_and_names_it() {
        let mut out = print();
        PagePatch {
            add: Some(true),
            x: Some(700.0),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .unwrap();
        let boards = out.boards();
        assert_eq!(boards.len(), 2);
        assert_eq!(boards[1].id, "board-1");
        assert_eq!(boards[1].name, "Artboard 2");
        assert_eq!(boards[1].x, 700.0);
        // The first is untouched, and still the flat page.
        assert_eq!(out.x, 0.0);
        assert_eq!(out.to_config()["artboards"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_change_lands_on_the_artboard_it_names_and_the_first_is_mirrored() {
        let mut out = print();
        PagePatch { add: Some(true), ..PagePatch::default() }
            .apply(&mut out)
            .unwrap();
        PagePatch {
            artboard: Some("board-1".into()),
            paper: Some("a3".into()),
            name: Some("Artboard 1".into()),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .unwrap();
        let boards = out.boards();
        assert_eq!(boards[1].paper, "a3");
        // Names stay distinct: they are file names.
        assert_eq!(boards[1].name, "Artboard 1 2");
        assert_eq!(out.paper, "letter");
        PagePatch { artboard: Some(FIRST_ID.into()), y: Some(-90.0), ..PagePatch::default() }
            .apply(&mut out)
            .unwrap();
        assert_eq!(out.y, -90.0);
    }

    #[test]
    fn the_last_artboard_stays_and_removing_the_first_promotes_the_next() {
        let mut out = print();
        assert!(PagePatch { artboard: Some(FIRST_ID.into()), remove: Some(true), ..PagePatch::default() }
            .apply(&mut out)
            .is_err());
        PagePatch {
            add: Some(true),
            paper: Some("a5".into()),
            ..PagePatch::default()
        }
        .apply(&mut out)
        .unwrap();
        PagePatch { artboard: Some(FIRST_ID.into()), remove: Some(true), ..PagePatch::default() }
            .apply(&mut out)
            .unwrap();
        assert_eq!(out.boards().len(), 1);
        assert_eq!(out.paper, "a5");
        assert!(PagePatch { artboard: Some("nope".into()), x: Some(1.0), ..PagePatch::default() }
            .apply(&mut out)
            .is_err());
    }
}
