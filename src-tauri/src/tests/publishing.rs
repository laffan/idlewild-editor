//! A GitHub publish, end to end, without GitHub.
//!
//! A bare repository in a temporary directory is a perfectly good git remote,
//! so every step of `deploy_github` can be driven against one: starting a
//! branch that does not exist, committing onto one that does, sending a
//! subset, removing a file, and noticing that nothing changed. What is left
//! out is the network and the token — which is to say the parts that were
//! never the risk. The risk was the git, and the git was verified by reading.
//!
//! `deploy_github::publish_into` exists for this: `push` computes a URL from
//! an owner and a repository name, and that is the only thing in the path that
//! has to be github.com.

use crate::project::{PublishTarget, TargetKind};
use crate::publish_targets::Github;
use crate::{deploy_github, store};

/// A scratch directory of this test's own, removed when it is dropped.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("idlewild-publish-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch should be made");
        Scratch(dir)
    }
    fn join(&self, rel: &str) -> std::path::PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A remote to publish to: a bare repository, as empty as a new one on GitHub.
fn remote(at: &std::path::Path) -> String {
    git2::Repository::init_bare(at).expect("bare repo should init");
    at.to_string_lossy().to_string()
}

/// A site on disk, as `deploy::stage` would have written one.
fn site(at: &std::path::Path, files: &[(&str, &str)]) {
    for (rel, body) in files {
        let path = at.join(rel);
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("dirs");
        std::fs::write(path, body).expect("write");
    }
}

fn account() -> Github {
    Github {
        id: "a1".into(),
        login: "tester".into(),
        // Never used: a local path remote asks for no credentials, which is
        // exactly why this can run anywhere.
        token: String::new(),
    }
}

fn target(path: &str) -> PublishTarget {
    PublishTarget {
        kind: TargetKind::Github,
        owner: "tester".into(),
        repo: "site".into(),
        path: path.into(),
        ..Default::default()
    }
}

/// What is on a branch of the bare repository, as a sorted list of paths.
fn on_branch(url: &str, branch: &str) -> Vec<String> {
    let repo = git2::Repository::open(url).expect("remote should open");
    let reference = repo
        .find_reference(&format!("refs/heads/{branch}"))
        .unwrap_or_else(|_| panic!("{branch} should exist on the remote"));
    let tree = reference.peel_to_tree().expect("a tree");
    let mut out = Vec::new();
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            out.push(format!("{dir}{}", entry.name().unwrap_or("")));
        }
        git2::TreeWalkResult::Ok
    })
    .expect("walk");
    out.sort();
    out
}

fn body_on_branch(url: &str, branch: &str, rel: &str) -> String {
    let repo = git2::Repository::open(url).expect("remote should open");
    let tree = repo
        .find_reference(&format!("refs/heads/{branch}"))
        .expect("branch")
        .peel_to_tree()
        .expect("tree");
    let entry = tree.get_path(std::path::Path::new(rel)).expect("that file");
    let blob = repo.find_blob(entry.id()).expect("a blob");
    String::from_utf8_lossy(blob.content()).to_string()
}

fn publish(
    url: &str,
    branch: &str,
    target: &PublishTarget,
    site_dir: &std::path::Path,
    work: &std::path::Path,
    chosen: Option<&[String]>,
    remove: &[String],
) -> Result<crate::deploy::Report, String> {
    // A fresh clone directory per publish, as `deploy` gives it.
    let _ = std::fs::remove_dir_all(work);
    deploy_github::publish_into(
        url,
        branch,
        &account(),
        target,
        site_dir,
        "Nine Roads",
        work,
        chosen,
        remove,
        &|_| {},
    )
}

