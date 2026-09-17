//! Project data model. Mirrors src/lib/types.ts.
//!
//! A project is a directory, not a row in a blob. Phaser Bench keeps every
//! sketch and every asset base64-encoded inside one `workspace.json`; that
//! does not survive PSD-heavy projects, so Idlewild gives each project its
//! own directory and writes the document beside its assets.

use serde::{Deserialize, Serialize};

/// The shape of the space a project is built in.
///
/// Isometric and orthogonal are lattices. Blank is not: its cells are single
/// world pixels, so nothing snaps and a selection is exactly the rectangle
/// that was dragged. The frontend's `Grid` is where that lives; here it is a
/// label carried into the document and the scaffolded game's config.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Projection {
    Isometric,
    Orthogonal,
    Blank,
}

impl Projection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Projection::Isometric => "isometric",
            Projection::Orthogonal => "orthogonal",
            Projection::Blank => "blank",
        }
    }
}

/// What kind of game the project scaffolds.
///
/// `Default` is what makes this safe to add to a struct already on disk:
/// every `meta.json` written before the choice existed deserialises as top
/// down, which is what those projects have always been.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Genre {
    #[default]
    Topdown,
    Platformer,
}

impl Genre {
    pub fn as_str(&self) -> &'static str {
        match self {
            Genre::Topdown => "topdown",
            Genre::Platformer => "platformer",
        }
    }
}

/// How a project is rendered, and what its scaffold put in it.
///
/// Three of the four are settings the editor and the game both read, and the
/// editor can change them afterwards — Project Options has them. The fourth,
/// `character`, is a fact about what New Project wrote: a project's `game/` tree
/// is its own copy, so unticking the box later would not take a character out
/// of code that already has one. It is kept because the scaffold has to be
/// reproducible — a managed block's Reset asks for this file as it was first
/// written, and the answer depends on whether a character was in it.
///
/// Every field has a default, and the defaults are what every project written
/// before these existed has always been: no pixel snapping, zoom 1, and a
/// character, because the scaffold always wrote one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameOptions {
    /// Nearest-neighbour textures rather than bilinear ones — what keeps a
    /// 16px sprite blocky instead of blurring it as it is scaled up.
    #[serde(default)]
    pub pixel_art: bool,
    /// Draw on whole pixels, so a camera at a fractional scroll does not
    /// smear a sprite across two of them.
    #[serde(default)]
    pub round_pixels: bool,
    /// The zoom a scene opens at, in the editor and in the game.
    #[serde(default = "one")]
    pub default_zoom: f64,
    /// Whether New Project scaffolded a character controller.
    #[serde(default = "yes")]
    pub character: bool,
}

impl Default for GameOptions {
    fn default() -> Self {
        GameOptions {
            pixel_art: false,
            round_pixels: false,
            default_zoom: 1.0,
            character: true,
        }
    }
}

impl GameOptions {
    /// The zoom, with a hand-edited nonsense value brought back into range.
    ///
    /// It reaches a camera and a `setZoom(0)` is a blank screen, so a zero, a
    /// negative or a NaN is not something to pass on.
    pub fn zoom(&self) -> f64 {
        if self.default_zoom.is_finite() && self.default_zoom > 0.0 {
            self.default_zoom.clamp(0.05, 16.0)
        } else {
            1.0
        }
    }
}

/// The page around the game: how big it is, where it sits and what is behind
/// it.
///
/// **Separate from `GameOptions`, and not folded into it.** Two reasons, one of
/// them the language's. `GameOptions` is `Copy` and is copied all over the
/// editor; a colour is a `String` and would cost that. The other is the better
/// one: `GameOptions` is how the *canvas* renders — what the editor's own view
/// and the game's camera both read — and none of this reaches the editor's
/// canvas at all. It describes the HTML document the game is embedded in, which
/// is a thing only the exported or played game has. Keeping them apart means
/// the editor never has to ask which half of one struct applies to it.
///
/// **It reaches the game as data, not as rewritten CSS.** These end up in
/// `game.config.json` and `main.js` writes them onto the document as custom
/// properties, which `styles.css` reads with a fallback for each. A project's
/// `styles.css` is its own file the moment the scaffold writes it, and an
/// editor that rewrote rules inside it would be fighting whoever edited them —
/// the same argument that put `pixelArt` in the config rather than in the
/// scaffold as a literal. A rule somebody rewrites keeps whatever they wrote.
///
/// Every field defaults, and the defaults are the page a project written before
/// any of this existed has always had: the game filling the window, no margin,
/// square corners. Which makes the colour the odd one out, and deliberately —
/// see `DEFAULT_BACKGROUND`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presentation {
    /// A fixed box rather than the whole window. The two sizes below are read
    /// only when this is on, so turning it off and on again comes back to the
    /// size you had.
    #[serde(default)]
    pub fixed: bool,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    /// Whether the box sits in the middle of the page or at its top left.
    /// Nothing to see when the game fills the window.
    #[serde(default = "yes")]
    pub centered: bool,
    /// Clear space around the game, in CSS pixels.
    pub margin: u32,
    /// Rounded corners on the game itself, in CSS pixels.
    pub radius: u32,
    /// The page behind the game — the `html` background, not Phaser's own.
    /// Only ever visible where the game does not reach.
    #[serde(default = "default_background")]
    pub background: String,
}

