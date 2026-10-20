//! Grid alignment through the pipeline — see `psd_grid_align.rs`. The file in
//! `psd/` stays as it was drawn while the processed sprites are slanted, a
//! rename takes the setting with it, and Rasterize puts the slant into the
//! file and drops the setting.

use super::swatch;
use crate::project::{GameOptions, Projection, Scaffold};
use crate::psd_grid_align::{self, GridAlign};
use crate::{psd_layers, psd_write, store};

fn floor() -> GridAlign {
    let len = 5f64.sqrt();
    GridAlign { runs: "cx".into(), upright: false, ax: 2.0 / len, ay: 1.0 / len, bx: -2.0 / len, by: 1.0 / len }
}

fn manifest_size(id: &str, key: &str) -> (u64, u64) {
    let manifest: serde_json::Value =
        serde_json::from_str(&crate::psd_pipeline::read_manifest(id, key).expect("manifest")).expect("json");
    (manifest["width"].as_u64().unwrap(), manifest["height"].as_u64().unwrap())
}

#[test]
fn a_psd_is_slanted_when_parsed_and_only_rasterize_changes_the_file() {
    let meta = store::create_project("Align", Projection::Isometric, Scaffold::Topdown, 64, GameOptions::default())
        .expect("project should be created");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let bytes = psd_write::psd_from_rgba_marked("tile", 60, 60, swatch(60, 60, [200, 60, 20, 255]), None)
            .expect("PSD should be written");
        let path = store::psd_dir(id).expect("psd dir").join("tile.psd");
        std::fs::write(&path, &bytes).expect("PSD should save");

        psd_grid_align::set(id, "tile", Some(floor()), |_| {}).expect("align");
        let (w, h) = manifest_size(id, "tile");
        assert!(w > 60 && (w as f64 / h as f64 - 2.0).abs() < 0.1, "processed as a diamond: {w} × {h}");
        assert_eq!(std::fs::read(&path).expect("file"), bytes, "the PSD itself is untouched");

        // Off again: processed flat.
        psd_grid_align::set(id, "tile", None, |_| {}).expect("flat");
        assert_eq!(manifest_size(id, "tile"), (60, 60));
        assert!(store::read_meta(id).expect("meta").grid_align.is_empty());

        // Rasterize: the slant is in the file, and the setting is gone.
        psd_grid_align::set(id, "tile", Some(floor()), |_| {}).expect("align again");
        psd_grid_align::rasterize(id, "tile", |_| {}).expect("rasterize");
        let list = psd_layers::read(id, "tile").expect("layers");
        assert_eq!((list.width as u64, list.height as u64), (w, h), "the file is the slanted copy");
        assert!(store::read_meta(id).expect("meta").grid_align.is_empty());
        assert_eq!(manifest_size(id, "tile"), (w, h), "and is not slanted twice");
        assert!(psd_grid_align::rasterize(id, "tile", |_| {}).is_err(), "nothing left to rasterize");

        // A rename takes an alignment with it.
        psd_grid_align::set(id, "tile", Some(floor()), |_| {}).expect("align a third time");
        psd_grid_align::carry(id, "tile", "floor", true);
        let meta = store::read_meta(id).expect("meta");
        assert!(meta.grid_align.contains_key("floor") && !meta.grid_align.contains_key("tile"));
    });
    store::delete_project(&meta.id).ok();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