/// The case the whole feature was blocked on: publishing to a branch that is
/// not there yet. It is how a fresh `gh-pages` gets made, and it is the first
/// thing anybody does.
#[test]
fn a_branch_that_does_not_exist_is_created_by_the_first_publish() {
    let scratch = Scratch::new("new-branch");
    let url = remote(&scratch.join("remote.git"));
    site(
        &scratch.join("site"),
        &[("index.html", "<h1>one</h1>"), ("js/main.js", "start()")],
    );

    let report = publish(
        &url,
        "gh-pages",
        &target(""),
        &scratch.join("site"),
        &scratch.join("work"),
        None,
        &[],
    )
    .expect("publishing to a new branch should work");

    assert!(report.summary.contains("a new branch"), "{}", report.summary);
    assert_eq!(on_branch(&url, "gh-pages"), vec!["index.html", "js/main.js"]);
}

/// **The case a person actually starts from**: a repository that already has a
/// `main` with source on it, publishing to a `gh-pages` that does not exist.
///
/// Different from the empty-repository case in the way that matters — the
/// clone of `gh-pages` fails against a remote that *is* reachable and *does*
/// have refs, so the fallback has to start an unrelated history and push it
/// as a new branch beside one it knows nothing about.
#[test]
fn a_new_branch_can_be_started_beside_an_existing_one() {
    let scratch = Scratch::new("beside");
    let url = remote(&scratch.join("remote.git"));

    // Somebody's source, on main.
    let source = scratch.join("source");
    site(&source, &[("README.md", "the source"), ("src/main.rs", "fn main() {}")]);
    publish(&url, "main", &target(""), &source, &scratch.join("work"), None, &[])
        .expect("seeding main");

    // The site, onto a branch that is not there.
    let game = scratch.join("site");
    site(&game, &[("index.html", "<h1>game</h1>")]);
    let report = publish(&url, "gh-pages", &target(""), &game, &scratch.join("work"), None, &[])
        .expect("publishing to a new branch beside main should work");

    assert!(report.summary.contains("a new branch"), "{}", report.summary);
    assert_eq!(on_branch(&url, "gh-pages"), vec!["index.html"]);
    // And main is untouched, which is the whole point of not force-pushing.
    assert_eq!(on_branch(&url, "main"), vec!["README.md", "src/main.rs"]);
}

/// Publishing again to that new branch — the second publish on a history this
/// app started, beside one it did not.
#[test]
fn a_started_branch_can_be_published_to_again() {
    let scratch = Scratch::new("beside-twice");
    let url = remote(&scratch.join("remote.git"));
    let source = scratch.join("source");
    site(&source, &[("README.md", "the source")]);
    publish(&url, "main", &target(""), &source, &scratch.join("work"), None, &[])
        .expect("seeding main");

    let game = scratch.join("site");
    site(&game, &[("index.html", "<h1>one</h1>")]);
    publish(&url, "gh-pages", &target(""), &game, &scratch.join("work"), None, &[])
        .expect("first");

    site(&game, &[("index.html", "<h1>two</h1>")]);
    publish(&url, "gh-pages", &target(""), &game, &scratch.join("work"), None, &[])
        .expect("second");

    assert_eq!(body_on_branch(&url, "gh-pages", "index.html"), "<h1>two</h1>");
    assert_eq!(on_branch(&url, "main"), vec!["README.md"]);
}

/// And the second time, onto the branch the first one made — committing on top
/// rather than replacing it, which is the promise the whole design rests on.
#[test]
fn a_second_publish_commits_on_top_of_the_first() {
    let scratch = Scratch::new("second");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");
    site(&site_dir, &[("index.html", "<h1>one</h1>")]);
    publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("first publish");

    site(&site_dir, &[("index.html", "<h1>two</h1>"), ("extra.css", "body{}")]);
    let report = publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("second publish");

    assert!(!report.summary.contains("a new branch"), "{}", report.summary);
    assert_eq!(on_branch(&url, "gh-pages"), vec!["extra.css", "index.html"]);
    assert_eq!(body_on_branch(&url, "gh-pages", "index.html"), "<h1>two</h1>");

    // History rather than a replacement: two commits, the second on the first.
    let repo = git2::Repository::open(&url).expect("remote");
    let head = repo
        .find_reference("refs/heads/gh-pages")
        .expect("branch")
        .peel_to_commit()
        .expect("commit");
    assert_eq!(head.parent_count(), 1, "the second publish builds on the first");
}

