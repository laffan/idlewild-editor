# Colour

One picker answers *what colour* everywhere — the pen, a fill, a backdrop,
either stop of a gradient, text, the page around the game — and what has grown
around it: an eyedropper, a palette you build, a shelf of palettes to raid, and
a way of sending the lot out inside a PSD.

Part of [the Idlewild manual](README.md).

---

## The picker

- **It is the same control everywhere.** A colour chosen for a stroke and a
  colour chosen for a backdrop are the same question, so there is one answer
  to it: the field, the hue slider, the opacity slider beside it, a hex
  preview you can type into, and two rows of swatches underneath. What you add
  to the palette while painting is there the next time you open a fill
- **Opacity is part of the colour**, on the second slider — see
  [Drawing](drawing.md). The preview and every swatch sit over a checker, so a
  colour that is half there looks half there rather than looking like a paler
  colour that is not

## The eyedropper

- **The pipette at the head of the hex row picks a colour off the canvas.**
  Press it, then press anywhere on your artwork. It samples the picture — the
  ink and the placed files under it — and not the app around them, so it
  cannot hand you back the grey of a toolbar by mistake
- **Press and drag to hunt.** A tap picks what is under it; holding and moving
  keeps picking as you go and settles on wherever you let go. A readout rides
  above your finger showing the colour and its hex, because on an iPad the
  pixel you are pointing at is underneath the finger pointing at it
- **Escape, a right-click, or lifting off nothing** leaves the colour as it was

## Your palette

Under the recent colours is a second row that works the other way round.

- **The recents are a record** — the last eight colours you used, kept and
  dropped without being asked. **The palette is a decision.** Nothing goes into
  it except through the `+`, and nothing leaves it except through the `−`
- **The button at the head of the row is about the colour in your hand.** It is
  a `+` while that colour is not in the palette and a `−` while it is. So
  taking a colour out is: pick it from the row, then press the button that is
  already sitting there
- **Tap a swatch to go to it**, exactly as you would a recent
- **It holds forty-eight**, and it fills up rather than pushing the oldest out.
  A palette is a set of choices, and quietly losing the first one to make room
  for the forty-ninth would be the app editing them for you
- **It is yours rather than the project's.** Like the brushes and the pattern
  library, the palette lives with the app: it is there in every project on this
  device, and it does not travel inside a `.idlewild`

## Browse Palettes

- **A hundred and twenty-three palettes**, in a drawer that slides out of the
  left edge of the properties sidebar. They come from
  [simple-tileset-generator](https://laffan.github.io/simple-tileset-generator/) —
  muzli, Adobe Color, ColourLovers, Coolors and ColorHunt, each credited with a
  link under its own rows
- **Tap a colour to take that colour. Press Use to take the row.** Both *add*
  to your palette rather than replacing it, so a row you liked two colours in
  contributes two colours
- **It opens beside the picker rather than over it**, on purpose: the palette
  you are filling stays on screen and nothing moves while you fill it. Escape
  closes it, as does the button in its corner

## Attach to PSDs

- **Turn it on and your palette travels inside the artwork.** With it on, every
  file sent out through **Open PSD** (or **Share PSD** on an iPad) gets the
  palette written into it as a strip of flat squares on the topmost layer — so
  the moment it opens in Photoshop or Procreate, the project's colours are
  there to sample. See [A PSD's own layers](psd-layers.md) for the round trip
  that button is half of
- **The squares are a quarter of a grid space**, in the top-left corner,
  wrapped to fit the canvas. Small enough to stay out of the way, big enough to
  put an eyedropper in the middle of
- **It is a layer like any other**, called `Idlewild palette`. Turn its eye off
  in Photoshop, move it, or delete it — nothing minds. The game never sees it:
  its name is outside the naming convention, so nothing loads it as artwork
  (see [PSD layer naming](psd-layer-naming.md))
- **Sending the same file again replaces the strip** rather than adding a
  second one, and **turning the toggle off takes it back out** the next time
  that file goes anywhere. There is no way to end up with three palettes
  stacked in a file
- **An empty palette attaches nothing**, whatever the toggle says
- **Nothing here can stop a file going out.** If the palette cannot be written
  — a PSD that came back from Photoshop using layer masks cannot be rewritten
  at all without losing work — the file is sent as it is and the console says
  why
