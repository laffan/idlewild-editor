//! The two questions about GitHub that libgit2 cannot answer.
//!
//! `deploy_github` does the git: clone a branch, commit onto it, push. That is
//! all git knows how to do, and neither of these is a git operation:
//!
//! - **Which repositories can this token see?** The publish sheet opens with a
//!   searchable list of them rather than two boxes to type an owner and a name
//!   into, because a name typed from memory is a name typed wrong, and the
//!   failure arrives at the far end of a network round trip.
//! - **What is on that branch right now?** Publishing shows what is already
//!   there beside what is here. Answering that by cloning would mean fetching
//!   a site's worth of assets to list their names.
//!
//! Both are the REST API, over `ureq`. Blocking, which is right: every caller
//! is already inside `spawn_blocking` for libgit2's sake.
//!
//! **The token never leaves Rust**, here as everywhere else in this feature.
//! It goes out as an `Authorization` header and comes back in nothing: the
//! views returned carry names, not credentials.
//!
//! **A failure is said in terms of what to do about it.** GitHub answers 401
//! for a token that is wrong and 403 for one that is right and not allowed,
//! and "401" on its own has never told anybody which of their three tokens
//! they pasted.

use serde::{Deserialize, Serialize};

const API: &str = "https://api.github.com";
/// GitHub refuses a request with no user agent, and asks that it name the app.
const AGENT: &str = "Idlewild-Editor";
/// The API version this code was written against. Pinned rather than left to
/// default, so a future default cannot change these shapes underneath.
const VERSION: &str = "2022-11-28";

/// One repository, as the picker lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    /// `owner/name`, which is what the list searches and what a target stores.
    pub full_name: String,
    pub owner: String,
    pub name: String,
    /// The branch the repository itself calls default — offered as a hint, not
    /// as the publish default, which is `gh-pages`.
    pub default_branch: String,
    pub private: bool,
    /// Whether this token can actually write to it. A repository somebody can
    /// read is a repository the picker should show and refuse to publish to,
    /// rather than one it hides and leaves them hunting for.
    pub can_push: bool,
    /// Milliseconds since the epoch, for sorting. The API's own `updated_at`
    /// is a string, and a string sorts wrong the moment a year rolls over.
    pub updated_at: i64,
}

/// One file on a branch, as the comparison lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    /// Relative to the path being published into, not to the repository root.
    pub path: String,
    /// The git blob id. Comparable against a locally computed one — see
    /// `deploy::blob_id` — which is what makes "changed" exact rather than a
    /// guess from size and time.
    pub sha: String,
    pub size: u64,
}

// ── the calls ───────────────────────────────────────────────────────────────

/// Who this token belongs to.
///
/// What Login uses: somebody pastes a token and the app says whose it is,
/// rather than asking them to type a username it could have asked GitHub for.
/// It is also the cheapest possible check that a token works at all.
pub fn whoami(token: &str) -> Result<String, String> {
    let body: serde_json::Value = get(token, &format!("{API}/user"))?;
    body.get("login")
        .and_then(|login| login.as_str())
        .map(str::to_string)
        .ok_or_else(|| "GitHub did not say who that token belongs to".to_string())
}

/// Every repository this token can see, most recently updated first.
///
/// Paginated to the end rather than to the first hundred: somebody with two
/// hundred repositories would otherwise find the picker silently missing the
/// half they wanted, with nothing to say it had stopped.
pub fn list_repos(token: &str) -> Result<Vec<Repo>, String> {
    let mut out = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = format!("{API}/user/repos?per_page=100&sort=updated&page={page}");
        let batch: Vec<serde_json::Value> = get(token, &url)?;
        let full = batch.len() == 100;
        out.extend(batch.iter().filter_map(repo));
        if !full {
            break;
        }
    }
    Ok(out)
}

/// A ceiling on the paging, because a loop that trusts a remote to say "stop"
/// is a loop that can be told not to.
const MAX_PAGES: u32 = 20;

fn repo(value: &serde_json::Value) -> Option<Repo> {
    let full_name = value.get("full_name")?.as_str()?.to_string();
    let (owner, name) = full_name.split_once('/')?;
    Some(Repo {
        owner: owner.to_string(),
        name: name.to_string(),
        full_name: full_name.clone(),
        default_branch: value
            .get("default_branch")
            .and_then(|b| b.as_str())
            .unwrap_or("main")
            .to_string(),
        private: value.get("private").and_then(|p| p.as_bool()).unwrap_or(false),
        can_push: value
            .get("permissions")
            .and_then(|p| p.get("push"))
            .and_then(|p| p.as_bool())
            // A token that answered without a permissions block is one whose
            // scope this cannot read. Assuming it can push is the right way to
            // be wrong: the push itself will say so, and hiding a repository
            // somebody owns would be worse.
            .unwrap_or(true),
        updated_at: value
            .get("updated_at")
            .and_then(|u| u.as_str())
            .map(epoch_ms)
            .unwrap_or(0),
    })
}

