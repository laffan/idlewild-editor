//! Publishing to GitHub: the site, committed onto a branch of a repository.
//!
//! **libgit2, linked in, rather than the `git` program.** That is the whole
//! difference from the first version of this file and it is what makes the
//! iPad work. iOS does not let a third-party app create a child process —
//! `fork`, `exec` and `posix_spawn` are denied by the sandbox and
//! `Foundation.Process` is not in the SDK — so running `git` there is
//! genuinely impossible and always will be. Running *git* is not: libgit2 is
//! the reusable C library that is git's core, `libgit2-sys` vendors it and
//! builds it for whatever target Cargo is pointed at, and it defines
//! `GIT_SECURE_TRANSPORT` for any target containing `apple`, so an iOS build
//! uses the system TLS stack. This is what Working Copy does, through
//! objective-git, and it is what a-Shell does in general: link the
//! functionality, do not spawn the tool.
//!
//! ## It commits onto the branch, it does not replace it
//!
//! The quick version of "publish a built site to GitHub" is to make a
//! repository out of the output directory and force-push it. Every static-site
//! deploy script does this, and it works right up until somebody types `main`
//! into the branch box — at which point their source is gone from the tip of
//! their default branch because a game editor decided to.
//!
//! So instead: **shallow-clone the branch, replace what is at the target path,
//! commit, push.** No history is rewritten, nothing outside the path being
//! published is touched, and a mistake is one `git revert` away rather than one
//! reflog away. A branch that does not exist yet is started from nothing, which
//! is what makes a fresh `gh-pages` work.
//!
//! ## The index is built with `FORCE`, on purpose
//!
//! `git add -A` — which is what this used to run — honours `.gitignore`. For a
//! *site publish* that is a trap rather than a feature: a `.gitignore` on the
//! branch saying `assets/` would silently publish a game with no artwork in it,
//! and nothing would report anything. What is staged here is exactly what the
//! site is, ignore rules included.
//!
//! ## The token
//!
//! It goes to libgit2 through a credentials callback as
//! `x-access-token:<token>`, which is GitHub's own scheme for a PAT over
//! HTTPS. It is never part of a URL and never part of a command line, because
//! there is no command line any more. `deploy::redact` still guards anything
//! reported back, since libgit2 quotes the remote in some of its messages.

use crate::deploy::{redact, tail, Report};
use crate::project::PublishTarget;
use crate::publish_targets::Github;
use git2::build::RepoBuilder;
use git2::{Cred, FetchOptions, PushOptions, RemoteCallbacks, Repository, Signature};
use std::path::{Path, PathBuf};

/// Check the repository and the branch are reachable, and write nothing.
///
/// Deliberately **not** a flag on `push`: a rehearsal does not need the site,
/// and staging tens of megabytes to then ask one question over the network
/// would make "Check it first" the slow half of the pair. The server half is
/// the other way round — it compares file lists, so it does need the site —
/// which is why the two are routed separately in `deploy::publish_to_target`.
pub fn check(account: &Github, target: &PublishTarget) -> Result<Report, String> {
    let (url, branch) = address(target)?;
    let mut remote = git2::Remote::create_detached(url.as_str())
        .map_err(|e| format!("Cannot reach {url}: {e}"))?;

    let mut callbacks = RemoteCallbacks::new();
    let token = account.token.clone();
    callbacks.credentials(move |_, _, _| Cred::userpass_plaintext("x-access-token", &token));

    remote
        .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
        .map_err(|e| reachability(&e, target, &redact(e.message(), &account.token)))?;
    let wanted = format!("refs/heads/{branch}");
    let exists = remote
        .list()
        .map_err(|e| redact(e.message(), &account.token))?
        .iter()
        .any(|head| head.name() == wanted);
    let _ = remote.disconnect();

    Ok(Report {
        summary: format!("Would publish to {}", target.describe()),
        log: if exists {
            format!("{branch} is there and reachable with the token stored.")
        } else {
            format!("Reachable. {branch} does not exist yet — publishing starts it.")
        },
        dry_run: true,
    })
}