/// Publishing into a directory of a repository leaves everything outside it
/// alone — which is the reason the path field exists.
#[test]
fn a_path_leaves_the_rest_of_the_branch_alone() {
    let scratch = Scratch::new("path");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");

    // Something already on the branch, outside the path being published into.
    site(&site_dir, &[("README.md", "the source")]);
    publish(&url, "main", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("seed");

    let game = scratch.join("game-site");
    site(&game, &[("index.html", "<h1>game</h1>")]);
    publish(&url, "main", &target("docs"), &game, &scratch.join("work"), None, &[])
        .expect("publish into docs/");

    assert_eq!(on_branch(&url, "main"), vec!["README.md", "docs/index.html"]);
}

/// The two panes are only meaningful if the ticks are obeyed at the far end.
#[test]
fn only_the_chosen_files_are_committed() {
    let scratch = Scratch::new("subset");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");
    site(&site_dir, &[("a.txt", "one"), ("b.txt", "one")]);
    publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("first publish");

    // Both change; only one is ticked.
    site(&site_dir, &[("a.txt", "two"), ("b.txt", "two")]);
    publish(
        &url,
        "gh-pages",
        &target(""),
        &site_dir,
        &scratch.join("work"),
        Some(&["a.txt".to_string()]),
        &[],
    )
    .expect("second publish");

    assert_eq!(body_on_branch(&url, "gh-pages", "a.txt"), "two");
    assert_eq!(
        body_on_branch(&url, "gh-pages", "b.txt"),
        "one",
        "a file nobody ticked is a file nobody sent"
    );
}

/// And a removal ticked on the left pane actually takes the file away.
#[test]
fn a_removal_takes_the_file_off_the_branch() {
    let scratch = Scratch::new("removal");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");
    site(&site_dir, &[("keep.txt", "one"), ("drop.txt", "one")]);
    publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("first publish");

    let smaller = scratch.join("smaller");
    site(&smaller, &[("keep.txt", "one")]);
    publish(
        &url,
        "gh-pages",
        &target(""),
        &smaller,
        &scratch.join("work"),
        None,
        &["drop.txt".to_string()],
    )
    .expect("second publish");

    assert_eq!(on_branch(&url, "gh-pages"), vec!["keep.txt"]);
}

/// Publishing a site that has not changed is not a failure, and not an empty
/// commit either.
#[test]
fn nothing_to_do_is_said_rather_than_committed() {
    let scratch = Scratch::new("unchanged");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");
    site(&site_dir, &[("index.html", "<h1>one</h1>")]);
    publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("first publish");

    let report = publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("second publish");
    assert!(report.summary.contains("already up to date"), "{}", report.summary);

    let repo = git2::Repository::open(&url).expect("remote");
    let head = repo
        .find_reference("refs/heads/gh-pages")
        .expect("branch")
        .peel_to_commit()
        .expect("commit");
    assert_eq!(head.parent_count(), 0, "no second commit was made");
}

/// A `.gitignore` on the branch must not decide what a *site publish*
/// contains. A rule saying `assets/` would otherwise publish a game with no
/// artwork in it and tell nobody.
#[test]
fn an_ignore_rule_on_the_branch_does_not_drop_the_site() {
    let scratch = Scratch::new("ignore");
    let url = remote(&scratch.join("remote.git"));
    let site_dir = scratch.join("site");
    site(
        &site_dir,
        &[(".gitignore", "assets/\n"), ("assets/sprite.png", "not really a png")],
    );

    publish(&url, "gh-pages", &target(""), &site_dir, &scratch.join("work"), None, &[])
        .expect("publish");

    assert_eq!(
        on_branch(&url, "gh-pages"),
        vec![".gitignore", "assets/sprite.png"],
        "the site is what is published, ignore rules included"
    );
    let _ = store::app_data_dir();
}
