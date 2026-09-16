//! Find across the project's `game/` tree — ⇧⌘F, and the strip over the file
//! column that shows what it found.
//!
//! In Rust rather than in the frontend because the alternative is a round trip
//! per file: the code modal already has `read_game_file`, and a search built on
//! it would be twenty IPC calls and twenty copies of the tree crossing the
//! boundary as JSON strings on every keystroke. Here it is one call that reads
//! the files where they are and answers with the lines that matched.
//!
//! **The same listing the file column shows.** It walks `store::list_game_files`
//! rather than the directory, so a result and a row in the tree are the same
//! set of files said twice — there is no way for the search to offer a file the
//! column has no row for, or to miss one it does.
//!
//! **Plain substring, not a regular expression**, for the reason the in-file
//! Find is: the thing people look for in this tree is `config.scenes` or
//! `place(`, and a box that quietly reads those as patterns answers a question
//! nobody asked. Case is a switch, matching the panel's own.
//!
//! What it will not do:
//!
//! - **Files it cannot read as text are skipped**, not reported as errors.
//!   `game/` is the user's tree and someone will drop a PNG in it; a search
//!   that fails because of one is a search nobody can use.
//! - **A large file is skipped** at `MAX_FILE_BYTES`. A minified bundle is not
//!   something anybody is reading match-by-match, and scanning one on every
//!   keystroke is the difference between a box that answers and a box that
//!   stutters.
//! - **The answer is capped** at `MAX_RESULTS`, and says so, because a column
//!   170 px wide cannot show a thousand rows and a person cannot read them.

use crate::store;
use serde::Serialize;

/// How big a file may be and still be searched — 512 KiB.
///
/// Every file the scaffold writes is under 40 KiB. This is the line between
/// "a file someone edits" and "a file someone generated", drawn generously.
const MAX_FILE_BYTES: u64 = 512 * 1024;

/// How many matches come back. Past this the strip says the answer is partial.
const MAX_RESULTS: usize = 300;

/// How much of a matching line travels, in characters.
///
/// The row shows one line of a file in a narrow column, so the whole of a
/// four-hundred-character minified line is bytes nobody will see. Cut from the
/// start of the line rather than around the match: the indent and what the line
/// begins with are what make it recognisable.
const MAX_LINE_CHARS: usize = 200;

/// One line of one file that matched.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    /// Relative to `game/`, exactly as the file column names it.
    pub path: String,
    /// 1-based, which is what the gutter says and what `openAt` takes.
    pub line: u32,
    /// Where in the line the match starts, in **UTF-16 code units**.
    ///
    /// Not bytes. The frontend adds this to a CodeMirror line offset, and
    /// CodeMirror counts a document the way JavaScript counts a string — so an
    /// accented character earlier in the line would otherwise put the selection
    /// one place to the left of the thing that matched.
    pub column: u32,
    /// The match's length, in UTF-16 code units, so the whole of it is selected.
    pub length: u32,
    /// The line itself, trimmed of trailing space and cut at `MAX_LINE_CHARS`.
    pub text: String,
}

/// What one search found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub matches: Vec<FileMatch>,
    /// Whether the cap was reached, so the strip can say the list is partial.
    pub truncated: bool,
    /// How many files were actually read — what "searched 14 files" counts.
    pub files: u32,
}

#[tauri::command]
pub fn search_game_files(
    id: String,
    query: String,
    case_sensitive: bool,
) -> Result<SearchResults, String> {
    search(&id, &query, case_sensitive)
}

/// The search itself, callable from the tests without a Tauri runtime.
pub fn search(id: &str, query: &str, case_sensitive: bool) -> Result<SearchResults, String> {
    let mut results = SearchResults {
        matches: Vec::new(),
        truncated: false,
        files: 0,
    };
    if query.is_empty() {
        return Ok(results);
    }

    let root = store::game_dir(id)?;
    let needle = fold(query, case_sensitive);

    for file in store::list_game_files(id)? {
        if file.is_dir || results.truncated {
            continue;
        }
        let path = root.join(store::safe_relative(&file.path)?);
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() <= MAX_FILE_BYTES => {}
            // Too big, or gone between the listing and the read. Either way
            // there is nothing to search and nothing worth failing over.
            _ => continue,
        }
        // A file that is not UTF-8 is a file nobody is searching for a string
        // in — a PNG someone dropped into `game/`, most likely.
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        results.files += 1;
        scan(&file.path, &text, &needle, case_sensitive, &mut results);
    }

    Ok(results)
}

/// Every match in one file, line by line.
///
/// Everything here is done over `char`s rather than bytes, because the answer
/// has to be handed to a JavaScript editor that counts a document in UTF-16
/// code units. Byte offsets would be right for ASCII — which is nearly every
/// file in this tree — and one place out on the first line carrying an em dash
/// in a comment, which is exactly the kind of bug that survives a test suite.
fn scan(path: &str, text: &str, needle: &[char], case_sensitive: bool, out: &mut SearchResults) {
    let length = needle.iter().map(|c| c.len_utf16()).sum::<usize>() as u32;
    for (index, line) in text.lines().enumerate() {
        let chars: Vec<char> = line.chars().collect();
        let hay = fold(line, case_sensitive);
        let mut from = 0usize;
        while let Some(at) = find_from(&hay, needle, from) {
            if out.matches.len() >= MAX_RESULTS {
                out.truncated = true;
                return;
            }
            out.matches.push(FileMatch {
                path: path.to_string(),
                line: index as u32 + 1,
                column: chars[..at].iter().map(|c| c.len_utf16()).sum::<usize>() as u32,
                length,
                text: shorten(line),
            });
            // Resumed after the match rather than one character on, so
            // `aaaa` holds two `aa` and not three: overlapping answers are not
            // what "next" means when you press it.
            from = at + needle.len();
        }
    }
}

/// The first place `needle` sits in `hay` at or after `from`.
fn find_from(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&start| &hay[start..start + needle.len()] == needle)
}

/// A string as it is searched, one `char` per `char`.
///
/// Case folding **per character**, and only where a character has a
/// single-character lower case. `char::to_lowercase` is an iterator because a
/// few characters lowercase to several — İ is the usual example — and taking
/// all of them would make the folded string a different length from the line it
/// came from, which is how a column ends up pointing at the wrong place. Those
/// few characters are left as they are: a Find that will not match İ against i
/// is a Find nobody notices, and a Find that selects the wrong six characters
/// is one everybody does.
fn fold(text: &str, case_sensitive: bool) -> Vec<char> {
    text.chars()
        .map(|c| {
            if case_sensitive {
                return c;
            }
            let mut lower = c.to_lowercase();
            match (lower.next(), lower.next()) {
                (Some(one), None) => one,
                _ => c,
            }
        })
        .collect()
}

/// A line, without its trailing space and without its tail past the cap.
fn shorten(line: &str) -> String {
    let trimmed = line.trim_end();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
    format!("{cut}…")
}
