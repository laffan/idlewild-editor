/**
 * The pattern and shape libraries — **app-wide**, not per project.
 *
 * A pattern is a mark you make, the way a brush is: nobody wants the dither
 * they drew on Tuesday to belong to the project they happened to draw it in.
 * So the library lives beside the app rather than inside a document, in
 * `localStorage`, which on this shell is per install — the same place the
 * sidebar widths, the folded inspector sections and the colour picker's
 * recent swatches already live.
 *
 * What a *document* stores is the id and nothing else. That is the trade and
 * it is worth saying out loud: a project opened on a machine whose library
 * does not have `pattern_k3f…` in it draws that stroke in flat colour and
 * says so, rather than carrying a copy of every pattern in every file. The
 * built-ins are in the binary, so a project that only uses those is portable
 * with no caveat at all.
 *
 * Built-ins and customs are the same kind of row. A built-in can be renamed,
 * reordered, duplicated and taken out of the palette; what it cannot be is
 * *edited in place* — editing one makes a copy and puts the copy in its place,
 * which is upstream's behaviour and the right one, because the defaults are
 * the floor everything else is measured against. **Restore defaults** puts
 * back whatever has been taken out.
 */

export interface LibraryRow {
  id: string;
  name: string;
}

interface Stored<T> {
  version: 1;
  /** The palette, in the order it is shown. Ids, built-in or custom. */
  order: string[];
  /** Everything not in the binary, by id. */
  custom: Record<string, T>;
  /** Renamed built-ins, by id — the name only; the geometry is the binary's. */
  renamed: Record<string, string>;
  /** Which row the tools are pointed at. */
  selected: string | null;
}

/**
 * One library. Two exist — patterns and shapes — and they differ only in
 * their defaults, their storage key and the prefix a new id gets.
 *
 * An `EventTarget` rather than a callback list: several panels show the
 * palette at once — the TOOL zone, the pattern editor's own picker, the fill
 * paint control — and all of them want to hear the same "something changed".
 */
export class Library<T extends LibraryRow> extends EventTarget {
  private readonly key: string;
  private readonly prefix: string;
  private readonly defaults: readonly T[];
  private state: Stored<T>;

  constructor(options: {
    storageKey: string;
    idPrefix: string;
    defaults: readonly T[];
  }) {
    super();
    this.key = options.storageKey;
    this.prefix = options.idPrefix;
    this.defaults = options.defaults;
    this.state = this.read();
  }

  /** The palette, in order, with renames applied. */
  list(): T[] {
    const out: T[] = [];
    for (const id of this.state.order) {
      const row = this.lookup(id);
      if (row) out.push(row);
    }
    return out;
  }

  /**
   * One row by id, whether or not it is in the palette.
   *
   * A document can name a pattern somebody has since taken out of their
   * palette, and the stroke should still draw: the palette is what is
   * *offered*, not what exists.
   */
  get(id: string | null | undefined): T | null {
    return id ? this.lookup(id) : null;
  }

  /** Whether this id is one of the built-ins. */
  isDefault(id: string): boolean {
    return this.defaults.some((d) => d.id === id);
  }

  /** The row the tools are pointed at, or the first in the palette. */
  get selectedId(): string | null {
    const wanted = this.state.selected;
    if (wanted && this.lookup(wanted)) return wanted;
    return this.state.order[0] ?? null;
  }

  select(id: string | null): void {
    if (this.state.selected === id) return;
    this.state.selected = id;
    this.commit();
  }

