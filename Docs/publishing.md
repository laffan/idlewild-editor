# Publishing somewhere real

SSH and GitHub, as libraries rather than as programs, because an iPad cannot
spawn a process. The login is the device's and the destination is the
project's, and that split is most of the design.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

The zip exports hand you a file. These hand the site to a place that serves it:
a directory on a server over rsync, or a branch of a GitHub repository.

## A site is a list before it is a file

`publish::site_entries` answers with every path a published site has and where
its bytes come from — a file on disk, or bytes this code generated. Two things
consume that list: `build_zip`, which writes them into an archive under a
directory named after the project, and `deploy::stage`, which writes the same
list into a staging directory for rsync or git to push.

That seam is the point. Without it the second one would have been the first one
copied and edited, and **a site that was right in a zip and wrong on a server**
is the kind of difference nobody finds until it is live. A `SiteSource::Disk`
stays a path until the moment it is written, because a processed project is
tens of megabytes of sprite sheets and only the three generated files are ever
bytes in memory.

The zip's root directory is deliberately dropped when staging. An archive
unpacks into a directory named after the project; a document root or a
repository branch is already the place the site goes, and publishing into
`public_html/nine-roads/` when the target said `public_html/` would be this
code naming a directory somebody else owns.

## An options vocabulary, which is not this app's design system

The Logins sheet is a settings page, and the modernist system the rest of the
chrome is drawn in — flat, zero-radius, 2px rules, uppercase micro-labels in
Archivo Narrow — is the wrong tool for one. That system is right for chrome
standing over a canvas, where everything is a control and nothing is prose. A
settings page is a list you run your eye down.

So `styles/options.css` departs, on three counts and only three:

- **Rounded groups.** `--radius-md` is `0` everywhere else in this app. A
  settings list reads as cards of related rows, and the corner is what makes a
  group look like a group rather than like four rules in a row.
- **Sentence case in the body face.** No uppercase `--font-label`. A row's
  title is a name, and a name in narrow capitals is a heading.
- **Two lines to a row.** A title and a quiet second line, rather than a key
  column and a value. The second line is where a row says what it is *for*,
  which is the thing a settings list exists to tell you.

Everything else is the system's — the palette, the body face, the accent —
because a settings page that is a different *colour* is a different app.

**Nothing in it names a feature.** The classes are groups, rows, leads, trails;
`lib/options-list.ts` is the matching set of builders, so a page hands it rows
and gets a page back rather than assembling `div`s. Logins is the first thing
built on it and is meant not to be the last: Project Options and the render
settings are the obvious next ones, and they should be able to copy the *shape*
of `publish-accounts.ts` and share none of its content.

## Why New Project is drawn in the settings vocabulary

Logins was the first page built on it and was meant not to be the last. New
Project is the second, and it is the one that shows what the vocabulary was
missing.

It was a stack of `.field`s — a label, a control, and a grey line of
explanation under each. That is the design system's *form* shape and it is the
wrong shape here: a form is a thing you fill in, and this is six questions with
a right answer already chosen for every one of them, which is a settings page.
Nothing about it was a form except the markup.

**The vocabulary had no controls, only reports.** Logins is a list of things
that exist with buttons to add and remove them, so `optionRow` grew a `value`
and `actions` and stopped there. A sheet where every row *is* a control needed
the other half, and that is `lib/options-controls.ts`: a segmented control, a
switch, a number with its unit, a colour swatch, a text box — each sized to
`.option-btn`'s 30px rather than to a form's 42px, because a row is the subject
and a full-size control at the end of one makes the row look like a toolbar.
`optionRow` takes them as `control`, which sits in the trail before any
buttons. `settings-controls.test.ts` pins the sizing and the accent, both of
which fail quietly.

**The explanations went behind a `?`.** Six rows each carrying two lines is six
paragraphs of grey to read past before you reach the one control you came to
change. None of it was thrown away — every sentence that was a `field-hint` is
on the hint beside its row's title — and the hint opens to a **tap** as well as
to a hover, which is the whole reason it is not a native `title`: see the
exception noted under *Where the panel's explanations went*. An iPad has no
pointer to rest on anything, and this sheet is the only place these sentences
are written down.

