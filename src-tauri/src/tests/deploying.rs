//! Publishing somewhere real: the staged site, and the things a target is not
//! allowed to be.
//!
//! What cannot be tested here is a transfer — that wants a server and a
//! repository, and a suite that reached the network would be a suite that
//! fails on a train. What *can* be tested is everything a bad publish is made
//! of before it leaves: a site staged into the wrong shape, a hostname that
//! rsync would read as an option, a branch name git would refuse, a path that
//! climbs out of the clone, and a token surviving into something somebody
//! reads.
//!
//! These are worth pinning precisely because the failure they prevent happens
//! on somebody's live server rather than in this process.

use crate::project::{GameOptions, Genre, Projection, PublishTarget, TargetKind};
use crate::publish_targets::Server;
use crate::{deploy, deploy_github, deploy_rsync, store};

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

/// The site the two deploys are handed is the site the zip carries — one
/// description of what a published project is, consumed twice. A file that
/// made it into the archive and not onto the server is exactly the difference
/// this seam exists to prevent.
#[test]
fn a_staged_site_is_the_site_the_zip_carries() {
    let meta = project("Staging");
    let result = std::panic::catch_unwind(|| {
        let root = deploy::staging_dir(&meta.id).expect("staging should be made");
        let site = root.join("site");
        deploy::stage(&meta.id, &site).expect("site should stage");

        // The runnable page, the generated config, and both runtimes.
        assert!(site.join("index.html").is_file());
        assert!(site.join("js/game.config.json").is_file());
        assert!(site.join("js/lib/phaser.min.js").is_file());
        assert!(site.join("js/lib/psd-to-phaser.umd.js").is_file());

        // And *not* inside a directory named after the project. A zip unpacks
        // into one; a document root is already the place the site goes.
        let named = site.join(crate::publish::sanitise_name(&meta.name));
        assert!(!named.exists(), "the site is staged flat, not under its own name");

        let _ = std::fs::remove_dir_all(&root);
    });
    store::delete_project(&meta.id).ok();
    result.expect("staging should not panic");
}

#[test]
fn staging_empties_what_was_there_before() {
    let meta = project("Staging twice");
    let result = std::panic::catch_unwind(|| {
        let root = deploy::staging_dir(&meta.id).expect("staging should be made");
        std::fs::write(root.join("left-over.txt"), "from a publish that failed")
            .expect("file should write");
        let again = deploy::staging_dir(&meta.id).expect("staging should be made again");
        assert!(
            !again.join("left-over.txt").exists(),
            "a failed publish must not leave its half-written site for the next one"
        );
        let _ = std::fs::remove_dir_all(&again);
    });
    store::delete_project(&meta.id).ok();
    result.expect("staging should not panic");
}

/// rsync reads a leading dash as an option wherever it appears in its argv, so
/// a directory called `--delete` would be an instruction rather than a place.
#[test]
fn a_remote_directory_cannot_be_an_option_or_a_blank() {
    assert_eq!(
        deploy_rsync::clean_directory("/var/www/site/").expect("a path is a path"),
        "/var/www/site"
    );
    assert!(deploy_rsync::clean_directory("  ").is_err());
    // Blank would be `host:` — the login's home directory, published over.
    assert!(deploy_rsync::clean_directory("").is_err());
    assert!(deploy_rsync::clean_directory("--delete").is_err());
}

/// A server that wants a password has to fail rather than wait: the prompt
/// would go to a stdin nobody can see, behind a modal sheet with a spinner.
#[test]
fn ssh_is_told_not_to_ask() {
    let server = Server {
        id: "s1".into(),
        label: String::new(),
        host: "example.com".into(),
        user: "deploy".into(),
        port: Some(2222),
        identity_file: Some("/keys/id_ed25519".into()),
    };
    let command = deploy_rsync::ssh_command(&server);
    assert!(command.contains("BatchMode=yes"), "{command}");
    assert!(command.contains("-p 2222"), "{command}");
    assert!(command.contains("-i /keys/id_ed25519"), "{command}");
    assert_eq!(server.address(), "deploy@example.com");

    // No user is ssh's own rule: the one you are logged in as.
    let bare = Server { user: String::new(), ..server };
    assert_eq!(bare.address(), "example.com");
}