  /**
   * Put a new row in the palette and hand back its id.
   *
   * `at` is where it lands — a duplicate goes in beside the thing it was a
   * copy of rather than at the end, because a palette somebody has arranged
   * is an arrangement.
   */
  add(row: Omit<T, "id">, at?: number): string {
    const id = `${this.prefix}${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const made = { ...row, id } as T;
    this.state.custom[id] = made;
    const index = at === undefined ? this.state.order.length : at;
    this.state.order.splice(Math.max(0, Math.min(index, this.state.order.length)), 0, id);
    this.commit();
    return id;
  }

  /**
   * Save an edit.
   *
   * A custom row is written through. A **built-in** is copied: the copy takes
   * the built-in's place in the palette, and the built-in itself is untouched
   * and still reachable from Restore defaults. Either way the id that comes
   * back is the one to point at afterwards.
   */
  save(id: string, row: Omit<T, "id">): string {
    if (!this.isDefault(id) && this.state.custom[id]) {
      this.state.custom[id] = { ...row, id } as T;
      this.commit();
      return id;
    }
    const at = this.state.order.indexOf(id);
    const made = this.add(row, at < 0 ? undefined : at + 1);
    if (at >= 0) this.state.order.splice(at, 1);
    if (this.state.selected === id) this.state.selected = made;
    this.commit();
    return made;
  }

  /** A copy of a row, in the palette right after it. */
  duplicate(id: string): string | null {
    const row = this.lookup(id);
    if (!row) return null;
    const at = this.state.order.indexOf(id);
    const { id: _drop, name, ...rest } = row as T & { name: string };
    return this.add(
      { ...(rest as unknown as Omit<T, "id" | "name">), name: `${name} copy` } as Omit<T, "id">,
      at < 0 ? undefined : at + 1,
    );
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (this.isDefault(id)) this.state.renamed[id] = trimmed;
    else if (this.state.custom[id]) this.state.custom[id] = { ...this.state.custom[id], name: trimmed };
    else return;
    this.commit();
  }

  /**
   * Take a row out of the palette.
   *
   * A custom row goes for good; a built-in is only taken out of the order,
   * because its geometry is in the binary and Restore defaults is the way
   * back. Either way anything already drawn with it keeps drawing — see
   * `get`.
   */
  remove(id: string): void {
    const at = this.state.order.indexOf(id);
    if (at >= 0) this.state.order.splice(at, 1);
    if (!this.isDefault(id)) delete this.state.custom[id];
    if (this.state.selected === id) this.state.selected = this.state.order[0] ?? null;
    this.commit();
  }

  /** Move a row to a new index in the palette. */
  reorder(id: string, to: number): void {
    const from = this.state.order.indexOf(id);
    if (from < 0) return;
    this.state.order.splice(from, 1);
    this.state.order.splice(Math.max(0, Math.min(to, this.state.order.length)), 0, id);
    this.commit();
  }

  /** Put back every built-in that has been taken out, in its own order. */
  restoreDefaults(): void {
    const have = new Set(this.state.order);
    const order: string[] = [];
    for (const row of this.defaults) {
      order.push(row.id);
      have.delete(row.id);
    }
    // Then everything custom, in the order it was already in.
    for (const id of this.state.order) {
      if (have.has(id)) order.push(id);
    }
    this.state.order = order;
    this.state.renamed = {};
    this.commit();
  }

  private lookup(id: string): T | null {
    const custom = this.state.custom[id];
    if (custom) return custom;
    const base = this.defaults.find((d) => d.id === id);
    if (!base) return null;
    const renamed = this.state.renamed[id];
    return renamed ? ({ ...base, name: renamed } as T) : base;
  }

  private commit(): void {
    this.write();
    this.dispatchEvent(new Event("change"));
  }

  private blank(): Stored<T> {
    return {
      version: 1,
      order: this.defaults.map((d) => d.id),
      custom: {},
      renamed: {},
      selected: this.defaults[0]?.id ?? null,
    };
  }

  /**
   * Read the library back, tolerating anything.
   *
   * A library that fails to parse is a library the app starts fresh with, not
   * one that stops the editor opening. The same reading `inspect-collapse.ts`
   * takes of its own key, and for the same reason: this is a preference, and
   * a preference is never worth an exception.
   */
  private read(): Stored<T> {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return this.blank();
      const parsed = JSON.parse(raw) as Partial<Stored<T>>;
      const custom = (parsed.custom ?? {}) as Record<string, T>;
      const order = (parsed.order ?? []).filter(
        (id) => typeof id === "string" && (custom[id] || this.isDefault(id)),
      );
      if (order.length === 0 && Object.keys(custom).length === 0) return this.blank();
      return {
        version: 1,
        order,
        custom,
        renamed: (parsed.renamed ?? {}) as Record<string, string>,
        selected: typeof parsed.selected === "string" ? parsed.selected : order[0] ?? null,
      };
    } catch {
      return this.blank();
    }
  }

  private write(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // A full or refused store is not worth failing an edit over: the
      // library stays right for this session and comes back as it was.
    }
  }
}