/// The page behind the game, when nobody has said otherwise.
///
/// **Not the scaffold's `#d9e6ef`**, which is the only other colour in this
/// file's neighbourhood and would have been the tidy answer. That blue is the
/// *world's* — it is what the editor's canvas is drawn on, what Phaser paints
/// behind the scenes, and what a player reads as sky. The page is the surface
/// the game is *mounted on*, and it is only ever visible once a margin, a
/// radius or a fixed size has pulled the game back from an edge. At that
/// moment a second field of the same sky is the worst possible answer: it
/// reads as the world continuing past its own border, which is exactly the
/// impression a framed game exists to avoid.
///
/// So: a neutral dark, the way every video player and every device frame mats
/// a picture. This one is the app's own `--color-neutral-900` — the dark the
/// editor's chrome is drawn in — rather than an invented hex, so there is one
/// fewer arbitrary number here and a framed game sits on the same ground the
/// thing that made it does.
pub const DEFAULT_BACKGROUND: &str = "#2d2b2b";

impl Default for Presentation {
    fn default() -> Self {
        Presentation {
            fixed: false,
            width: default_width(),
            height: default_height(),
            centered: true,
            margin: 0,
            radius: 0,
            background: default_background(),
        }
    }
}

impl Presentation {
    /// The same values with anything unusable brought back into range.
    ///
    /// Called on the way *out*, into the config, rather than on the way in.
    /// Three things can put nonsense here and none of them is the sheet: a
    /// hand-edited `meta.json`, an archive from somewhere else, and a build
    /// whose bounds were different. What they reach is a stylesheet and a
    /// Phaser scale config, where a zero width is a game nobody can see and a
    /// margin of four million is a game pushed off the page.
    ///
    /// The colour is the one that is checked rather than clamped, because it is
    /// the only one that is not a number. It is written into a CSS custom
    /// property, and while the browser drops a property it cannot parse, a
    /// value this code has not looked at is not a thing to hand a stylesheet.
    /// Anything that is not a plain hex colour falls back to the default.
    pub fn sane(&self) -> Presentation {
        Presentation {
            fixed: self.fixed,
            width: self.width.clamp(MIN_GAME_SIZE, MAX_GAME_SIZE),
            height: self.height.clamp(MIN_GAME_SIZE, MAX_GAME_SIZE),
            centered: self.centered,
            margin: self.margin.min(MAX_SPACING),
            radius: self.radius.min(MAX_SPACING),
            background: if is_hex_colour(&self.background) {
                self.background.clone()
            } else {
                default_background()
            },
        }
    }
}

/// Small enough for a sprite, large enough for anything a browser will show.
pub const MIN_GAME_SIZE: u32 = 16;
pub const MAX_GAME_SIZE: u32 = 8192;
/// A margin or a corner bigger than this is not a layout, it is a typo.
pub const MAX_SPACING: u32 = 512;

/// `#rgb`, `#rrggbb` or `#rrggbbaa` — what this app's own colour picker writes.
fn is_hex_colour(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

fn default_width() -> u32 {
    960
}

fn default_height() -> u32 {
    540
}

fn default_background() -> String {
    DEFAULT_BACKGROUND.to_string()
}

fn one() -> f64 {
    1.0
}

fn yes() -> bool {
    true
}

/// Where a project publishes to, when publishing means somewhere real.
///
/// **The credentials are not here.** A login is the person's and is shared by
/// every project — one server, one GitHub account, entered once; see
/// `publish_targets.rs`. What is per project is the *destination*: which of
/// those servers, and which directory on it, or which repository, branch and
/// path inside it. Splitting them that way is what makes "log in once, then
/// point each project somewhere" the shape of the feature rather than a
/// password sheet per project.
///
/// Flat rather than an enum with payloads, and every field defaulting, because
/// it is written into `meta.json` beside `GameOptions`: a project whose target
/// was rsync and is now GitHub keeps what it had typed for the other one, and
/// every `meta.json` written before publishing existed reads as `None`.
///
/// `server` names a row in *this install's* settings. That is the reason a
/// target does not travel in a `.idlewild` file: an id from another machine
/// would name a server this one has never heard of. See `archive.rs` for the
/// same argument about `meta.json` as a whole.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishTarget {
    #[serde(default)]
    pub kind: TargetKind,
    /// The id of the rsync server this project pushes to.
    #[serde(default)]
    pub server: String,
    /// The directory on that server the site's own files land in.
    #[serde(default)]
    pub directory: String,
    /// Whether an rsync push may remove what is at the far end that the site
    /// no longer has. Off by default: a publish that deletes is a publish that
    /// can delete something else's files, and the box says so.
    #[serde(default)]
    pub prune: bool,
    /// The id of the GitHub account this project publishes as.
    ///
    /// Empty on a target written when there could only be one, which resolves
    /// to that one — see `publish_targets::account_for`.
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub repo: String,
    /// The branch the site is committed to. `gh-pages` unless someone says
    /// otherwise — see `TargetKind::Github` and the sheet that fills this in.
    #[serde(default)]
    pub branch: String,
    /// A directory inside the repository, or empty for its root.
    #[serde(default)]
    pub path: String,
}