`hint` is the alternative to `sub` rather than a companion to it. A row with
both says the same kind of thing twice in two places and leaves a reader to
guess which to trust; a page with room for a sentence should use `sub` and no
`?` at all. Logins still does.

**A hint can be a function**, and one is. What the grid scale *means* changes
with the template — under Blank nothing snaps to it, so it is the unit the
character is measured in rather than the size of a space — and the template is
picked two rows above it. A fixed string would be wrong half the time;
rebuilding the row when its neighbour changes would throw away a control
somebody may be part-way through using. So the text is read at the moment the
bubble opens, which is the moment the answer is wanted.

**And the sheet has no title.** It is opened by a button that says *New
Project*, nothing else on the home screen opens it, and a 22px heading repeating
that word spends the best line on the one thing nobody needed telling. The
dialog still carries the name as its `aria-label`, because a modal with no
accessible name is announced as nothing. `openSheet` takes `titled: false` for
it, opt-in rather than default: a sheet reached from a menu of six is not this
sheet.

Two details are load-bearing, and both are asserted in `styles.test.ts`:

- **The tokens are on `:root`, not on `.options`.** That looks like the wrong
  scope for something namespaced `--opt-*`, and it is the difference between a
  single `.options-field` dropped into a panel that is not an options page
  working and drawing a bright border round itself. An undefined `var()` makes
  the declaration invalid at computed-value time and `border-color` resolves to
  `currentColor` — text, not a hairline. The publish destination sheet uses
  exactly one field that way, so this is not hypothetical. A container that
  wants different numbers sets them on itself.
- **The separator between rows is a pseudo-element, inset to where the text
  starts.** A `border-bottom` cannot be inset, and the rule starting under the
  title rather than at the card's edge is most of what makes a list read as a
  list. It hangs off `.option + .option`, so the first row has none without
  anybody writing `:last-child { border: 0 }`.

`optionRow` takes its quiet lines as an array for a reason worth stating: a
server row has two — what it is, and its host key fingerprint — and the
alternative was the caller reaching into the row it had just been handed to
append one. A builder whose output has to be patched afterwards is a builder
missing a parameter.

## Three sheets, and the seam they are split along

Publishing is made of two things that change at different rates, and the first
version of this UI put them on one sheet. That sheet asked where the project
publishes to, offered two zip exports, and had a way through to the device's
own settings — three questions with nothing to do with each other, and the
relationship between the app-wide half and the per-project half legible only to
whoever wrote it.

It is three sheets now, and the split is the seam:

| | What it is about | Whose it is |
|---|---|---|
| `publish-setup.ts` | which repository, which server and directory | the project's |
| `publish-accounts.ts` | which accounts and servers exist at all | the device's |
| `publish-review.ts` | what to send this time | the moment's |

`publish.ts` is the router between the first and the third — no destination
yet means setup, a destination means review — and it is deliberately tiny.
Everything about *choosing where* lives in one module and everything about
*what gets sent* in another; a third that knew both would be the file every
future change had to go through.

**Setup is two columns** because there are two answers, and the column is laid
out login-then-destination, top to bottom, so the relationship is the reading
order. A column with no login yet shows the way through to the list and nothing
else: a repository picker for an account that does not exist is a box that can
only disappoint. There is no *Nowhere* option — a project that publishes
nowhere is a project that has not opened the sheet, and offering it would be
offering somebody the state they are already in.

**The logins are one list**, GitHub accounts and servers interleaved, with the
kind as a chip in the key column rather than as two headings. They are one kind
of thing — a credential this device holds, shared by every project — and two
sections would say they were two.

**A menu opened from inside a sheet was invisible.** `.menu` was `z-index: 40`
and `.sheet-backdrop` is `50`, which held for as long as every menu in this app
came from the header, the code panel's pin or a row in the file column — none
of them reachable with a modal up. The ssh key chooser and the branch picker
are the first two opened from *inside* a sheet, and both rendered behind it:
nothing appeared and the backdrop swallowed the press, so the button read as
broken rather than covered. It is `70` now, above the drag ghost as well, and
`styles.test.ts` asserts it against the sheet and the ghost rather than against
the number — the point is the ordering, not the value. The rules moved to
`styles/menu.css` while they were being touched: a menu is not editor chrome,
and `editor.css` was at the line limit.

