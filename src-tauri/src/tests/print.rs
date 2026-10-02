//! A print project from end to end: the sheet in the config, the scaffold
//! that installs `ExportForPrint()`, a PSD processed twice, and a PDF drawn
//! from the full-resolution half.

use super::swatch;
use crate::print::{Output, OutputKind};
use crate::project::{GameOptions, Projection, Scaffold};
use crate::{print_pdf, psd_pipeline, psd_write, store};

fn print_project(name: &str, dpi: u32) -> crate::project::ProjectMeta {
    store::create_project_for(
        name,
        Projection::Blank,
        Scaffold::P2p,
        64,
        GameOptions {
            default_zoom: 3.0,
            ..GameOptions::default()
        },
        Output {
            kind: OutputKind::Print,
            dpi,
            paper: "a4".into(),
            landscape: false,
            ..Output::default()
        },
    )
    .expect("a print project")
}

#[test]
fn a_vanilla_project_cannot_print() {
    let refused = store::create_project_for(
        "No scenes",
        Projection::Blank,
        Scaffold::Vanilla,
        64,
        GameOptions::default(),
        Output {
            kind: OutputKind::Print,
            ..Output::default()
        },
    );
    assert!(refused.is_err());
}

#[test]
fn the_scaffold_and_the_config_describe_the_sheet() {
    let meta = print_project("Sheet", 300);
    let result = std::panic::catch_unwind(|| {
        // The game looks at the page at 1×, whatever was asked for.
        assert_eq!(meta.options.default_zoom, 1.0);

        let game = store::game_dir(&meta.id).unwrap();
        let main = std::fs::read_to_string(game.join("js/main.js")).unwrap();
        assert!(main.contains("import { installPrint } from \"./shared/print.js\";"));
        assert!(main.contains("const game = new Phaser.Game({"));
        assert!(main.contains("installPrint(game, config);"));
        assert!(main.contains("backgroundColor: \"#ffffff\""));
        assert!(game.join("js/shared/print.js").exists());

        let scene = std::fs::read_to_string(game.join("js/scenes/Scene1.js")).unwrap();
        assert!(scene.contains(
            "\n    // Wait for PSDs to load\n    whenPsdsReady(this, () => {\n      // This following \
             line stops the script and prepares it for print output.\n      // Every option is \
             optional — see js/shared/print.js.\n\n      ExportForPrint({ name: \"page\", formats: \
             \"png\" });\n    });\n"
        ));
        assert!(scene.contains("  whenPsdsReady,\n} from"));

        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(game.join("js/game.config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["print"]["width"], 595);
        assert_eq!(config["print"]["height"], 842);
        assert_eq!(config["print"]["dpi"], 300);
        assert_eq!(config["presentation"]["fixed"], true);
        assert_eq!(config["presentation"]["width"], 595);

        // Turning the sheet is a Page Setup change, and the config follows.
        let patch = |json: serde_json::Value| -> crate::print::PagePatch {
            serde_json::from_value(json).unwrap()
        };
        let turned = store::set_page(
            &meta.id,
            &patch(serde_json::json!({ "paper": "letter", "landscape": true, "formats": "png", "x": 100 })),
        )
        .unwrap();
        assert_eq!(turned.output.page_size(), (792, 612));
        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(game.join("js/game.config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["print"]["width"], 792);
        assert_eq!(config["print"]["x"], 100.0);
        assert!(
            store::set_page(&meta.id, &patch(serde_json::json!({ "paper": "napkin" }))).is_err()
        );
        assert!(
            store::set_page(&meta.id, &patch(serde_json::json!({ "formats": "tiff" }))).is_err()
        );
        assert_eq!(turned.output.formats(), "png");

        // A typed size, in centimetres, and the config carries it.
        let custom = store::set_page(
            &meta.id,
            &patch(serde_json::json!({
                "paper": "custom", "customWidth": 850.39, "customHeight": 566.93, "unit": "cm"
            })),
        )
        .unwrap();
        assert_eq!(custom.output.page_size(), (850, 567));
        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(game.join("js/game.config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["print"]["paper"], "custom");
        assert_eq!(config["presentation"]["width"], 850);
    });
    let _ = store::delete_project(&meta.id);
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

#[test]
fn a_code_project_has_no_sheet() {
    let meta = store::create_project(
        "Game",
        Projection::Blank,
        Scaffold::P2p,
        64,
        GameOptions::default(),
    )
    .unwrap();
    let result = std::panic::catch_unwind(|| {
        let game = store::game_dir(&meta.id).unwrap();
        assert!(!game.join("js/shared/print.js").exists());
        let main = std::fs::read_to_string(game.join("js/main.js")).unwrap();
        assert!(!main.contains("installPrint"));
        assert!(store::set_page(&meta.id, &crate::print::PagePatch::default()).is_err());
    });
    let _ = store::delete_project(&meta.id);
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

#[test]
fn every_main_js_anchor_the_print_variant_needs_is_there() {
    let main = include_str!("../../templates/common/js/main.js");
    let printed = crate::templates::print_main(main);
    assert_eq!(printed.matches("installPrint").count(), 2);
    assert!(printed.contains("const game = new Phaser.Game({"));
    assert!(!printed.contains("#d9e6ef"));
}

#[test]
fn a_print_psd_is_processed_twice_and_prints_from_the_full_one() {
    let meta = print_project("Twice", 600);
    let result = std::panic::catch_unwind(|| {
        // 600 DPI is 8⅓ px to the point; the screen copy is 2. A 250 × 125
        // file is therefore 60 × 30 on screen.
        let bytes = psd_write::psd_from_rgba_marked(
            "plate",
            250,
            125,
            swatch(250, 125, [20, 90, 200, 255]),
            None,
        )
        .unwrap();
        std::fs::write(store::psd_dir(&meta.id).unwrap().join("plate.psd"), bytes).unwrap();
        let manifest = psd_pipeline::process(
            &meta.id,
            "plate",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(manifest["width"], 60);
        assert_eq!(manifest["height"], 30);

        let full: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(store::print_dir(&meta.id).unwrap().join("plate/data.json"))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(full["width"], 250);
        assert_eq!(full["height"], 125);

        // The same sprite, at the same path, in both trees.
        let sprite = manifest["layers"][0]["filePath"]
            .as_str()
            .or_else(|| manifest["layers"][0]["children"][0]["filePath"].as_str())
            .expect("a sprite path")
            .to_string();
        let screen = store::assets_dir(&meta.id)
            .unwrap()
            .join("plate")
            .join(&sprite);
        let print = store::print_dir(&meta.id)
            .unwrap()
            .join("plate")
            .join(&sprite);
        assert!(screen.exists() && print.exists(), "{sprite}");
        let (sw, _) = image::image_dimensions(&screen).unwrap();
        let (pw, _) = image::image_dimensions(&print).unwrap();
        assert!(pw > sw * 4, "print {pw} vs screen {sw}");

        // The PSD now says what it was made at.
        let psd = std::fs::read(store::psd_dir(&meta.id).unwrap().join("plate.psd")).unwrap();
        assert!(crate::psd_resolution::stamp(&psd, 600).is_none());

        // And the PDF draws the full-resolution file where the sprite stood.
        let page: print_pdf::PrintPage = serde_json::from_value(serde_json::json!({
            "page": { "width": 595, "height": 842, "dpi": 600 },
            "items": [{
                "kind": "asset",
                "path": format!("plate/{sprite}"),
                "crop": [0, 0, sw, 30],
                "size": [sw, 30],
                "matrix": [30, 0, 0, 15, 10, 10],
            }]
        }))
        .unwrap();
        let printed = print_pdf::export_print_pdf(meta.id.clone(), page).unwrap();
        assert_eq!(printed.drawn, 1);
        assert!(printed.screen_only.is_empty());
        let pdf = std::fs::read(store::project_dir(&meta.id).unwrap().join(&printed.path)).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(String::from_utf8_lossy(&pdf).contains(&format!("/Width {pw} ")));

        // And the same page as a layered PSD at 600 DPI, with a preview.
        let page: print_pdf::PrintPage = serde_json::from_value(serde_json::json!({
            "page": { "width": 595, "height": 842 },
            "items": [{
                "kind": "asset",
                "path": format!("plate/{sprite}"),
                "crop": [0, 0, sw, 30],
                "size": [sw, 30],
                "matrix": [30, 0, 0, 15, 10, 10],
            }]
        }))
        .unwrap();
        let layered = crate::print_psd::export_print_psd(meta.id.clone(), page.clone()).unwrap();

        // And as one PNG at 600 DPI that says so.
        let png = crate::print_png::export_print_png(meta.id.clone(), page).unwrap();
        assert_eq!(png.path, "exports/page.png");
        let bytes = std::fs::read(store::project_dir(&meta.id).unwrap().join(&png.path)).unwrap();
        assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 4958);
        assert!(bytes.windows(4).any(|w| w == b"pHYs"));
        assert_eq!(layered.drawn, 1);
        let dir = store::project_dir(&meta.id).unwrap();
        let psd = psd::Psd::from_bytes(&std::fs::read(dir.join(&layered.path)).unwrap()).unwrap();
        // 595 points at 600 DPI.
        assert_eq!(psd.width(), 4958);
        // 30 points at 600 DPI, plus the column a sub-pixel position touches.
        assert!((250..=251).contains(&psd.layers()[0].width()));
        assert!(dir.join(layered.preview.unwrap()).exists());
        assert_eq!(layered.path, "exports/page.psd");
        crate::print_files::save_print_file(
            meta.id.clone(),
            layered.path.clone(),
            dir.join("copy.psd").display().to_string(),
        )
        .unwrap();
        assert!(dir.join("copy.psd").exists());
        crate::print_files::save_print_files(
            meta.id.clone(),
            vec![printed.path.clone(), layered.path.clone()],
            dir.join("all.zip").display().to_string(),
        )
        .unwrap();
        let zip = zip::ZipArchive::new(std::fs::File::open(dir.join("all.zip")).unwrap()).unwrap();
        let mut names: Vec<&str> = zip.file_names().collect();
        names.sort();
        assert_eq!(names, vec!["page.pdf", "page.psd"]);
    });
    let _ = store::delete_project(&meta.id);
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

/// Render a page `ExportForPrint()` captured, for looking at by hand:
/// `PRINT_PAGE=page.json PRINT_ROOT=dir PRINT_OUT=out.pdf cargo test -- --ignored`.
/// `dir` holds `print/` and `assets/` the way a project does.
#[test]
#[ignore]
fn render_a_captured_page() {
    let (Ok(page), Ok(root), Ok(out)) = (
        std::env::var("PRINT_PAGE"),
        std::env::var("PRINT_ROOT"),
        std::env::var("PRINT_OUT"),
    ) else {
        return;
    };
    let page: print_pdf::PrintPage =
        serde_json::from_str(&std::fs::read_to_string(page).unwrap()).unwrap();
    let root = std::path::PathBuf::from(root);
    let read = |path: &str| -> Result<(image::RgbaImage, bool), String> {
        let full = root.join("print").join(path);
        let (file, hi) = if full.exists() {
            (full, true)
        } else {
            (root.join("site/assets").join(path), false)
        };
        Ok((image::open(file).map_err(|e| e.to_string())?.to_rgba8(), hi))
    };
    let (bytes, report) = print_pdf::build(&page, 300, &read).unwrap();
    std::fs::write(&out, bytes).unwrap();
    assert!(report.drawn > 0);
    let mut report = print_pdf::Report::default();
    let built = crate::print_psd::build(&page, 300, &read, &mut report).unwrap();
    std::fs::write(format!("{out}.psd"), built.bytes).unwrap();
    std::fs::write(
        format!("{out}.png"),
        crate::print_psd::preview_png(&built.flattened, 1600).unwrap(),
    )
    .unwrap();
}
