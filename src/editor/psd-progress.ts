/**
 * What the PSD pipeline is doing right now, for anything that has to say so.
 *
 * Rebuilding a PSD and running psd-to-json over it is seconds of work, and
 * until those commands were moved off the main thread it was seconds of a
 * window that did not repaint — so there was nothing to show progress *with*,
 * and a spinner would have sat perfectly still through the wait it was there
 * to explain. See `#[tauri::command(async)]` in `lib.rs` and the note on
 * `psd_pipeline::exclusive`.
 *
 * The progress itself needs no new channel. `psd_pipeline` already names each
 * stage as it starts it — *Parsing psd/x.psd*, *Wrote assets/x/data.json* —
 * and emits it as `psd-log-line` for the console drawer. Those lines now
 * arrive as they happen, which makes them the honest thing to put in front of
 * somebody waiting: what the editor is doing, in the words it would have
 * written into the console anyway.
 *
 * **A payload with a newline in it is the layer tree.** That is the one line
 * of parsing here, and it is structural rather than a guess about wording:
 * `process` emits the whole of `format_layer_tree` as a single event, and
 * every stage line is an event of its own. A tree is what the file *contains*
 * rather than what is being done to it, so it belongs in the console and not
 * in a progress line.
 */

import { listen } from "@tauri-apps/api/event";

/**
 * Follow the pipeline's stages until the returned function is called.
 *
 * Every listener sees every job, because the event says nothing about which
 * file it belongs to. That is honest enough for the one caller: a person
 * applies one thing at a time, and the line names its own file.
 */
export function watchPsdStages(onStage: (stage: string) => void): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;

  void listen<string>("psd-log-line", (event) => {
    // The handler is live before `listen` resolves, so a line can arrive
    // after the caller has already stopped listening.
    if (stopped) return;
    const line = String(event.payload);
    if (line.includes("\n")) return;
    const stage = line.trim();
    if (stage) onStage(stage);
  }).then((off) => {
    // The subscription can outlive the thing that asked for it: `listen`
    // resolves a tick later, and a pen session can be over by then.
    if (stopped) off();
    else unlisten = off;
  });

  return () => {
    stopped = true;
    unlisten?.();
    unlisten = null;
  };
}