**The keys are offered rather than hunted for.** They live in `~/.ssh`, a
directory beginning with a dot, and macOS's open panel hides those. There is a
keystroke — ⇧⌘. — and it is not something anybody should have to know to
publish a website. `ssh_keys::list_ssh_keys` reads the directory, excludes what
ssh keeps there that is not a key by name, and checks the rest for a PEM
header; the sheet offers them on a menu. The file dialog stays for a key kept
elsewhere and opens *inside* `~/.ssh` when there is one, so even that route
starts where the keys are. An iPad has no such directory, answers with nothing,
and gets the dialog it always had.

**The branch box offers and accepts, and says so.** A typo in a branch name is
the least visible mistake in this sheet: publishing to `gh_pages` *succeeds* —
it makes the branch — and then nothing is where anybody looks for it. So the
branches a repository has are on a menu beside the box.

**New branch is a row on that menu**, above the existing ones, and it empties
the field and focuses it. The box has always taken a name that is not on the
list, but a field whose only visible control is a menu of things that already
exist reads as a picker, and a picker is a thing you choose *from* — so the way
to make one has to be somewhere a person looking for it will look. The line
under the box names which of the two is about to happen, in the accent when it
is a branch that does not exist yet: it is the one thing in this sheet that is
about to be *made* rather than chosen.

**Typing must not redraw.** Every field in the destination sheet went through
the same handler as the pickers, which rebuilt both columns — so the input the
caret was in was replaced on every keystroke and the Branch box lost focus
after each character. Nothing a *field* changes alters the shape of the sheet,
so `set` takes a value and updates only whether **Use this** is available,
while `choose` — a kind, an account, a repository — is the one that redraws.
The same distinction stops a render that renders itself: the server column
picks a default during a draw, and asking for another draw from inside one is a
loop.

**The repositories are searched rather than typed.** `owner` and `repo` were
two text fields; a name typed from memory is a name typed wrong and the failure
arrived as a 404 at the far end of a round trip. The token can already see
every repository it can write to, so `github_api::list_repos` fetches them and
`lib/fuzzy.ts` searches them. A repository that can be read and not written to
is **shown and refused** rather than hidden, because an empty list is a worse
answer than a row that says why.

The matching is a subsequence rather than a substring — `iwed` finds
`idlewild-editor` — since the useful thing to type is the letters you remember
in the order you remember them. What makes that usable is the scoring, because
with three letters typed half a hundred repositories are a legal match: runs
beat scattered letters, word starts beat middles, and earlier beats later as a
tiebreak. The one rebalancing that mattered is that a **run has to outweigh a
boundary** once it reaches two characters — with boundaries worth more, `ide`
ranked `i-d-e-a`, three word-starts, above `ideal`, which is the answer anybody
typing `ide` meant.

## A login is the device's, a destination is the project's

This is the whole shape of the feature, and getting it the other way round is
what makes publishing feel like a password prompt.

| | Where it lives | What it is |
|---|---|---|
| **Login** | `publish.json`, beside the project store | the servers you have an ssh key on, the GitHub account your token is for |
| **Destination** | `meta.json`, beside the render options | which of those servers and which directory, or which repository, branch and path |

So adding a second project is naming a directory, not typing a password again.
`project::PublishTarget` is flat with everything defaulting, exactly as
`GameOptions` is: a project that was rsync and is now GitHub keeps what it had
typed for the other one, and every `meta.json` written before publishing
existed reads as *nowhere*.

`server` names a row in **this install's** settings, which is the reason a
target does not travel in a `.idlewild` file — an id from another machine would
name a server this one has never heard of. `meta.json` does not travel anyway,
for the reason in *The format*; this is a second argument for the same answer.

`is_set` is a kind **and** something behind it. A project that picked rsync and
never named a directory would otherwise be offered a Publish that fails at the
far end.

## What the frontend is told, and what it is not

`read_publish_settings` answers with the servers, the GitHub account's *name*,
and whether this platform can publish. **The token never crosses the IPC
boundary.** A secret handed to a webview is a secret in a webview's memory for
as long as a sheet is open, and nothing in the frontend needs it: the deploys
run in Rust. Signing in again is how a token is replaced.

