//! How long a print project's sketch takes, stage by stage.
//!
//! Ignored by default — it is a stopwatch, not a check, and it writes a
//! full-page raster. Run it in the dev profile, which is what `tauri dev` and
//! the iPad's `tauri ios build --debug` both build:
//!
//! ```text
//! cargo test --lib perf -- --ignored --nocapture
//! ```
//!
//! `IDLEWILD_PERF_DPI` picks the resolution (300 by default) and
//! `IDLEWILD_PERF_INK` the share of the page with ink on it, in percent (5 by
//! default — a sketch, not a painting). `IDLEWILD_PERF_INK=100` is a painting:
//! every pixel opaque and different from its neighbours, which is what a
//! photograph or a finished PSD coming home looks like to an encoder.

use crate::print::{Output, OutputKind};
use crate::project::{GameOptions, Projection, Scaffold};
use crate::psd_write::{self, AnchorMarks, MarkPoint};
use crate::{psd_downsample, psd_pipeline, store};
use std::time::Instant;

fn env_or(name: &str, default: f64) -> f64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Soft round dabs strung along curves until about `share` of the page is
/// inked: dark, anti-aliased, on a clear ground — what a pen tool writes.
fn sketch(width: u32, height: u32, share: f64) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    let target = (width as f64 * height as f64 * share) as usize;
    let radius = (width.min(height) as f64 / 300.0).max(2.0);
    let mut inked = 0usize;
    let mut seed = 0x2545_f491u32;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f64 / u32::MAX as f64
    };
    while inked < target {
        let (mut x, mut y) = (next() * width as f64, next() * height as f64);
        let mut heading = next() * std::f64::consts::TAU;
        for _ in 0..400 {
            heading += (next() - 0.5) * 0.3;
            x += heading.cos() * radius * 0.5;
            y += heading.sin() * radius * 0.5;
            let r = radius + 1.0;
            for py in (y - r).max(0.0) as u32..((y + r) as u32).min(height) {
                for px in (x - r).max(0.0) as u32..((x + r) as u32).min(width) {
                    let d = ((px as f64 - x).powi(2) + (py as f64 - y).powi(2)).sqrt();
                    let a = ((radius - d + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
                    let at = ((py * width + px) * 4) as usize;
                    if a > rgba[at + 3] {
                        if rgba[at + 3] == 0 {
                            inked += 1;
                        }
                        rgba[at..at + 4].copy_from_slice(&[32, 30, 29, a]);
                    }
                }
            }
        }
    }
    rgba
}

/// Opaque, smooth colour with grain over it: nothing for a run-length or a
/// deflate encoder to collapse, as in a photograph.
fn painting(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    let mut seed = 0x9e37_79b9u32;
    for y in 0..height {
        for x in 0..width {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let grain = (seed % 24) as u32;
            let r = (x * 200 / width + grain) as u8;
            let g = (y * 200 / height + grain) as u8;
            let b = ((x + y) * 100 / (width + height) + grain + 60) as u8;
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    rgba
}

#[test]
#[ignore]
fn a_print_sketch_stage_by_stage() {
    let dpi = env_or("IDLEWILD_PERF_DPI", 300.0) as u32;
    let share = env_or("IDLEWILD_PERF_INK", 5.0) / 100.0;
    let meta = store::create_project_for(
        "Perf",
        Projection::Blank,
        Scaffold::P2p,
        64,
        GameOptions::default(),
        Output {
            kind: OutputKind::Print,
            dpi,
            paper: "letter".into(),
            ..Output::default()
        },
    )
    .expect("a print project");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        // Most of a letter page, the way a sketch over it would be cut.
        let scale = dpi as f32 / 72.0;
        let (w, h) = ((560.0 * scale) as u32, (720.0 * scale) as u32);
        let ink = if share >= 1.0 { painting(w, h) } else { sketch(w, h, share) };
        let marks = AnchorMarks {
            outline: vec![
                MarkPoint { x: 0.0, y: 0.0 },
                MarkPoint { x: w as f32, y: 0.0 },
                MarkPoint { x: w as f32, y: h as f32 },
                MarkPoint { x: 0.0, y: h as f32 },
            ],
            lines: vec![],
            art: Some(MarkPoint { x: 0.0, y: 0.0 }),
            margin: None,
            cols: 1,
            rows: 1,
        };
        println!("{w} x {h} at {dpi} DPI, {:.0}% ink", share * 100.0);

        let started = Instant::now();
        let bytes = psd_write::psd_from_rgba_marked("sketch", w, h, ink, Some(&marks))
            .expect("the sketch should convert");
        println!("write PSD            {:>8.0} ms  ({:.1} MB)", ms(started), mb(bytes.len()));
        let path = store::psd_dir(id).unwrap().join("sketch.psd");
        let started = Instant::now();
        std::fs::write(&path, &bytes).unwrap();
        println!("save PSD             {:>8.0} ms", ms(started));

        let started = Instant::now();
        let marks = std::cell::RefCell::new(vec![]);
        psd_pipeline::process(id, "sketch", &Default::default(), |line| {
            if !line.contains('\n') {
                marks.borrow_mut().push((started.elapsed(), line.to_string()));
            }
        })
        .expect("the pipeline should run");
        let total = started.elapsed();
        let mut from = std::time::Duration::ZERO;
        for (at, line) in marks.borrow().iter() {
            println!("  {:>8.0} ms  … then {line}", (*at - from).as_secs_f64() * 1e3);
            from = *at;
        }
        println!("  {:>8.0} ms  … to the end", (total - from).as_secs_f64() * 1e3);
        println!("pipeline total       {:>8.0} ms", total.as_secs_f64() * 1e3);

        let factor = dpi as f64 / 144.0;
        let started = Instant::now();
        let (small, _) = psd_downsample::downsample(&bytes, factor).unwrap();
        println!("downsample alone     {:>8.0} ms  ({:.1} MB)", ms(started), mb(small.len()));
        let started = Instant::now();
        psd::Psd::from_bytes(&bytes).unwrap();
        println!("parse alone          {:>8.0} ms", ms(started));
    });
    let _ = store::delete_project(&meta.id);
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

fn ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1e3
}

fn mb(bytes: usize) -> f64 {
    bytes as f64 / 1_048_576.0
}