pub fn push(
    account: &Github,
    target: &PublishTarget,
    site: &Path,
    project_name: &str,
    work: &Path,
) -> Result<Report, String> {
    let (url, branch) = address(target)?;
    let inside = checked_path(&target.path)?;

    let (repo, existed) = open(&url, &branch, work, account)?;
    replace(work, &inside, site)?;

    let tree_id = stage(&repo).map_err(|e| redact(e.message(), &account.token))?;
    let parent = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok());

    // Compared against the parent's tree rather than asked of `status`: two
    // commits with the same tree is exactly what "nothing changed" means, and
    // a publish that reported a failure because the site had not changed is a
    // publish nobody trusts.
    if parent.as_ref().map(|commit| commit.tree_id()) == Some(tree_id) {
        return Ok(Report {
            summary: format!("{} is already up to date", target.describe()),
            log: "Nothing in the site had changed since the last publish.".into(),
            dry_run: false,
        });
    }

    let message = format!("Publish {project_name} from Idlewild");
    commit(&repo, tree_id, parent.as_ref(), account, &message)
        .map_err(|e| redact(e.message(), &account.token))?;
    send(&repo, &url, &branch, account)?;

    Ok(Report {
        summary: format!(
            "Published to {}{}",
            target.describe(),
            if existed { "" } else { " — a new branch" }
        ),
        log: tail(
            &format!(
                "Committed as \"{message}\" and pushed to {branch}.\n\
                 Everything at that path is now what the site has."
            ),
            20,
        ),
        dry_run: false,
    })
}

// ── the repository ──────────────────────────────────────────────────────────

/// The branch as it stands, or an empty repository to start it from.
///
/// Answers whether the branch was already there, which is the difference
/// between "published" and "published, and started a branch" — worth saying,
/// because a typo in a branch name otherwise looks exactly like a successful
/// publish to a place nobody will look.
fn open(
    url: &str,
    branch: &str,
    work: &Path,
    account: &Github,
) -> Result<(Repository, bool), String> {
    let mut builder = RepoBuilder::new();
    builder.branch(branch);
    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(auth(account));
    // One commit's worth. The branch's history is not what is being published
    // and a site's worth of assets is not something to download twice.
    fetch.depth(1);
    builder.fetch_options(fetch);

    if let Ok(repo) = builder.clone(url, work) {
        return Ok((repo, true));
    }

    // No such branch, or a repository with no commits in it at all. Either way
    // what is wanted is a branch of this name starting here; a failure that was
    // really about the token or the network surfaces from the push instead,
    // with the message libgit2 gives it.
    if work.exists() {
        std::fs::remove_dir_all(work).map_err(|e| e.to_string())?;
    }
    let repo = Repository::init(work).map_err(|e| e.message().to_string())?;
    repo.set_head(&format!("refs/heads/{branch}"))
        .map_err(|e| e.message().to_string())?;
    Ok((repo, false))
}

/// Everything in the working tree, staged, and the tree that makes.
///
/// Cleared first so a file the site no longer has leaves the index with it:
/// `add_all` only ever adds, and a publish that could not delete would leave a
/// removed scene's artwork being served for good.
fn stage(repo: &Repository) -> Result<git2::Oid, git2::Error> {
    let mut index = repo.index()?;
    index.clear()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::FORCE, None)?;
    index.write()?;
    index.write_tree()
}

fn commit(
    repo: &Repository,
    tree_id: git2::Oid,
    parent: Option<&git2::Commit>,
    account: &Github,
    message: &str,
) -> Result<(), git2::Error> {
    let tree = repo.find_tree(tree_id)?;
    // GitHub's own no-reply address for the account, so a published commit is
    // attributed without publishing anybody's email.
    let name = if account.login.is_empty() { "Idlewild" } else { &account.login };
    let email = format!(
        "{}@users.noreply.github.com",
        if account.login.is_empty() { "idlewild" } else { &account.login }
    );
    let who = Signature::now(name, &email)?;
    let parents: Vec<&git2::Commit> = parent.into_iter().collect();
    repo.commit(Some("HEAD"), &who, &who, message, &tree, &parents)?;
    Ok(())
}

fn send(repo: &Repository, url: &str, branch: &str, account: &Github) -> Result<(), String> {
    let mut remote = repo
        .remote_anonymous(url)
        .map_err(|e| redact(e.message(), &account.token))?;
    let mut options = PushOptions::new();
    options.remote_callbacks(auth(account));
    // `HEAD:refs/heads/<branch>` rather than the branch name on its own, so a
    // branch that does not exist at the far end is created rather than being
    // an error about a missing upstream. No leading `+`: this is a commit on
    // top of what is there, and a push that has to be forced is a push that is
    // about to lose something.
    let spec = format!("HEAD:refs/heads/{branch}");
    remote
        .push(&[spec.as_str()], Some(&mut options))
        .map_err(|e| push_failure(&e, branch, &redact(e.message(), &account.token)))
}

