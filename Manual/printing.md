# Printing

A project can make a page instead of a game: the same canvas, the same tools
and the same code, pointed at a sheet of paper and written out as a print-ready
PDF, a layered PSD or a PNG.

Part of [the Idlewild manual](README.md).

---

## Making a print project

- After the name, the New Project sheet asks **Web or Print**. Web is
  everything the rest of this manual describes — both are code; the choice is
  where the work ends up. Print asks two more things:
  - **Resolution**: 300 or 600 DPI. Every PSD the project writes is written at
    it. This is fixed once the project exists, like the template, because a
    file made at 300 DPI has no 600's worth of pixels to give
  - **Dimensions**: Letter, Legal, Tabloid, A5, A4, A3 or A2 and its
    **orientation** — or **Custom**, a width and a height in **inches** or
    **centimetres**, from half an inch to four feet. A custom size is the way
    round you type it, so it takes no orientation; switching the unit converts
    what is in the boxes
- **Scaffolding and Rendering go away under Print.** A print project is always
  **Blank PSD to Phaser** — your artwork placed and nothing written over it but
  what you write — because `ExportForPrint()` reads the page off a running
  Phaser scene, and a character or gravity is a game's. A page is looked at
  one point to the pixel, so it has no default zoom
- What a page is written as — PDF, PSD or PNG — is not asked here. It is
  asked where pages are made, in the Output preview's bar

## The page on the canvas

- **One world pixel is one point**, a seventy-second of an inch. A new page's
  top-left corner is the world's origin, so a letter page starts out running
  from 0, 0 to 612, 792
- In Draw the page is a solid red frame — the sheet, edge for edge — with a
  **label** on its top-left corner naming it: `Letter · 8.5 × 11 in`, or
  `Custom · 30 × 20 cm` for a size you typed. It grows and shrinks with the
  camera
- **Drag the label to move the page** over what you have drawn. The page is
  where the game's camera looks and what prints, so moving it chooses which
  part of the world is the page; it lands on whole points
- **The canvas is the canvas it always was.** Draw, fill, drop images, convert
  sketches — nothing about the tools changes

## Two resolutions

- Every PSD in a print project is written at its DPI: a letter-sized fill at
  600 DPI is a 5100 × 6600 file, and Photoshop opens it as eight and a half
  inches by eleven
- **The canvas and your code never see files that big.** Each PSD is processed
  twice: once at full resolution, which only the export reads, and once
  downsampled to the resolution a game project's files have. The canvas, the
  running game and your code all work with the lighter copy, so a script moving
  five hundred sprites is no slower than it would be in a game
- An image you bring in arrives at the size its pixels make **at the project's
  DPI** — a 3000-pixel photograph is ten inches wide at 300 DPI — rather than at
  half its pixels, which is what a game project does

## ExportForPrint()

- Call `ExportForPrint()` from anywhere in your code and the page as it is on
  screen at the end of the next frame is written out. By default **every
  scene stops** — tweens, timers, physics, animation — and the page stays on
  screen as it was printed
- What prints is what your code made of the scene, not the document as you
  drew it. Move, rotate, scale, flip, fade, tint or clone sprites — a sprite
  drawn from one of your PSDs prints from the **full-resolution** file, in
  exactly the place, angle and size your code left it
- Anything you draw in code with no file behind it — Graphics, shapes, text —
  is rendered by the game at the project's DPI and printed as pixels
- **It takes options**, all of them optional:

  ```js
  ExportForPrint({
    name: "page",     // the file's name, without an extension
    folder: "",       // a folder inside the project's exports/
    formats: "pdf",   // "pdf", "psd", "png", or a list — or the bar's
    stop: true,       // stop every scene once the page is read
  });
  ```

- **It returns a promise** that settles when the files are written, with the
  paths it wrote. So a series of pages is a loop with an `await` in it — every
  frame of an animation as its own file, say:

  ```js
  async function printFrames(scene) {
    for (let i = 0; i < 24; i++) {
      setFrame(scene, i);
      await ExportForPrint({ folder: "frames", name: `frame-${i}`, stop: false });
    }
    scene.scene.pause();
  }
  ```

- Files go into the project's `exports/` folder, under the folder and name you
  gave — letters, digits, `-` and `_`, anything else becomes `_` — and nowhere
  else: code running in a page does not get to write wherever it likes on your
  disk. **Save** in the preview's bar hands them over
- The scaffold leaves one line in each scene, commented out, that prints once
  the artwork has loaded:

  ```js
  // whenPsdsReady(this, () => ExportForPrint({ name: "page", formats: "pdf" }));
  ```

- In a published site there is no editor to send the page to, so
  `ExportForPrint()` stops the scenes and the promise settles with nothing
  written

## Output

- A print project has **two sections, Draw and Output**. Output is the code
  panel and, over the canvas, the **preview** of what your code has printed —
  and nothing else. The game runs underneath it, covered: what you look at is
  the page, not the game
- **Your code runs as Output opens.** While it is running the code bar has
  **Stop** and **Restart** beside the pin; once stopped, **Run**. Run and
  Restart save the open file first. It does **not** restart when you save — a
  page can be seconds of work at full resolution, or a loop writing a hundred
  files, so running it again is something you ask for
- **A new sheet restarts it.** Change the size or orientation in Page Setup, or
  drag the page somewhere else in Draw, and a running Output starts again on
  the new page straight away
- The bar at the top of the preview:
  - **PDF / PSD / PNG** — what a page is written as when your code does not
    say. Switch it after a page has printed and that page is written in the new
    format too: the game is holding it, and a generative piece would not draw
    it again
  - **Export now** — prints the page as it stands, as if your code had called
    `ExportForPrint()`, so a project that never calls it still prints
  - **Save PDF**, **Save PSD**, **Save PNG** — the last page's files, through a
    save dialog on a Mac or the Files export picker on an iPad. **Save all**
    appears once a run has written more than one file, and hands over every
    file the run wrote as one zip
- The preview is the file itself where a page can show one — the PDF, or the
  PNG. A PSD cannot be shown in a page, so a PSD previews the flattened image
  inside it

## The three files

- **The PDF** is the page as it prints: one page, the size of the sheet, every
  sprite at the full resolution of its file. The same picture placed five
  hundred times is stored once
- **The PSD** is the same page to keep working on: one layer per thing on the
  page, in the order the scene drew them, named after the file it came from,
  at the project's DPI, with each sprite's transparency as the layer's opacity
  and its blend mode as the layer's blend mode
- **The PNG** is the page as one picture at the project's DPI, clear where
  nothing was drawn, and it says its resolution, so it opens at the size of the
  paper

## Page Setup

- On a print project Page Setup is the page's **Dimensions** — the same rows as
  the New Project sheet, Custom included — and the **resolution**, which it
  reports but cannot change. A change takes effect at once: the frame on the
  canvas changes, and a running Output restarts on the new page. It does not
  move anything you drew

## Not yet

- The PDF is RGB. A print shop that wants CMYK will convert it
- No bleed or crop marks — the PDF is the sheet, edge to edge
- A layer mask or a clipped layer in a PSD you bring in shows unmasked on the
  canvas, though it prints from the original file. A tile layer's merged
  palette prints at screen resolution, and Export says so when it does
- The PSD's flattened copy ignores blend modes; Photoshop applies them when it
  opens the file
- A 600 DPI page is a big picture. On an iPad, a full-page fill or sketch
  converted at 600 DPI may be more than the browser will draw in one go

See [Print projects](../Docs/printing.md) for how it works.
