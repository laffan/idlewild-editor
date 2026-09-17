//! The page around the game: what a project carries, what reaches the game,
//! and what happens to a number nobody in the app could have typed.
//!
//! The interesting half is not that six fields round-trip. It is the two
//! guards either side of them.
//!
//! **A `meta.json` is a file on a disk** and an archive is a file somebody
//! hands you, so what comes out of `Presentation` is not what went in: it is
//! clamped on the way into the config, which is the moment it stops being data
//! and becomes a stylesheet and a Phaser scale. A width of zero is a game
//! nobody can see; a margin of four million is a game pushed off the page; a
//! background that is not a colour is a value handed to `setProperty` that this
//! code has never looked at.
//!
//! **And the defaults are the page every project already had.** Every field
//! defaults, so a `meta.json` written before any of this existed reads as the
//! full-bleed, square-cornered, `#d9e6ef` page it has always been — and the
//! config it generates says exactly that rather than saying nothing.

use crate::game_config;
use crate::project::{GameOptions, Genre, Presentation, Projection, DEFAULT_BACKGROUND};
use crate::store;

/// A page with something other than the default in every field, so a test that
/// loses one notices.
fn framed() -> Presentation {
    Presentation {
        fixed: true,
        width: 480,
        height: 320,
        centered: false,
        margin: 24,
        radius: 12,
        background: "#1e3a5f".to_string(),
    }
}

fn seeded(name: &str) -> String {
    store::create_project(
        name,
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created")
    .id
}

#[test]
fn a_project_that_has_never_heard_of_a_page_still_describes_one() {
    let id = seeded("No page");
    let result = std::panic::catch_unwind(|| {
        let meta = store::read_meta(&id).expect("meta should read");
        let config = game_config::empty(&meta);
        let page = &config["presentation"];

        // Not merely present: present and saying what every project written
        // before this existed has always looked like. An absent field would
        // leave `main.js` on its own fallbacks, which agree — but a config
        // that quietly said nothing would be the one thing nobody could debug.
        assert_eq!(page["fixed"], false, "a project fills the window until told otherwise");
        assert_eq!(page["margin"], 0);
        assert_eq!(page["radius"], 0);
        assert_eq!(page["background"], DEFAULT_BACKGROUND);
    });
    store::delete_project(&id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn the_page_reaches_the_config_the_game_reads() {
    let id = seeded("Framed");
    let result = std::panic::catch_unwind(|| {
        store::set_presentation(&id, framed()).expect("page should save");
        let meta = store::read_meta(&id).expect("meta should read");
        let page = &game_config::empty(&meta)["presentation"];

        assert_eq!(page["fixed"], true);
        assert_eq!(page["width"], 480);
        assert_eq!(page["height"], 320);
        assert_eq!(page["centered"], false);
        assert_eq!(page["margin"], 24);
        assert_eq!(page["radius"], 12);
        assert_eq!(page["background"], "#1e3a5f");

        // And it is on disk under its own key rather than folded into the
        // render options, which are a different subject and a `Copy` struct.
        assert_eq!(meta.presentation, framed());
    });
    store::delete_project(&id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// What the sheet cannot produce and a text editor can.
#[test]
fn a_hand_edited_page_is_brought_back_into_range() {
    let absurd = Presentation {
        fixed: true,
        width: 0,
        height: 999_999,
        centered: true,
        margin: 4_000_000,
        radius: u32::MAX,
        background: "steelblue".to_string(),
    };
    let sane = absurd.sane();

    assert_eq!(sane.width, 16, "a zero-width game is a game nobody can see");
    assert_eq!(sane.height, 8192);
    assert_eq!(sane.margin, 512);
    assert_eq!(sane.radius, 512);
    // A named CSS colour is a colour, and is still not what this writes: the
    // value goes into a custom property, and the only shape this code has
    // looked at is a hex one. Anything else falls back rather than being
    // passed through unexamined.
    assert_eq!(sane.background, DEFAULT_BACKGROUND);

    // The switches are answers rather than magnitudes, so nothing to clamp.
    assert!(sane.fixed);
    assert!(sane.centered);
}

#[test]
fn the_three_shapes_of_hex_a_colour_picker_writes_are_kept() {
    for colour in ["#fff", "#1e3a5f", "#1e3a5f80", "#ABCDEF"] {
        let page = Presentation {
            background: colour.to_string(),
            ..Presentation::default()
        };
        assert_eq!(page.sane().background, colour, "{colour} should survive");
    }
    for rubbish in ["", "#", "#12", "#12345", "red", "rgb(1,2,3)", "#12345g", "  #fff"] {
        let page = Presentation {
            background: rubbish.to_string(),
            ..Presentation::default()
        };
        assert_eq!(
            page.sane().background,
            DEFAULT_BACKGROUND,
            "{rubbish:?} is not a colour this code has looked at",
        );
    }
}

/// A `.idlewild` carries it, because nothing else in the archive could rebuild
/// it — and a project that came back framed differently from the one that was
/// exported would be a project that had quietly lost work.
#[test]
fn the_page_travels_in_an_archive() {
    let source = seeded("Carried");
    store::set_presentation(&source, framed()).expect("page should save");
    let file = std::env::temp_dir().join("idlewild-presentation.idlewild");

    let result = std::panic::catch_unwind(|| {
        crate::archive::export(&source, &file).expect("export should write");
        let opened = crate::archive::import(&file).expect("import should read");
        assert_eq!(opened.presentation, framed());
        store::delete_project(&opened.id).ok();
    });

    store::delete_project(&source).ok();
    std::fs::remove_file(&file).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