/// The credentials callback, which is how the token reaches libgit2.
///
/// `x-access-token` as the user is GitHub's own scheme for a personal access
/// token over HTTPS. Nothing here is a URL and nothing here is a command line,
/// which is the point: there is no `ps` output to leak into.
fn auth(account: &Github) -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    let token = account.token.clone();
    callbacks.credentials(move |_, _, allowed| {
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            Cred::userpass_plaintext("x-access-token", &token)
        } else {
            Cred::default()
        }
    });
    callbacks
}

// ── the working tree ────────────────────────────────────────────────────────

/// Put the site where the target says, replacing what was there.
///
/// Replacing rather than merging: a file the site no longer has is a file that
/// should stop being served, and a publish that only ever adds leaves a deleted
/// scene's assets live for good. What is *not* touched is anything outside the
/// path being published to — which is the reason the path exists.
fn replace(work: &Path, inside: &Path, site: &Path) -> Result<(), String> {
    let dest = work.join(inside);
    if inside.as_os_str().is_empty() {
        // The repository root. Everything goes except `.git`, which is the
        // clone itself — removing it would take the branch's history with it.
        for entry in std::fs::read_dir(work).map_err(|e| e.to_string())?.flatten() {
            if entry.file_name() == ".git" {
                continue;
            }
            let path = entry.path();
            let removed = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            removed.map_err(|e| format!("Cannot clear {}: {e}", path.display()))?;
        }
    } else if dest.exists() {
        std::fs::remove_dir_all(&dest)
            .map_err(|e| format!("Cannot clear {}: {e}", dest.display()))?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    crate::store::copy_dir(site, &dest)
}

// ── what a target is allowed to be ──────────────────────────────────────────

/// The URL and the branch, both checked.
fn address(target: &PublishTarget) -> Result<(String, String), String> {
    let owner = checked(&target.owner, "owner")?;
    let repo = checked(target.repo.trim_end_matches(".git"), "repository")?;
    let branch = checked_branch(target.branch_or_default())?;
    Ok((format!("https://github.com/{owner}/{repo}.git"), branch))
}

/// A connection failure, said in terms of what somebody can do about it.
///
/// libgit2's own message for a bad token is a 401 with the URL in it, which
/// tells nobody which of the three likely things went wrong.
fn reachability(error: &git2::Error, target: &PublishTarget, message: &str) -> String {
    if error.code() == git2::ErrorCode::Auth || message.contains("401") {
        return format!(
            "GitHub would not accept the token for {}/{}. It needs Contents \
             write on that repository, and a fine-grained token has to list it \
             explicitly.",
            target.owner, target.repo
        );
    }
    if message.contains("404") || error.code() == git2::ErrorCode::NotFound {
        return format!(
            "{}/{} is not a repository this token can see. A private one needs \
             the token to have been given access to it.",
            target.owner, target.repo
        );
    }
    format!("Cannot reach {}/{}: {message}", target.owner, target.repo)
}

/// A rejected push, which nearly always means one thing.
fn push_failure(error: &git2::Error, branch: &str, message: &str) -> String {
    if message.contains("non-fast-forward") || message.contains("fetch first") {
        return format!(
            "{branch} moved at the far end while this publish was being \
             prepared. Nothing was lost — publish again and it will build on \
             what is there now."
        );
    }
    if error.code() == git2::ErrorCode::Auth {
        return format!(
            "GitHub accepted the connection but refused the push to {branch}. \
             The token needs Contents write, not just read."
        );
    }
    format!("Could not push to {branch}: {message}")
}

/// An owner or repository name, as GitHub itself allows one.
pub(crate) fn checked(raw: &str, what: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("Name the {what}"));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || trimmed.starts_with('-')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err(format!("{trimmed} is not a GitHub {what} name"));
    }
    Ok(trimmed.to_string())
}

/// A branch name, by git's own rules — the ones that matter here.
pub(crate) fn checked_branch(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Name the branch to publish to".into());
    }
    let illegal = [' ', '~', '^', ':', '?', '*', '[', '\\', '\t'];
    if trimmed.starts_with('-')
        || trimmed.starts_with('/')
        || trimmed.ends_with('/')
        || trimmed.ends_with(".lock")
        || trimmed.contains("..")
        || trimmed.contains("@{")
        || trimmed.chars().any(|c| illegal.contains(&c) || c.is_control())
    {
        return Err(format!("{trimmed} is not a branch name git will take"));
    }
    Ok(trimmed.to_string())
}

/// The directory inside the repository, or nothing for its root.
///
/// Through the same guard every relative path in this app goes through: this
/// one is joined to a clone the app is about to delete things inside.
pub(crate) fn checked_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok(PathBuf::new());
    }
    crate::store::safe_relative(trimmed)
}
