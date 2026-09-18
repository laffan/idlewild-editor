# Publishing

Sending the site somewhere real: a directory on a server over SSH, or a branch
of a GitHub repository. You sign in once on the device, then point each
project at its own destination.

Part of [the Idlewild manual](README.md).

---

## Two verbs, not one

- **Publish and Export are two items, because they are two verbs.** Publish
  sends the site somewhere real and is a destination you set up once and then
  use. Export hands you a file — the site as a zip, the project as `.idlewild`,
  or the artwork on its own — and is a save dialog. They were one menu item
  opening one sheet that asked both questions in the same breath
- **Publish asks "where" once, and "what" every time.** The first time, it is
  two columns: **GitHub** on the left, **Server** on the right, one of them
  lit. The GitHub side lists every repository your token can see and searches
  them as you type — `iwed` finds `idlewild-editor` — because a repository name
  typed from memory is a name typed wrong, and the failure used to arrive at
  the far end of a round trip as a 404. The server side lists the servers this
  device has bookmarked. Under whichever you pick sit the things that are *this
  project's*: branch and path, or the directory

## Signing in

- **The login is the device's, the destination is the project's**, and the
  sheets are split along that seam rather than along GitHub-things and
  server-things. Both columns lead to the same **Logins** list — GitHub
  accounts and servers interleaved, because they are one kind of thing — and a
  column with no login yet shows the way to it and nothing else. So adding a
  second project is picking a repository, not typing a password again
- **Logins is drawn as a settings list**, not in the flat modernist system the
  rest of the chrome uses: rounded groups of rows, a name and a quiet line
  under it, hairline separators starting where the text does. It is a
  vocabulary rather than a one-off — `styles/options.css` and
  `lib/options-list.ts` name rows and groups and nothing about publishing — so
  the next options screen is rows handed to a builder rather than a second
  opinion about what a settings page looks like
- **Signing in to GitHub asks for a token and nothing else.** GitHub is asked
  whose it is, which is one fewer box to type into and the difference between
  finding out a token is bad now and finding out at the far end of a publish
- **The ssh keys are offered, not hunted for.** They live in `~/.ssh`, which
  macOS's open panel hides; the sheet lists what is there and the file dialog
  stays for a key kept elsewhere, opening inside `~/.ssh` when there is one
- **Your ssh key is imported, not pointed at, and the host key is checked.**
  Pick your private key once and it is kept on the device — there is no
  `~/.ssh` on an iPad to read at publish time. The first connection to a server
  records its host key fingerprint and shows it to you; every connection after
  that insists on the same one, and a publish stops dead if it changes.
  Getting past that takes a deliberate **Forget key**, because the difference
  between a rebuilt server and somebody in the middle of the connection is not
  something this app can work out

## Publishing

- **Publishing after that is two panes: what is there, and what you have.**
  Left is the branch or the directory as it stands now. Right is the site this
  project builds, each file marked **new**, **changed** or identical — and
  ticked accordingly, so pressing Publish without reading a row does what it
  always did. Untick to send one scene's fix without pushing every asset again.
  A file at the far end the site no longer has is offered for removal rather
  than assumed, because deleting is the one thing here that publishing again
  cannot undo
- **The sheet stays up and becomes the transfer.** Reaching the host, agreeing
  the host key, the key being accepted, SFTP starting, then a file at a time —
  each says what it is as it happens, the latest large and the rest scrolling
  under it. Which is both the progress and, if it stops, the diagnosis: those
  are five different failures with five different fixes, and a publish that
  said only that it failed was one you had to guess at. The console keeps every
  line, because a sheet you have closed is a record that is gone
- **Test a server before you save it.** A row that has never been tried looks
  exactly like one that works. Test does the five steps with whatever is in the
  form — and, if you give it a directory, checks that too
- **The branch box offers the branches that exist, and has a New branch row
  above them** — naming one that is not there is how you publish to a fresh
  `gh-pages`, and the line under the box says which of the two is about to
  happen, in the accent when it is one that will be created
- **The GitHub publish commits, it does not force-push.** The quick way to ship
  a built site is to make a repository out of the output and force-push it,
  which works right up until somebody types `main` into the branch box. This
  clones the branch, replaces what is at the path being published to, commits
  and pushes — so nothing outside that path is touched, no history is rewritten
  and a mistake is one revert away. `gh-pages` is the default because the
  alternative default is the branch holding your source. Everything you ticked
  is staged, `.gitignore` included: a stray ignore rule saying `assets/` would
  otherwise publish a game with no artwork in it and tell nobody
- **The server half is SFTP, and it only sends what changed.** rsync is the one
  tool here with no library form — the delta algorithm is published as one, the
  sending half of its wire protocol is not — so an iPad could not link it the
  way it links libgit2. SFTP over an SSH connection the app makes itself is the
  same job: a publish leaves a manifest of every file's hash beside the site,
  reads it back next time, and that is what the two panes compare against. What
  is lost against real rsync is the diff *within* a changed file, which for a
  static site is not much

## On an iPad

- **Both of them work on an iPad**, which took doing. iOS does not let an app
  run another program — no `fork`, no `exec` — so shelling out to `rsync` and
  `git` made publishing a desktop feature. But that is a limit on *running
  binaries*, not on publishing: every iOS app that does this work links the
  functionality instead. Working Copy is libgit2; a-Shell's commands are
  libraries inside its own bundle. So the GitHub half **is** libgit2, compiled
  into the app, and the server half speaks SSH itself. Same code on both
  platforms
