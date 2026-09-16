//! Find across the project's `game/` tree — what ⇧⌘F asks and what comes back.
//!
//! The column matters more than it looks: the frontend adds it to a CodeMirror
//! line offset to select the match, and CodeMirror counts a document in UTF-16
//! code units. Byte offsets would be right for every ASCII file in this tree
//! and one place out on the first line carrying an em dash in a comment —
//! which is most comment lines in a project scaffolded by this editor.

use crate::game_search;
use crate::project::{GameOptions, Genre, Projection};
use crate::store;

fn project(name: &str) -> crate::project::ProjectMeta {
    store::create_project(
        name,
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created")
}

/// A project with nothing in `game/` but the files a test asks for.
fn only(meta: &crate::project::ProjectMeta, files: &[(&str, &str)]) {
    for file in store::list_game_files(&meta.id).expect("tree should list") {
        if !file.is_dir {
            let _ = store::delete_game_path(&meta.id, &file.path);
        }
    }
    for (path, text) in files {
        store::write_game_file(&meta.id, path, text).expect("file should write");
    }
}

#[test]
fn a_search_finds_every_line_and_says_where() {
    let meta = project("Search");
    only(
        &meta,
        &[
            ("js/one.js", "const place = 1;\nplace(place);\n"),
            ("js/two.js", "nothing here\n"),
        ],
    );

    let found = game_search::search(&meta.id, "place", false).expect("search should run");
    assert_eq!(found.matches.len(), 3, "{:?}", found.matches);
    assert!(!found.truncated);
    assert_eq!(found.files, 2, "both files are read, not only the one that hit");

    let first = &found.matches[0];
    assert_eq!(first.path, "js/one.js");
    assert_eq!(first.line, 1, "lines are 1-based, as the gutter counts them");
    assert_eq!(first.column, 6);
    assert_eq!(first.length, 5);
    assert_eq!(first.text, "const place = 1;");

    // Two on one line, and the second starts after the first rather than
    // inside it: overlapping answers are not what "next" means.
    assert_eq!(found.matches[1].line, 2);
    assert_eq!(found.matches[1].column, 0);
    assert_eq!(found.matches[2].line, 2);
    assert_eq!(found.matches[2].column, 6);

    store::delete_project(&meta.id).ok();
}

#[test]
fn case_is_a_switch() {
    let meta = project("Search case");
    only(&meta, &[("js/one.js", "Scene scene SCENE\n")]);

    let loose = game_search::search(&meta.id, "scene", false).expect("search should run");
    assert_eq!(loose.matches.len(), 3);

    let strict = game_search::search(&meta.id, "scene", true).expect("search should run");
    assert_eq!(strict.matches.len(), 1);
    assert_eq!(strict.matches[0].column, 6);

    store::delete_project(&meta.id).ok();
}

#[test]
fn a_column_counts_the_way_the_editor_does() {
    let meta = project("Search columns");
    // An em dash is one UTF-16 unit and three bytes; an emoji is two units and
    // four bytes. A byte offset would put the selection four and then six
    // places to the right of the word it is supposed to be on.
    only(&meta, &[("js/one.js", "// — place\n// 🙂 place\n")]);

    let found = game_search::search(&meta.id, "place", true).expect("search should run");
    assert_eq!(found.matches.len(), 2);
    assert_eq!(found.matches[0].column, 5, "one unit for the dash");
    assert_eq!(found.matches[1].column, 6, "two units for the emoji");

    store::delete_project(&meta.id).ok();
}

#[test]
fn an_empty_query_asks_nothing() {
    let meta = project("Search empty");
    only(&meta, &[("js/one.js", "place\n")]);

    let found = game_search::search(&meta.id, "", false).expect("search should run");
    assert!(found.matches.is_empty());
    assert_eq!(found.files, 0, "nothing is read for a question nobody asked");

    store::delete_project(&meta.id).ok();
}

#[test]
fn a_file_that_is_not_text_is_skipped_rather_than_failing_the_search() {
    let meta = project("Search binary");
    only(&meta, &[("js/one.js", "place\n")]);
    // `game/` is the user's tree and somebody will drop a PNG in it. A search
    // that fails because of one is a search nobody can use.
    let root = store::game_dir(&meta.id).expect("game dir");
    std::fs::write(root.join("js").join("art.png"), [0x89u8, 0x50, 0x4e, 0xff, 0xfe])
        .expect("bytes should write");

    let found = game_search::search(&meta.id, "place", false).expect("search should run");
    assert_eq!(found.matches.len(), 1);
    assert_eq!(found.files, 1, "the undecodable file is not counted as read");

    store::delete_project(&meta.id).ok();
}
