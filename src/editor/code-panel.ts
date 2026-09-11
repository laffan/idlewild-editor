/**
 * Where the code modal lives in the shell, and what pinning it means.
 *
 * The modal itself is `code/code-modal.ts` — the file tree, the editor and the
 * reference along the bottom. What it cannot decide for itself is where in the
 * page it sits, because that is a fact about the editor's layout rather than
 * about editing code: unpinned it covers the whole shell, and pinned it is a
 * row between the canvas and the console, on a divider of its own so the two
 * stacked panels are sized the same way. So the modal reports the pin and this
 * acts on it.
 *
 * The divider is rebuilt on each pin rather than kept, and its height is
 * restored from storage — which is what makes the docked panel come back the
 * size it was left at, within a session and across them.
 */

import { CodeModal } from "../code/code-modal";
import { createResizer, type Resizer } from "./resizer";

export class CodePanel {
  private readonly projectId: string;
  private readonly shell: HTMLElement;
  /** The console drawer: docked, the panel goes in above it. */
  private readonly before: HTMLElement;

  private modal: CodeModal | null = null;
  private resizer: Resizer | null = null;

  constructor(projectId: string, shell: HTMLElement, before: HTMLElement) {
    this.projectId = projectId;
    this.shell = shell;
    this.before = before;
  }

  get open(): boolean {
    return this.modal !== null;
  }

  toggle(): void {
    if (this.modal) this.destroy();
    else this.show();
  }

  /** Close it, leaving the shell as it was. Safe to call when it is not up. */
  destroy(): void {
    this.modal?.destroy();
    this.modal = null;
    this.resizer?.destroy();
    this.resizer = null;
  }

  private show(): void {
    this.modal = new CodeModal(
      this.projectId,
      () => this.destroy(),
      (pinned) => this.setPinned(pinned),
    );
    this.shell.appendChild(this.modal.root);
  }

  /**
   * Move the panel between floating over the canvas and sitting as a row of
   * the shell above the console.
   */
  private setPinned(pinned: boolean): void {
    const modal = this.modal;
    if (!modal) return;

    if (!pinned) {
      this.resizer?.destroy();
      this.resizer = null;
      this.shell.appendChild(modal.root);
      return;
    }

    this.resizer = createResizer({
      target: modal.root,
      axis: "height",
      edge: "start",
      min: 140,
      max: 720,
      storageKey: "codeHeight",
    });
    this.shell.insertBefore(this.resizer.handle, this.before);
    this.shell.insertBefore(modal.root, this.before);
    this.resizer.restore();
  }
}
