//! Which placed files the generated config tells the game to load.
//!
//! Split from `config` for the 700-line rule.

use crate::project::{GameOptions, Projection, Scaffold};
use crate::store;

/// A placed file with no processed manifest — an extrusion whose parse never
/// finished, say — is left out of what the game loads, because one missing
/// manifest makes psd-to-phaser's `loadMultiple` refuse every file.
#[test]
fn a_file_with_no_processed_output_is_not_loaded() {
    let meta = store::create_project(
        "Missing",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");
    let result = std::panic::catch_unwind(|| {
        super::mark_processed(&meta.id, &["tower"]);
        let placement = |key: &str| serde_json::json!({
            "id": key, "psdKey": key, "layerPath": key,
            "x": 0.0, "y": 0.0, "width": 8.0, "height": 8.0
        });
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 1, "projection": "orthogonal", "gridSize": 32,
                "layers": [{ "id": "l", "name": "L", "visible": true, "fills": [],
                    "placements": [placement("tower"), placement("extrude-gone")],
                    "zones": [], "strokes": [] }]
            })
            .to_string(),
        )
        .expect("document should save");
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["psdKeys"], serde_json::json!(["tower"]));
    });
    store::delete_project(&meta.id).ok();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
