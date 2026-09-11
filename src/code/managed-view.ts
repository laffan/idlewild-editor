/**
 * Editor-owned lines, as CodeMirror sees them: a decoration that marks them,
 * a filter that refuses to change them, and a Reset beside each block.
 *
 * `managed-blocks.ts` decides *which* lines; this decides what that feels
 * like. Ownership is recomputed after every document change rather than
 * mapped through it, because inserting a line is exactly the case that has to
 * come out right — the line you typed is yours and the lines around it are
 * still the editor's, and that is a fresh answer rather than a shifted one.
 *
 * The filter's job is narrower than "make these lines read-only": an owned
 * line's *text* must survive, and it must still be a line of its own
 * afterwards. So a break typed at the end of one is allowed — that is how you
 * get a line of your own inside a managed block — while a character typed at
 * either end of it, or a backspace that would join it to its neighbour, is
 * not.
 */

import { Annotation, EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { analyse, isGenerated, type Managed } from "./managed-blocks";

/** Marks the editor's own rewrites — a Reset — so the filter lets them past. */
export const managedEdit = Annotation.define<boolean>();

export interface ManagedOptions {
  path: string;
  /** The file as the scaffold wrote it, or null if it has no pristine form. */
  canonical: string | null;
  onReset: (blockId: string) => void;
  /** An edit was refused. Called at most once per rejected transaction. */
  onRefused: () => void;
  /** Blocks the scaffold has that this file does not, after every change. */
  onMissing?: (ids: readonly string[]) => void;
}

const managedLine = Decoration.line({ class: "cm-managed" });
const markerLine = Decoration.line({ class: "cm-managed cm-managed-mark" });

/**
 * Everything the code editor needs for one file's managed blocks.
 *
 * Built per open rather than swapped in a compartment: a file's canonical
 * text arrives with the file, and the editor already builds a fresh
 * `EditorState` for each one.
 */
export function managedExtension(options: ManagedOptions) {
  let announced = "";
  const announce = (managed: Managed) => {
    const key = managed.missing.join(",");
    if (key === announced) return;
    announced = key;
    // Out of the field's update before saying so: building state is not the
    // moment to touch someone else's DOM.
    queueMicrotask(() => options.onMissing?.(managed.missing));
  };

  const field = StateField.define<{ managed: Managed; decorations: DecorationSet }>({
    create(state) {
      const built = build(state, options);
      announce(built.managed);
      return built;
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      const built = build(tr.state, options);
      announce(built.managed);
      return built;
    },
    provide: (self) => EditorView.decorations.from(self, (v) => v.decorations),
  });

  const filter = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(managedEdit)) return true;
    const { managed } = tr.startState.field(field);
    if (managed.owned.size === 0) return true;

    let allowed = true;
    if (managed.generated) {
      // No allowance for a break at the end here, unlike a block: there is
      // no line of this file that is not about to be rewritten, so a line of
      // your own in it would survive exactly until the next save.
      allowed = false;
    } else {
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!allowed) return;
        if (harms(tr.startState, managed, fromA, toA, inserted.toString())) {
          allowed = false;
        }
      });
    }
    // Out of the filter before saying so: this runs inside transaction
    // dispatch, and telling the user is someone else's DOM to touch.
    if (!allowed) queueMicrotask(options.onRefused);
    return allowed;
  });

  if (!isGenerated(options.path)) return [field, filter];
  // A generated file is read-only in CodeMirror's own terms as well, so its
  // editing commands decline rather than firing transactions this rejects —
  // and the caret still moves, because reading and copying it is the point.
  return [
    field,
    filter,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ];
}

function build(
  state: EditorState,
  options: ManagedOptions,
): { managed: Managed; decorations: DecorationSet } {
  const managed = analyse(options.path, state.doc.toString(), options.canonical);
  const starts = new Map(
    managed.blocks
      .filter((block) => block.resettable)
      .map((block) => [block.from, block.id]),
  );
  const markers = new Set(
    managed.generated
      ? []
      : managed.blocks.flatMap((block) => [block.from, block.to]),
  );

  // In document order, because that is the order a RangeSet is built in.
  const builder = new RangeSetBuilder<Decoration>();
  for (let number = 1; number <= state.doc.lines; number++) {
    const block = starts.get(number);
    const owned = managed.owned.has(number);
    if (!owned && !block) continue;
    const line = state.doc.line(number);

    if (owned) {
      builder.add(
        line.from,
        line.from,
        markers.has(number) ? markerLine : managedLine,
      );
    }
    if (block) {
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new ResetWidget(block, options.onReset),
          side: 1,
        }),
      );
    }
  }
  return { managed, decorations: builder.finish() };
}

/**
 * Would this change alter an editor-owned line, or stop it being a line?
 *
 * Written per owned line rather than per range so each case says what it is
 * protecting. The awkward one is the boundary: a change that lands exactly in
 * front of an owned line is fine if the line still starts a line afterwards,
 * which is why deleting a whole line above one is allowed and a backspace
 * from its first column is not.
 */
function harms(
  state: EditorState,
  managed: Managed,
  fromA: number,
  toA: number,
  inserted: string,
): boolean {
  const doc = state.doc;
  const first = doc.lineAt(fromA).number;
  const last = doc.lineAt(toA).number;

  for (let number = first; number <= last; number++) {
    if (!managed.owned.has(number)) continue;
    const line = doc.line(number);

    // Its own characters, and the newline that ends it — losing that joins
    // whatever follows onto it.
    if (fromA <= line.to && toA > line.from) {
      const breakAtEnd =
        fromA === toA && fromA === line.to && inserted.startsWith("\n");
      if (!breakAtEnd) return true;
      continue;
    }

    // Landing exactly in front of it. It has to still begin a line: either
    // what goes in ends with a break, or what comes out took a whole line
    // with it.
    if (toA === line.from) {
      const stillStarts =
        inserted.endsWith("\n") ||
        (inserted === "" && fromA === doc.lineAt(fromA).from);
      if (!stillStarts) return true;
    }
  }
  return false;
}

/** The Reset beside a block's opening marker. */
class ResetWidget extends WidgetType {
  private readonly blockId: string;
  private readonly onReset: (blockId: string) => void;

  constructor(blockId: string, onReset: (blockId: string) => void) {
    super();
    this.blockId = blockId;
    this.onReset = onReset;
  }

  override eq(other: ResetWidget): boolean {
    return other.blockId === this.blockId;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "cm-reset";
    button.type = "button";
    button.textContent = "Reset";
    button.title = `Put ${this.blockId} back the way the editor wrote it`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.onReset(this.blockId);
    });
    return button;
  }
}