/// Which of the two a project publishes through, or neither.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    /// Nothing is set up, which is what every project starts as and what the
    /// two zip exports have always been enough for.
    #[default]
    None,
    Rsync,
    Github,
}

impl PublishTarget {
    /// Whether this target names somewhere to publish to.
    ///
    /// A kind alone is not enough: a project that picked rsync and never named
    /// a directory would otherwise offer a Publish that fails at the far end.
    pub fn is_set(&self) -> bool {
        match self.kind {
            TargetKind::None => false,
            TargetKind::Rsync => !self.server.is_empty() && !self.directory.is_empty(),
            TargetKind::Github => !self.owner.is_empty() && !self.repo.is_empty(),
        }
    }

    /// `owner/repo`, which is how the picker lists a repository and how a
    /// target is matched back to a row in that list.
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }

    /// The branch a GitHub publish actually uses.
    ///
    /// `gh-pages` for anyone who has not said, because that is the branch
    /// whose whole job is to be a built site — and because the alternative
    /// default is `main`, where the thing being replaced would be somebody's
    /// source.
    pub fn branch_or_default(&self) -> &str {
        if self.branch.is_empty() {
            "gh-pages"
        } else {
            &self.branch
        }
    }

    /// How the destination reads to a person, for a sheet and for a log line.
    pub fn describe(&self) -> String {
        match self.kind {
            TargetKind::None => "nowhere yet".to_string(),
            TargetKind::Rsync => format!("{} on the server", self.directory),
            TargetKind::Github => {
                let path = if self.path.is_empty() {
                    String::new()
                } else {
                    format!("/{}", self.path.trim_matches('/'))
                };
                format!("{} on {}{path}", self.full_name(), self.branch_or_default())
            }
        }
    }
}

/// The home screen's list entry. Persisted as `meta.json` in the project dir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub projection: Projection,
    #[serde(default)]
    pub genre: Genre,
    #[serde(rename = "gridSize")]
    pub grid_size: u32,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    #[serde(rename = "layerCount", default)]
    pub layer_count: u32,
    /// Absent on every `meta.json` written before the options existed, which
    /// reads as the defaults — see `GameOptions`.
    #[serde(default)]
    pub options: GameOptions,
    /// Where this project publishes to, or nowhere. See `PublishTarget`.
    #[serde(default)]
    pub publish: PublishTarget,
    /// The page around the game. Absent on every `meta.json` written before it
    /// existed, which reads as the defaults — and the defaults are the page
    /// every one of those projects already had.
    #[serde(default)]
    pub presentation: Presentation,
}

impl ProjectMeta {
    pub fn new(
        id: String,
        name: String,
        projection: Projection,
        genre: Genre,
        grid_size: u32,
        options: GameOptions,
    ) -> Self {
        let now = now_ms();
        ProjectMeta {
            id,
            name,
            projection,
            genre,
            grid_size,
            created_at: now,
            updated_at: now,
            layer_count: 0,
            options,
            publish: PublishTarget::default(),
            presentation: Presentation::default(),
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A file inside a project's editable `game/` tree, as the code modal sees it.
#[derive(Debug, Clone, Serialize)]
pub struct GameFile {
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

/// One entry produced by a PSD processing run.
#[derive(Debug, Clone, Serialize)]
pub struct OutputFile {
    #[serde(rename = "absolutePath")]
    pub absolute_path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub filename: String,
    #[serde(rename = "isJson")]
    pub is_json: bool,
}

/// Result of importing an image: the PSD it became, and its parsed manifest.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    /// The key the PSD is registered under — its file stem.
    pub key: String,
    pub width: u32,
    pub height: u32,
    /// The `data.json` manifest, as a JSON string.
    pub manifest: String,
}