/// What is on a branch, under a path, right now.
///
/// One request. `?recursive=1` walks the whole tree server-side, which is the
/// difference between this and a clone — and GitHub truncates it rather than
/// paginating, so a repository big enough to hit that says so instead of
/// quietly listing half of itself.
///
/// A branch that does not exist yet is an empty listing rather than an error:
/// publishing to a fresh `gh-pages` is a supported thing to do, and the
/// comparison for it is "nothing there, all of this here".
pub fn list_tree(
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    path: &str,
) -> Result<Vec<RemoteFile>, String> {
    let url = format!("{API}/repos/{owner}/{repo}/git/trees/{branch}?recursive=1");
    let body: serde_json::Value = match get(token, &url) {
        Ok(body) => body,
        Err(e) if e.contains("404") || e.contains("not there") => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };

    if body.get("truncated").and_then(|t| t.as_bool()).unwrap_or(false) {
        return Err(format!(
            "{owner}/{repo} is too large for GitHub to list in one answer, so \
             what is already on {branch} cannot be shown. Publishing still \
             works — it is the comparison that cannot be drawn."
        ));
    }

    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{}/", path.trim_matches('/'))
    };
    let entries = body.get("tree").and_then(|t| t.as_array()).cloned().unwrap_or_default();
    Ok(entries
        .iter()
        .filter(|entry| entry.get("type").and_then(|t| t.as_str()) == Some("blob"))
        .filter_map(|entry| {
            let full = entry.get("path")?.as_str()?;
            // Only what is under the path being published into. Everything
            // else in the repository is somebody's source and is none of this
            // comparison's business.
            let rel = full.strip_prefix(prefix.as_str())?;
            Some(RemoteFile {
                path: rel.to_string(),
                sha: entry.get("sha")?.as_str()?.to_string(),
                size: entry.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
            })
        })
        .collect())
}

// ── the wire ────────────────────────────────────────────────────────────────

fn get<T: for<'de> Deserialize<'de>>(token: &str, url: &str) -> Result<T, String> {
    let response = ureq::get(url)
        .header("Authorization", &format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", VERSION)
        .header("User-Agent", AGENT)
        .call()
        .map_err(|e| wire_error(&e, url))?;

    let status = response.status().as_u16();
    let mut response = response;
    response
        .body_mut()
        .read_json::<T>()
        .map_err(|e| format!("GitHub answered {status} with something unreadable: {e}"))
}

/// A transport or status failure, said in terms of what to do about it.
fn wire_error(error: &ureq::Error, url: &str) -> String {
    if let ureq::Error::StatusCode(code) = error {
        return match code {
            401 => "GitHub did not accept that token. It may have been revoked, \
                    or copied with something missing from the end."
                .to_string(),
            403 => "That token is valid but not allowed to do this. A \
                    fine-grained token has to list the repository explicitly, \
                    and needs Contents write to publish."
                .to_string(),
            404 => format!("GitHub says that is not there ({code}), or not visible to this token"),
            429 => "GitHub is rate limiting this token. Wait a few minutes.".to_string(),
            other => format!("GitHub answered {other} for {url}"),
        };
    }
    format!("Cannot reach GitHub: {error}")
}

/// An ISO-8601 timestamp as milliseconds, for sorting.
///
/// Hand-parsed rather than through a date library, because the only thing
/// anybody does with it is compare two of them and GitHub's format is fixed:
/// `2026-09-17T11:22:33Z`. A string that is not that sorts to the bottom,
/// which is where an unreadable answer belongs.
fn epoch_ms(text: &str) -> i64 {
    let digits: Vec<i64> = text
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect();
    let [year, month, day, hour, minute, second] = digits[..] else {
        return 0;
    };
    // Days since 1970 by the civil-from-days algorithm, which is exact and
    // needs no table of leap years.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    ((days * 86_400) + hour * 3_600 + minute * 60 + second) * 1_000
}

#[cfg(test)]
mod tests {
    use super::epoch_ms;

    #[test]
    fn a_github_timestamp_sorts_by_when_it_was() {
        assert_eq!(epoch_ms("1970-01-01T00:00:00Z"), 0);
        assert_eq!(epoch_ms("2000-01-01T00:00:00Z"), 946_684_800_000);
        // A leap day, which is where a hand-rolled conversion usually goes
        // wrong, and the turn of a year, which is where string sorting does.
        assert_eq!(epoch_ms("2024-02-29T12:00:00Z"), 1_709_208_000_000);
        assert!(epoch_ms("2026-01-01T00:00:00Z") > epoch_ms("2025-12-31T23:59:59Z"));
        // Anything that is not a timestamp sorts to the bottom.
        assert_eq!(epoch_ms("never"), 0);
    }
}
