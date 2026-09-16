//! Publishing to GitHub: the site, committed onto a branch of a repository.
//!
//! `git` is run as a program — see `deploy.rs` for why, and for what a publish
//! must never do. What is worth reading here is the shape of the operation,
//! because there are two obvious ways to do this and one of them is a
//! footgun.
//!
//! ## It commits onto the branch, it does not replace the branch
//!
//! The quick version of "publish a built site to GitHub" is: make a repository
//! out of the output directory and force-push it. Every static-site deploy
//! script does this, and it works right up until somebody types `main` into the
//! branch box — at which point their source is gone from the tip of their
//! default branch because a game editor decided to.
//!
//! So instead: **shallow-clone the branch, replace what is at the target path,
//! commit, push.** No history is rewritten, nothing outside the path being
//! published is touched, and a mistake is one `git revert` away rather than one
//! reflog away. A branch that does not exist yet is started from nothing, which
//! is what makes a fresh `gh-pages` work.
//!
//! The default branch is `gh-pages` (`PublishTarget::branch_or_default`) for the
//! same reason: it is the branch whose whole job is to be a built site, and the
//! alternative default is the one holding somebody's source.
//!
//! ## The token reaches git through the environment
//!
//! Not through the URL. `https://token@github.com/…` is the usual trick and it
//! puts the secret in argv, in `ps`, and in half of git's own error messages —
//! git echoes the remote back at you whenever it cannot reach it. Here the URL
//! is plain, the token is an environment variable, and a one-line credential
//! helper reads it. `credential.helper=` is reset to empty first so the
//! platform's own keychain helper does not answer ahead of it with somebody
//! else's account.

use crate::deploy::{redact, run, tail, Report};
use crate::project::PublishTarget;
use crate::publish_targets::Github;
use std::path::{Path, PathBuf};

/// The environment variable the credential helper below reads.
const TOKEN_VAR: &str = "IDLEWILD_GH_TOKEN";

/// Check the repository and the branch are reachable, and write nothing.
///
/// Deliberately **not** a flag on `push`: a rehearsal of a GitHub publish does
/// not need the site, and staging tens of megabytes to then ask one question
/// over the network would make "Check it first" the slow half of the pair.
/// rsync's rehearsal is the other way round — it compares file lists, so it
/// does need the site — which is why the two are routed separately in
/// `deploy::publish_to_target`.
pub fn check(account: &Github, target: &PublishTarget) -> Result<Report, String> {
    let owner = checked(&target.owner, "owner")?;
    let repo = checked(target.repo.trim_end_matches(".git"), "repository")?;
    let branch = checked_branch(target.branch_or_default())?;
    let url = format!("https://github.com/{owner}/{repo}.git");
    rehearse(&url, &branch, &environment(account), account, target)
}

pub fn push(
    account: &Github,
    target: &PublishTarget,
    site: &Path,
    project_name: &str,
    work: &Path,
) -> Result<Report, String> {
    let owner = checked(&target.owner, "owner")?;
    let repo = checked(target.repo.trim_end_matches(".git"), "repository")?;
    let branch = checked_branch(target.branch_or_default())?;
    let inside = checked_path(&target.path)?;
    let url = format!("https://github.com/{owner}/{repo}.git");
    let env = environment(account);

    // The branch as it stands, or an empty repository to start it from.
    let existed = clone(&url, &branch, work, &env, account)?;
    replace(work, &inside, site)?;

    let git = |args: &[&str]| -> Result<String, String> {
        run("git", &git_args(args), &env, Some(work)).map_err(|e| redact(&e, &account.token))
    };

    git(&["add", "-A"])?;
    // `--porcelain` with nothing staged prints nothing, which is the one
    // reliable way to ask git whether there is anything to commit — `commit`
    // itself fails in that case, and a publish that reports a failure because
    // nothing had changed would be a publish nobody trusts.
    if git(&["status", "--porcelain"])?.trim().is_empty() {
        return Ok(Report {
            summary: format!("{} is already up to date", target.describe()),
            log: "Nothing in the site had changed since the last publish.".into(),
            dry_run: false,
        });
    }

    let author = format!("user.name={}", author_name(account));
    let email = format!("user.email={}", author_email(account));
    let message = format!("Publish {project_name} from Idlewild");
    git(&["-c", &author, "-c", &email, "commit", "-m", &message])?;

    // `HEAD:refs/heads/<branch>` rather than the branch name on its own, so a
    // branch that does not exist at the far end is created rather than being
    // an error about a missing upstream.
    let spec = format!("HEAD:refs/heads/{branch}");
    let output = git(&["push", &url, &spec])?;

    Ok(Report {
        summary: format!(
            "Published to {}{}",
            target.describe(),
            if existed { "" } else { " — a new branch" }
        ),
        log: tail(&output, 20),
        dry_run: false,
    })
}