The file is `0600` on platforms that have such a thing. That is a real
trade-off and it is worth stating plainly: **this is not the system keychain.**
Reaching Keychain and its iOS counterpart through Tauri is a dependency and a
platform pair that have not been taken on, and until they are, a token lives in
a file only this user can read, in the directory that already holds every
project's source. Anything that can read it can already read those.

## Neither of them runs a program, and that is the whole iPad story

The first version of this ran `rsync` and `git`, which made publishing a
desktop capability. The reason given was that iOS does not let a third-party
app create a child process — `fork`, `exec` and `posix_spawn` are denied by the
sandbox, `Foundation.Process` is not in the SDK — and that part is true and
permanent.

The conclusion drawn from it was wrong. It is a constraint on **running
binaries**, not on publishing, and every iOS app that does this kind of work
routes around it the same way: by linking the functionality instead of spawning
the tool. Working Copy is libgit2 through objective-git. a-Shell's commands are
dylibs inside its own bundle, loaded by `ios_system`, which exists precisely to
be a `system()` that App Store rules allow. iSH emulates an x86 machine and
implements the Linux syscalls itself, so the `fork` happens inside the
emulator. None of them spawns a process, and all of them run shells and git.

So:

- **GitHub is libgit2**, through the `git2` crate with `vendored-libgit2`.
  `libgit2-sys` builds the C from source for whatever target Cargo is pointed
  at and defines `GIT_SECURE_TRANSPORT` for any target containing `apple`, so
  an iOS build uses the system TLS stack rather than shipping one. The one
  papercut is that git2-rs gates `openssl-sys` on
  `all(unix, not(target_os = "macos"))`, which iOS matches even though libgit2
  will not use it there — hence `vendored-openssl`, so the dependency is
  satisfiable rather than merely unused.
- **The server half is SFTP over our own SSH connection**, with `russh` and
  `russh-sftp`. Raw sockets are unrestricted on iOS — App Transport Security
  governs `NSURLSession` and WebKit, not sockets — which is how every SSH
  client on the App Store works. `ring` rather than russh's default
  `aws-lc-rs`, because `ring` is what rustls uses everywhere and cross-compiles
  to `aarch64-apple-ios` as a matter of routine.

There is no `can_run` any more. Both platforms can.

Two rules hold across both:

- **No secret is ever in a URL or a command line**, because there is no command
  line. The token reaches libgit2 through a credentials callback as
  `x-access-token:<token>`, GitHub's own scheme for a PAT over HTTPS; the ssh
  key is handed to russh as a parsed `PrivateKey`. `deploy::redact` stays as the
  belt to those braces, because libgit2 quotes the remote in some of its
  messages.
- **Nothing hangs.** Neither path can reach a password prompt: there is no
  terminal to reach one on. A credential that does not work fails.

`publish_to_target` is an `async fn`, and that is load-bearing for the same
reason the PSD commands are `(async)`: a synchronous command runs on the **main
thread** — see *One PSD job at a time* — and this one stages tens of megabytes
and then waits on a network transfer. The SSH half is async and is awaited;
libgit2 is a blocking C library and goes through `spawn_blocking`, so neither
parks a runtime thread on a socket.

## And libgit2 needs two libraries that only Xcode has to be told about

Linking libgit2 instead of spawning `git` is what makes publishing work on an
iPad, and it came with a bill that the Mac never presented. libgit2 needs
**zlib**, because a git object is a deflated blob, and **libiconv**, because
`libgit2-sys` compiles `GIT_USE_ICONV` in for every Apple target — it is
`target.contains("apple")` in its `build.rs`, with no feature to turn it off —
so that a path can be precomposed the way HFS wants it. Both ship in the iOS
SDK. Neither was being linked.

**Why the macOS build never noticed.** On desktop, Cargo drives the final link
itself, so the `cargo:rustc-link-lib=z` and `cargo:rustc-link-lib=iconv` lines
those build scripts print become `-lz -liconv` on the command rustc runs. On
iOS none of that happens: the Rust side is a `staticlib`, **Xcode** does the
link, and a `.a` carries no record of the native libraries its objects still
need. So the same tree that links on a Mac fails on the device with a page of
undefined symbols — `_deflate`, `_crc32`, `_inflate`, `_iconv_open` — every one
of them referenced from `libapp.a` and not one of them anything to do with this
app's own code. The error is at the very last step of a long build and names
nothing that appears in this repository, which is most of why it reads as
something being broken rather than as two flags being absent.

