# The interface: one dark system

How the chrome is drawn, and the rules that keep it one thing. The tokens are
in `src/styles/tokens.css`; this page is why they are what they are.

---

## One surface, home screen and editor alike

The app used to be two halves: a light home screen and light sheets on it, and
a dark editor. Opening a project felt like leaving one app and arriving in
another. It is now one dark interface. The only light thing on screen is the
canvas (and the canvas inside each project thumbnail), so the work is what the
eye goes to.

There is no light variant any more. `openSheet`, `confirmSheet`,
`chooseSheet`, `promptSheet` and `optionsPage` used to take a `light` flag, and
`confirmSheet` defaulted it to *on*, which put paper-coloured confirmations
over the dark editor. The flag is gone, not just ignored.

## Depth is a step in grey, not a line

Surfaces stack in a few close values, darkest to lightest:

| Token | What it is |
|---|---|
| `--chrome-bg` | The frame: header, console, floating bars, menus, tooltips |
| `--chrome-panel` | The sidebars, sheets, the home grid |
| `--chrome-raised` | A section heading, a card, a sheet's action row |
| `--chrome-control` | A button at rest |
| `--chrome-hover` | A control under the pointer |
| `--chrome-selected` | A chosen segment, a pressed toggle |
| `--chrome-field` | A field you type into, which is a well: darker than its panel |

A list row has its own two quieter steps, `--chrome-row-hover` and
`--chrome-row-active`, because a column of rows lighting up as the pointer
crosses them is noise.

Rules (`--chrome-rule`, `--chrome-edge`) are for the boundary between regions
and the outline of a control that needs one. They are not drawn under every
row, between every tool or between every menu item: that is what made the
chrome read as a table.

## How the accent is spent

The accent means *this is on*, plus the one primary action on a surface:

- the tool in hand, in the tool rail and in a canvas mode's bar;
- a switch or a checkbox that is on;
- the primary button of a sheet, a bar or an inspector section;
- keyboard focus, and a selection on the canvas.

A choice among options (a segmented control, a pressed toggle button, the
Draw / Code / Play switch) and a selected row are **neutral**: a lighter grey.
Icons are never accented for being on. A visible layer's eye is ink and a
hidden one is faint; an unlocked padlock is faint and a locked one is ink.

Warnings have `--color-warn` (amber), and destructive actions and errors have
`--color-danger`, so the accent never has to mean "careful". The console's
string literals, the docs' headings and links, and the code panel's find
highlights moved off the accent for the same reason.

## Labels are sentence case

The `.m` class used to be uppercase narrow capitals with tracking, and it was
on most headings, keys and captions in the chrome, all at the same volume. It
is now the body face in sentence case: a label is quieter for being smaller
and dimmer. The one exception is the inspector's three zone names (TOOL,
LAYER, OBJECT), which stay as small tracked capitals because they are the
panel's structure rather than another heading in it.

## Density follows the pointer

Every control height in the chrome is one of four tokens:

| Token | Pointer | Touch | What |
|---|---|---|---|
| `--hit` | 32px | 44px | A target that stands alone: a menu row, a switch row |
| `--row` | 30px | 40px | A row in a list |
| `--ctl` | 26px | 34px | A button, field or segment inside a panel |
| `--bar-h` | 38px | 44px | The header and the console bar |

The touch column applies under `@media (pointer: coarse)`, which is the iPad.
Nothing a finger hits goes under 44px there, and a Mac gets the compact layout
a pointer allows.

## One of each control

There is one button (`.btn`, and `.panel-btn` at panel scale), one field
(a well), one segmented control (a trough with the chosen option lifted out),
one switch, one menu, and one checkbox and one range slider. The last two are
drawn in `controls.css` with element selectors, so every checkbox and slider
in the app gets them, including ones built without a class. The platform's
white boxes and blue sliders no longer appear anywhere.

Corners are small and the same everywhere: `--radius-sm` (3px) for chips,
`--radius-md` (4px) for controls, `--radius-lg` (6px) for floating bars, menus
and cards, `--radius-xl` (8px) for sheets.

## The harness

`npm run harness` opens the editor in a browser against a stubbed backend.
`?screen=home` opens the project list instead, with three fixture projects.