/// Check the repository and the branch without writing anything.
///
/// `ls-remote` is the whole test: it needs the token to be valid, the account
/// to be able to see the repository, and the network to be there — which is
/// every way a publish fails that is not about the site itself.
fn rehearse(
    url: &str,
    branch: &str,
    env: &[(&str, String)],
    account: &Github,
    target: &PublishTarget,
) -> Result<Report, String> {
    let output = run("git", &git_args(&["ls-remote", "--heads", url, branch]), env, None)
        .map_err(|e| redact(&e, &account.token))?;
    let exists = output.contains(&format!("refs/heads/{branch}"));
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

/// The branch, shallow, or an empty repository when there is no such branch.
///
/// Answers whether the branch was already there, which is the difference
/// between "published" and "published, and started a branch" — worth saying,
/// because a typo in a branch name otherwise looks exactly like a successful
/// publish to a place nobody will look.
fn clone(
    url: &str,
    branch: &str,
    work: &Path,
    env: &[(&str, String)],
    account: &Github,
) -> Result<bool, String> {
    let into = work.to_string_lossy().to_string();
    let args = git_args(&[
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        branch,
        url,
        &into,
    ]);

    if run("git", &args, env, None).is_ok() {
        return Ok(true);
    }

    // No such branch, or a repository with no commits in it at all. Either way
    // what is wanted is a branch of this name starting here. A failure that was
    // really about the token or the network surfaces from the push instead,
    // with the message git gives it.
    if work.exists() {
        std::fs::remove_dir_all(work).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(work).map_err(|e| e.to_string())?;
    run("git", &git_args(&["init", "-q"]), env, Some(work))
        .map_err(|e| redact(&e, &account.token))?;
    run("git", &git_args(&["checkout", "-q", "-b", branch]), env, Some(work))
        .map_err(|e| redact(&e, &account.token))?;
    Ok(false)
}

/// Put the site where the target says, replacing what was there.
///
/// Replacing rather than merging: a file the site no longer has is a file that
/// should stop being served, and a publish that only ever adds leaves a
/// deleted scene's assets live for good. What is *not* touched is anything
/// outside the path being published to — which is the reason the path exists.
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

/// The token, and the two settings that keep git from asking a person
/// something nobody can answer.
fn environment(account: &Github) -> Vec<(&'static str, String)> {
    vec![
        (TOKEN_VAR, account.token.clone()),
        // No prompt on a terminal that is not there. Without it a bad token
        // means a publish that hangs rather than one that fails.
        ("GIT_TERMINAL_PROMPT", "0".to_string()),
        // And the same for the desktop askpass helpers, which would otherwise
        // put a system password box in front of the app.
        ("GIT_ASKPASS", String::new()),
        ("SSH_ASKPASS", String::new()),
    ]
}

/// A git command line, with the credential configuration in front of it.
///
/// The first `-c credential.helper=` is an *empty* helper, which resets the
/// chain: without it macOS's keychain helper answers first and a publish goes
/// out as whichever GitHub account that machine last used in a terminal. The
/// second reads the token out of the environment — git runs a helper beginning
/// with `!` through a shell, and `$IDLEWILD_GH_TOKEN` is expanded there rather
/// than here, so the secret is never a string in this program's argv.
///
/// In front of the subcommand rather than after it, because that is where git
/// takes `-c`. It is carried by the local commands as well as the remote ones:
/// they ignore it, and a list of which git subcommands happen to touch the
/// network is a list that goes stale.
fn git_args(args: &[&str]) -> Vec<String> {
    let mut out = vec![
        "-c".to_string(),
        "credential.helper=".to_string(),
        "-c".to_string(),
        format!(
            "credential.helper=!f() {{ echo username=x-access-token; echo password=${TOKEN_VAR}; }}; f"
        ),
    ];
    out.extend(args.iter().map(|arg| arg.to_string()));
    out
}

/// The name on the commit.
fn author_name(account: &Github) -> String {
    if account.login.is_empty() {
        "Idlewild".to_string()
    } else {
        account.login.clone()
    }
}

/// GitHub's own no-reply address for the account, so a published commit is
/// attributed without publishing anybody's email.
fn author_email(account: &Github) -> String {
    if account.login.is_empty() {
        "idlewild@users.noreply.github.com".to_string()
    } else {
        format!("{}@users.noreply.github.com", account.login)
    }
}

/// An owner or repository name, as GitHub itself allows one.
///
/// Checked rather than trusted because both reach a URL and a command line. A
/// slash here would silently publish to a different repository than the two
/// boxes say.
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