Mach-O does have a mechanism for exactly this, `LC_LINKER_OPTION`, and it is
what puts the auto-linked frameworks on that same command. rustc does not emit
those for `#[link]` yet ([rust-lang/rust#121293][autolink]), and ld64 will not
pick them out of an archive member it is not already loading, so it would not
be dependable from a `staticlib` even once it does. The flags therefore go on
the Xcode side.

[autolink]: https://github.com/rust-lang/rust/issues/121293

**`scripts/patch-ios-linker.mjs` is where**, beside the plist one and for the
same reason: `src-tauri/gen/` is not in the repository, `tauri ios init` writes
it fresh, and `bundle.iOS.frameworks` in `tauri.conf.json` cannot express this
— Tauri turns a bare name into `- sdk: <name>.framework` and anything with an
extension into a vendored path, and `-lz` is neither. The alternative Tauri
does offer is `bundle.iOS.template`, a whole copy of its XcodeGen template
carried in this repository to change two lines of it, which is the kind of
second copy this codebase avoids everywhere else.

It writes `OTHER_LDFLAGS` into two files, because they are read at different
times. `project.yml` is the XcodeGen source, so a regenerated project keeps the
setting; `project.pbxproj` is what `xcodebuild` actually reads, so patching it
is what makes the next build work without anyone re-running XcodeGen. Both
edits are skipped when the setting is already there.

**Which is also how this went wrong the first time, and the mistake is worth
keeping.** Tauri does not use cargo-mobile2's project template. It ships its
own, `templates/mobile/ios/project.yml`, and the two disagree about exactly the
line this anchors on: cargo-mobile2 writes `LIBRARY_SEARCH_PATHS[sdk=iphoneos*]`
and Tauri writes `[arch=arm64]` and `[arch=x86_64]`. Anchored on the first,
this matched nothing in the pbxproj — and since the *yml* half anchors on
`ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES`, which both templates do write, the
script patched a file XcodeGen was not going to read again and reported
success. The build failed on the identical linker error, with a tick above it.

Two things come from that. `TARGET_ONLY` takes **any of three** settings
XcodeGen writes for the app target and nothing else, matched on the stem rather
than on a bracketed variant. And recognising *no* configuration is now said out
loud, distinguished from having nothing to do: the script counts the blocks it
recognised as well as the ones it changed, and warns — after the tick, so the
last line on screen is the problem — naming the settings it looked for.

**A build does not undo it.** Tauri writes the development team and the bundle
identifier into the pbxproj on every build, and its editor is line-based — it
rewrites the lines it owns and leaves the rest — so this survives. `tauri ios
init` is the one thing that does undo it, which is why `npm run ios:init` runs
the script straight afterwards. As with the plist, `beforeBuildCommand` means
`tauri ios build` applies it and `tauri ios dev` does not.

The two string transforms are tested in `scripts/__tests__`, against Tauri's
own template as XcodeGen renders it, and against cargo-mobile2's spelling of
the search-path key beside it. That is unusual for a build script here and it
is the one that earns it: the file being edited only exists on a Mac that has
run `ios init`, nobody reads it, and both ways of getting it wrong are silent —
a pbxproj rebuilt slightly wrong is a project Xcode refuses to open, and a
patch that matches nothing is a build that fails exactly as it did before. So
the tests assert the two hard halves outright: everything but the inserted
lines comes back byte for byte, and both key spellings are recognised.

## SFTP, a manifest, and the host key

**rsync is the one tool here with no library form**, and that is the actual
obstacle rather than the sandbox. `librsync` and `fast_rsync` are the delta
*algorithm* — the rolling checksum. The Rust wire-protocol crates, `arrsync`
and `rsyn`, implement the listing and downloading half against `rsyncd`;
nothing implements the sending client. And rsync's protocol is defined by
rsync's source rather than by a specification, so writing the sender is a
project rather than a dependency. libgit2 could simply be linked; rsync could
not.

SFTP over an SSH connection we make ourselves is the same job with the same
outcome. What it costs is the diff *within* a changed file — a changed file is
sent whole.

**What is put back is skipping the files that have not changed**, which is most
of the practical benefit. A publish leaves an `IDLEWILD-MANIFEST` beside the
site listing every file's SHA-256, reads it back next time, and sends only what
differs. Hashed rather than compared by size and modified time, because the
staging directory is written fresh for every publish: every file's mtime is
*now* and says nothing at all. A manifest that is missing or unreadable means
send everything, rather than fail — the worst a mangled one can do is make a
publish send more than it had to, and refusing to publish over a file whose
only job is to be an optimisation would be the wrong way round.

The name has no dot in it on purpose. A hidden file nobody knows about, in a
directory somebody else's web server is serving, is worse manners than an
obvious one.

**Tidy up walks the far end rather than trusting the manifest.** A file the
manifest never knew about is exactly what that switch is for, and a prune that
only removed what it had put there would leave the last hand-uploaded copy of
the site sitting underneath this one for good. It stays off by default: right
for a directory holding nothing but this site, and also how somebody loses a
`.well-known`.

An empty directory is refused rather than defaulted, as it was under rsync and
for the same reason: it would mean the login's home directory, and publishing a
site over somebody's home directory because a field was blank is not a thing to
do.

## The host key, which is ours to check now

Owning the SSH client means owning the check `ssh` would have done, and getting
it wrong here is a vulnerability rather than a bug: accepting any key at all
means a publish can be handed to whoever answers on that address. russh's
`check_server_key` defaults to rejecting everything and says so in its own
documentation; the tempting thing to write is `Ok(true)`, which is that bug.

It is **trust on first use**, with no terminal to ask at. The first connection
records the SHA-256 fingerprint it saw and every connection after it insists on
the same one. `deploy_ssh::trusts` is that decision on its own, in three lines,
because it should be readable without an SSH session around it.

Three details that are not obvious:

- **The fingerprint is captured even when the connection then fails**, and that
  is the case that matters: a refused host key *is* a failure, and the message
  has to name both fingerprints rather than being whatever russh calls a
  rejected key exchange.
- **It is recorded once the connection stands, not once the publish succeeds.**
  A server that then refuses the key has still proved which server it is, and
  being asked to accept the same new host key twice is being asked twice.
- **A certificate is fingerprinted like a bare key.** Checking one properly
  means carrying the issuing authority's key, which nothing in this app has
  anywhere to get, so a server presenting a certificate to a client that knows
  nothing about the authority gets the same trust-on-first-use answer.

Getting past a changed fingerprint takes a deliberate *Forget key* on the
server's row, with its own confirmation naming the two possibilities. It is not
a checkbox on the publish that failed, because that is the shape that trains
people to click through the one warning that mattered.

**The key itself is imported rather than pointed at**, and that is the iPad
again: there is no `~/.ssh` there, and a file picked out of Files hands back a
security-scoped URL that is not readable on the next launch. So the picker
names a file once, Rust reads it, checks it parses with the passphrase given —
so "that is not a key" is said while the picker is still fresh in mind rather
than at a publish — and stores the key. It is parsed again at every connection
rather than kept decoded, because a private key held in memory for the life of
the app is a private key in every crash report.

## GitHub commits onto the branch, it does not replace it

The quick way to ship a built site is to make a repository out of the output
directory and force-push it. Every static-site deploy script does this, and it
works right up until somebody types `main` into the branch box — at which point
their source is gone from the tip of their default branch because a game editor
decided to.

So instead: **shallow-clone the branch, replace what is at the target path,
commit, push.** No history is rewritten, nothing outside the path being
published is touched, and a mistake is one `git revert` away rather than one
reflog away. A branch that does not exist yet is started from nothing, which is
what makes a fresh `gh-pages` work — and the summary says *a new branch* when
that happened, because a typo in a branch name otherwise looks exactly like a
successful publish to a place nobody will look.

`branch_or_default` is `gh-pages` for the same reason: it is the branch whose
whole job is to be a built site, and the alternative default is the one holding
somebody's source.

Replacing rather than merging is deliberate too. A file the site no longer has
is a file that should stop being served, and a publish that only ever adds
leaves a deleted scene's assets live for good. At the repository root that
means everything but `.git`, which is the clone itself.

**The index is built with `FORCE`, on purpose.** `git add -A` — which is what
this used to run — honours `.gitignore`. For a *site publish* that is a trap
rather than a feature: a `.gitignore` on the branch saying `assets/` would
silently publish a game with no artwork in it, and nothing would report
anything. What is staged is exactly what the site is. The index is cleared
first, too, so a file the site no longer has leaves the index with it —
`add_all` only ever adds.

"Nothing changed" is told from "something went wrong" by comparing the new
tree's id against the parent commit's. Two commits with the same tree is
exactly what nothing changed *means*, and it is a better test than the
`git status --porcelain` the shelling-out version used: `git commit` fails when
nothing is staged, and a publish reporting a failure because the site had not
changed is a publish nobody trusts.

## The two panes, and why a publish is no longer all-or-nothing

`compare_target` lists the far end beside the staged site, and `compare.rs`
marks each local file against it. That is what the Publish sheet opens with
once there is a destination, and it is what made selecting possible.

**A publish used to replace everything at the destination.** The right default
and the wrong only option, for two reasons that each show up exactly once: a
file somebody put there by hand vanished without ever having been shown to
them, and there was no way to push one scene's fix without pushing every asset
again. So `deploy_github::apply` copies what was ticked rather than wiping the
path, and `deploy_ssh::push` takes the same selection. The defaults reproduce
the old behaviour — everything that differs is ticked — so pressing Publish
without reading a row does what it always did.

**Removals are offered, not assumed.** A file at the far end that the site no
longer has gets a checkbox on the left pane, ticked to begin with only when the
destination says to tidy up. Deleting is the one thing here that publishing
again cannot undo.

Each half compares with whatever the far end can be compared against, and that
is the whole reason `site_files::scan_with` takes the hash as an argument:

- **GitHub** hands back a **git blob id** per file, so the local side is hashed
  the same way through `git2::Oid::hash_object` — libgit2 doing exactly what
  `git hash-object` does. Exact, and free of a second implementation of the
  `blob <len>\0` framing that would look like the comparison simply not
  working if it were wrong.
- **A server** has no such thing, so the manifest is the comparison. A file on
  the server the manifest has never heard of is **unknown** rather than
  unchanged — the honest answer, and it is ticked by default, because sending a
  file that did not need it costs a second and skipping one that did costs a
  wrong site.

**The manifest a partial publish writes is not the whole site.** It is what was
there, plus what this run sent, minus what it removed — `site_files::next_manifest`.
Writing the full site's hashes after sending two files would tell the next
publish that files it never sent are already there, which is the one way a
manifest causes a wrong site rather than a slow one.

## Two flags, and the bug they were missing

`russh_sftp::SftpSession::write` opens a file with `OpenFlags::WRITE` alone.
That is "open this file for writing", not "make me this file" — so a server
answers `SSH_FX_NO_SUCH_FILE`, and what a person saw was **No such file**
naming the file they were trying to create. Which is to say the server publish
never worked for a site that was not already there, and read as a permissions
problem every time, because the message points at a file and the file is not
the problem.

`Session::put` opens with `PUT_FLAGS` — `CREATE | TRUNCATE | WRITE`. The
truncate is load-bearing on its own: without it, replacing a file with a
shorter one leaves the tail of the old one on the end, which is a corrupt site
that mostly works. It is a named constant so `deploying.rs` has something to
assert, and so the next person to notice that `write` is shorter finds out why
it is not used.

Two things changed around it, both of them about the *message* rather than the
transfer, because the transfer was only half of what went wrong:

- **The target directory is checked before anything is written.** SFTP answers
  the same `SSH_FX_NO_SUCH_FILE` for a write into a directory that does not
  exist, so a missing destination also arrived as an error about a file.
  `Session::require` stats it first and says so by name, with the `mkdir -p`
  that fixes it. It does not create it: making a directory in a stranger's
  document root because a field had a typo in it is not a thing to do.
- **`explain` translates the two status codes that lie.** *No such file* is
  what a server says when the directory above a file is missing, and *failure*
  is what it says for most permission problems. Both get a clause saying what
  they usually mean.

## The shallow clone that broke every second publish

`RepoBuilder` was given `depth(1)`, on the reasoning that a branch's history is
not what is being published and a site's worth of assets is not worth
downloading twice. It made the **first** publish to a branch work and every one
after it fail, because **libgit2 cannot push from a shallow repository**. What
it says when you try is *"a reference that you are trying to update on the
remote contains commits that are not present locally"* — which reads as
somebody else having pushed to the branch, and is really the graft point at the
bottom of the shallow history.

Publishing twice to the same branch is the ordinary case, so the optimisation
went. `RepoBuilder::branch` still limits the fetch to the one branch being
published to, which is most of what the depth was for.

It is worth saying how this was found, because it is the answer to why the
GitHub half had been written twice without ever running. **A bare repository in
a temporary directory is a perfectly good git remote.** Nothing in
`deploy_github` needs github.com except the URL, so `publish_into` takes the
URL as a parameter and `tests/publishing.rs` drives the whole path against a
local one: starting a branch that does not exist, starting one *beside* an
existing `main`, committing onto one that does exist, sending a subset,
removing a file, noticing that nothing changed, and refusing to let a
`.gitignore` on the branch drop the site. No network, no token, and it would
have caught this on the day it was written.

Two things that only the "beside an existing branch" case exercises, and which
are the case a person actually starts from: the clone of `gh-pages` fails
against a remote that *is* reachable and *does* have refs, so the fallback has
to start an unrelated history — and the push of that orphan history must not
disturb `main`.

**A repository with no commits answers 409, not 404.** GitHub's tree endpoint
says *Conflict* for an empty repository, which the comparison treated as a
failure — so publishing into a repository somebody had made a minute ago
stopped at the comparison, before the screen that would have created the
branch. Both statuses now mean the same thing: there is nothing at the far end
yet, which is an ordinary thing for there to be.

## A publish narrates itself

Every step goes out on `deploy::PUBLISH_LINE` as it is reached, and the Publish
sheet becomes that list while the transfer runs. Two reasons, and the second is
the one that mattered:

- A network transfer of tens of megabytes behind a modal that closed on the
  press is a modal that looks like it did nothing. It used to close and write
  to the console, which is right for a zip — over before the dialog has shut —
  and wrong for this.
- **Publishing is five things that fail differently.** Reaching the host,
  agreeing the host key, the key being accepted, SFTP starting, the directory
  existing. A failure with none of them named is a failure somebody has to
  guess at, and "authenticated fine, SFTP would not start" is a different
  afternoon from "could not reach the host".

The same channel carries progress and trace on purpose: what the publish is
doing now is exactly what you want written down when it stops doing it. The
console keeps every line, because a sheet somebody has closed is a record that
is gone.

**"Check it first" is gone.** It was a `dry_run` parameter on the publish and
it answered a question two better things now answer: *Test* on the server sheet
does the five steps before the server is even saved, and the two panes say what
would be sent before anything is. A rehearsal that stages the whole site to
tell you what the comparison already showed you was a slower way to learn less.

## Trying a server before saving it

A server row that has never been tried looks exactly like one that works, and
the first time anybody found out otherwise was in the middle of a publish.
`test_publish_server` takes the details **as they stand in the form** — reading
`key_file` now if one was picked, falling back to the key already stored under
that id — builds a `Server` that is never written to disk, and runs
`Session::open` against it, collecting the lines rather than emitting them.

It carries the existing row's `host_key`, which matters twice: the check is
against the fingerprint this server is supposed to have, and a first visit
during a test is recorded once rather than asked about again at the publish.

The directory box on that sheet is **not saved anywhere**. The destination
belongs to the project, not the server; that field exists so Test has something
to look for, because checking a login without checking it can reach anything is
half a test.

## What cannot be tested here

A transfer wants a server and a repository, and a suite that reached the
network would be a suite that fails on a train. `tests/deploying.rs` pins
everything a bad publish is made of *before* it leaves: the staged site being
the site the zip carries, a staging directory emptied so a failed publish does
not leave its half-written copy for the next one, a directory that would land
on somebody's home, a branch name git would refuse, a path that climbs out of
the clone, the manifest diff sending what differs and nothing else, and a token
surviving into something somebody reads. Those are worth pinning precisely
because the failure they prevent happens on somebody's live server rather than
in this process — and, for `trusts`, because a mistake in it is a vulnerability
rather than a bug.

What is **not** covered by any of it is the iOS build. There is no macOS or
Xcode in the environment this was written in, so `aarch64-apple-ios` has never
been compiled: the crate selection is argued from how `libgit2-sys` and `ring`
behave on Apple targets rather than from having watched them do it. That is the
one claim here to check first on a real device.