#[test]
fn a_repository_is_a_name_rather_than_a_path() {
    assert_eq!(deploy_github::checked("laffan", "owner").unwrap(), "laffan");
    assert_eq!(
        deploy_github::checked("idlewild-editor", "repository").unwrap(),
        "idlewild-editor"
    );
    // A slash would publish to a different repository than the two boxes say.
    assert!(deploy_github::checked("laffan/other", "repository").is_err());
    assert!(deploy_github::checked("..", "repository").is_err());
    assert!(deploy_github::checked("-x", "owner").is_err());
    assert!(deploy_github::checked(" ", "owner").is_err());
}

#[test]
fn a_branch_is_a_name_git_will_take() {
    assert_eq!(deploy_github::checked_branch("gh-pages").unwrap(), "gh-pages");
    assert_eq!(deploy_github::checked_branch("release/1.0").unwrap(), "release/1.0");
    for bad in ["", "with space", "a..b", "trailing/", "x.lock", "he^d", "@{now}"] {
        assert!(deploy_github::checked_branch(bad).is_err(), "{bad} should be refused");
    }
}

/// The path is joined to a clone this code is about to delete things inside.
#[test]
fn a_path_inside_the_repository_cannot_climb_out_of_it() {
    assert!(deploy_github::checked_path("").unwrap().as_os_str().is_empty());
    assert_eq!(
        deploy_github::checked_path("/docs/game/").unwrap(),
        std::path::Path::new("docs/game")
    );
    assert!(deploy_github::checked_path("../../etc").is_err());
}

/// git prints the remote back at you in half its error messages. Nothing
/// returned from a publish has been near the token without going through this.
#[test]
fn a_token_does_not_survive_into_anything_anybody_reads() {
    let said = "fatal: could not read from https://x-access-token:ghp_secret@github.com/a/b";
    let clean = deploy::redact(said, "ghp_secret");
    assert!(!clean.contains("ghp_secret"), "{clean}");
    // An empty secret must not turn every character into a redaction.
    assert_eq!(deploy::redact(said, ""), said);
}

#[test]
fn a_target_is_only_set_when_it_names_somewhere() {
    let empty = PublishTarget::default();
    assert!(!empty.is_set());

    // A kind alone is not enough: this would offer a Publish that fails at the
    // far end for want of a directory nobody typed.
    let half = PublishTarget { kind: TargetKind::Rsync, ..Default::default() };
    assert!(!half.is_set());

    let whole = PublishTarget {
        kind: TargetKind::Rsync,
        server: "s1".into(),
        directory: "/var/www".into(),
        ..Default::default()
    };
    assert!(whole.is_set());

    let repo = PublishTarget {
        kind: TargetKind::Github,
        owner: "laffan".into(),
        repo: "site".into(),
        ..Default::default()
    };
    assert!(repo.is_set());
    // The branch whose job is to be a built site, not the one holding source.
    assert_eq!(repo.branch_or_default(), "gh-pages");
    assert_eq!(repo.describe(), "laffan/site on gh-pages");
}

/// A target is written to `meta.json` beside the render options, and every
/// `meta.json` written before publishing existed reads as "nowhere".
#[test]
fn a_target_is_remembered_with_the_project() {
    let meta = project("Targeted");
    let result = std::panic::catch_unwind(|| {
        assert_eq!(meta.publish.kind, TargetKind::None);
        // From disk rather than from `create_project`'s answer: creating a
        // project writes the starter document afterwards, and that stamps
        // `updatedAt` again.
        let before = store::read_meta(&meta.id).expect("meta should read");
        let saved = store::set_publish_target(
            &meta.id,
            PublishTarget {
                kind: TargetKind::Github,
                owner: "laffan".into(),
                repo: "site".into(),
                path: "game".into(),
                ..Default::default()
            },
        )
        .expect("target should save");
        assert_eq!(saved.publish.repo, "site");

        let read = store::read_meta(&meta.id).expect("meta should read back");
        assert_eq!(read.publish.owner, "laffan");
        assert_eq!(read.publish.describe(), "laffan/site on gh-pages/game");
        // Naming a repository is not work on the project, and the home screen
        // sorts by `updatedAt`.
        assert_eq!(read.updated_at, before.updated_at);
    });
    store::delete_project(&meta.id).ok();
    result.expect("targets should not panic");
}
