//! Publishing somewhere real: the staged site, and the things a target is not
//! allowed to be.
//!
//! What cannot be tested here is a transfer — that wants a server and a
//! repository, and a suite that reached the network would be a suite that
//! fails on a train. What *can* be tested is everything a bad publish is made
//! of before it leaves: a site staged into the wrong shape, a directory that
//! would land on somebody's home, a branch name git would refuse, a path that
//! climbs out of the clone, a host key that is not the one this server had
//! last time, and a token surviving into something somebody reads.
//!
//! These are worth pinning precisely because the failure they prevent happens
//! on somebody's live server rather than in this process — and, in the host
//! key's case, because a mistake in it is a vulnerability rather than a bug.

use crate::project::{GameOptions, Genre, Projection, PublishTarget, TargetKind};
use crate::publish_targets::Server;
use crate::{compare, deploy, deploy_github, deploy_ssh, site_files, store};

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

/// The bug this pins made the server publish fail for every new file, and say
/// *No such file* about the file it was trying to create — which reads as a
/// permissions problem and is not one.
///
/// `russh_sftp`'s own `write` opens with `OpenFlags::WRITE` alone. That means
/// "open this file for writing", not "make me this file", so a server answers
/// `SSH_FX_NO_SUCH_FILE` and the publish stops on its first file. Truncating
/// matters separately: without it, replacing a file with a shorter one leaves
/// the tail of the old one behind.
#[test]
fn a_file_is_created_and_truncated_rather_than_merely_opened() {
    use russh_sftp::protocol::OpenFlags;
    assert!(deploy_ssh::PUT_FLAGS.contains(OpenFlags::CREATE), "or a new file fails");
    assert!(deploy_ssh::PUT_FLAGS.contains(OpenFlags::TRUNCATE), "or a shorter file keeps its tail");
    assert!(deploy_ssh::PUT_FLAGS.contains(OpenFlags::WRITE));
}

/// A blank directory would be the login's home, published over.
#[test]
fn a_remote_directory_cannot_be_a_blank_or_climb() {
    assert_eq!(
        deploy_ssh::clean_directory("/var/www/site/").expect("a path is a path"),
        "/var/www/site"
    );
    assert!(deploy_ssh::clean_directory("  ").is_err());
    assert!(deploy_ssh::clean_directory("").is_err());
    assert!(deploy_ssh::clean_directory("/var/www/../../etc").is_err());
}

/// The one decision in the SSH path where a mistake is a vulnerability rather
/// than a bug: accepting any host key means a publish can be handed to whoever
/// answers on that address.
#[test]
fn a_host_key_is_trusted_once_and_then_insisted_on() {
    // A first visit has nothing to compare against, and there is no terminal
    // to ask at. It is accepted and recorded.
    assert!(deploy_ssh::trusts("", "SHA256:abc"));
    assert!(deploy_ssh::trusts("SHA256:abc", "SHA256:abc"));
    // Every visit after has to be the same server.
    assert!(!deploy_ssh::trusts("SHA256:abc", "SHA256:def"));
    assert!(!deploy_ssh::trusts("SHA256:abc", ""));
}

#[test]
fn a_changed_host_key_says_both_of_them() {
    let server = Server {
        id: "s1".into(),
        host: "example.com".into(),
        host_key: "SHA256:old".into(),
        ..Default::default()
    };
    let said = deploy_ssh::host_key_changed(&server, "SHA256:new");
    assert!(said.contains("SHA256:old"), "{said}");
    assert!(said.contains("SHA256:new"), "{said}");
    // Nothing about it should read as something to click past.
    assert!(said.contains("Nothing was published"), "{said}");
}

/// A server with no key cannot publish, and should say so while the settings
/// sheet is the thing in front of you rather than at the far end of a publish.
#[test]
fn a_server_without_a_key_refuses_early() {
    let server = Server {
        id: "s1".into(),
        label: "Live".into(),
        host: "example.com".into(),
        ..Default::default()
    };
    let err = server.private_key().expect_err("no key is not publishable");
    assert!(err.contains("Live"), "{err}");
}

/// The manifest is what replaces rsync's delta: hash per file, written beside
/// the site, read back next time. A file it has never heard of is changed, and
/// so is one whose hash differs — neither may be silently skipped.
#[test]
fn only_what_differs_is_sent() {
    let local = site();
    let remote = site_files::parse_manifest("aaa index.html\nzzz js/main.js\n");
    let sending: Vec<&str> = site_files::changed(&local, &remote)
        .iter()
        .map(|entry| entry.rel.as_str())
        .collect();
    assert_eq!(sending, vec!["js/main.js", "new.png"]);

    // A manifest nobody can read means send everything, rather than fail.
    let none = site_files::parse_manifest("garbage\n");
    assert_eq!(site_files::changed(&local, &none).len(), 3);
}

/// Three files, two of which the far end already has one version of.
fn site() -> Vec<site_files::Entry> {
    vec![
        site_files::Entry { rel: "index.html".into(), hash: "aaa".into(), size: 3 },
        site_files::Entry { rel: "js/main.js".into(), hash: "bbb".into(), size: 3 },
        site_files::Entry { rel: "new.png".into(), hash: "ccc".into(), size: 3 },
    ]
}

/// A publish can send a subset — that is the whole point of the two panes —
/// and the ticks are obeyed exactly rather than being a hint on top of the
/// hash comparison.
#[test]
fn a_selection_is_what_gets_sent() {
    let local = site();
    let remote = site_files::parse_manifest("aaa index.html\nzzz js/main.js\n");

    // Nobody touched the list: everything that differs.
    let default: Vec<&str> = site_files::selected(&local, &remote, None)
        .iter()
        .map(|e| e.rel.as_str())
        .collect();
    assert_eq!(default, vec!["js/main.js", "new.png"]);

    // Ticked: exactly those, including one the comparison calls unchanged —
    // somebody asking for a file to be re-sent is somebody who has a reason.
    let picked = vec!["index.html".to_string(), "new.png".to_string()];
    let chosen: Vec<&str> = site_files::selected(&local, &remote, Some(&picked))
        .iter()
        .map(|e| e.rel.as_str())
        .collect();
    assert_eq!(chosen, vec!["index.html", "new.png"]);

    // A path the site no longer has came from a list drawn before a rebuild.
    let stale = vec!["gone.js".to_string()];
    assert!(site_files::selected(&local, &remote, Some(&stale)).is_empty());
}

/// The manifest has to describe what is *actually* at the far end after a
/// partial publish. Writing the whole site's hashes after sending two files
/// would tell the next publish that files it never sent are already there,
/// which is the one way a manifest causes a wrong site rather than a slow one.
#[test]
fn the_manifest_follows_what_was_really_sent() {
    let local = site();
    let previous = site_files::parse_manifest("aaa index.html\nzzz js/main.js\nddd old.css\n");
    let picked = vec!["js/main.js".to_string()];
    let sending = site_files::selected(&local, &previous, Some(&picked));

    let next = site_files::next_manifest(&previous, &sending, &["old.css".to_string()]);
    assert_eq!(next.get("js/main.js"), Some(&"bbb".to_string()), "sent, so updated");
    assert_eq!(next.get("index.html"), Some(&"aaa".to_string()), "untouched, so kept");
    assert_eq!(next.get("old.css"), None, "removed, so gone");
    assert_eq!(next.get("new.png"), None, "never sent, so never claimed");
}

/// GitHub's tree listing carries git blob ids, so the local side has to be
/// hashed the same way or every file looks changed for ever — which reads as
/// the comparison simply not working.
#[test]
fn a_local_file_hashes_the_way_git_would() {
    // `git hash-object` of an empty file, and of "hello\n". Both are fixed
    // values anybody can check with git itself.
    assert_eq!(compare::blob_id(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    assert_eq!(compare::blob_id(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
}

/// Hashed rather than compared by size and time, because the staging directory
/// is written fresh for every publish: every file's modified time is *now* and
/// says nothing at all.
#[test]
fn a_scan_hashes_every_file_and_sorts_them() {
    let meta = project("Scanning");
    let result = std::panic::catch_unwind(|| {
        let root = deploy::staging_dir(&meta.id).expect("staging should be made");
        let site = root.join("site");
        std::fs::create_dir_all(site.join("js")).expect("dirs should make");
        std::fs::write(site.join("js/main.js"), "one").expect("write");
        std::fs::write(site.join("index.html"), "two").expect("write");

        let scanned = site_files::scan(&site).expect("site should scan");
        let names: Vec<&str> = scanned.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(names, vec!["index.html", "js/main.js"]);
        assert_eq!(scanned[0].hash.len(), 64, "sha-256, hex");
        assert_ne!(scanned[0].hash, scanned[1].hash);
        assert_eq!(scanned[0].size, 3, "the size the pane shows");

        // One byte different is a different file.
        std::fs::write(site.join("index.html"), "twp").expect("write");
        let again = site_files::scan(&site).expect("site should scan");
        assert_ne!(again[0].hash, scanned[0].hash);

        let _ = std::fs::remove_dir_all(&root);
    });
    store::delete_project(&meta.id).ok();
    result.expect("scanning should not panic");
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

/// libgit2 quotes the remote in some of its messages. The token is never in a
/// URL or a command line any more — there is no command line — and this is the
/// check on that, because the one place a leak would land is a log line
/// somebody then pastes into an issue.
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
