import type { BrowseRead } from "../../shared/browse";
import type { BrowseBlame } from "../../shared/inspect";
import { blamePage, cachedBlame, loadBlamePage, type BlameLoader } from "./blame";

export interface BlameCell {
  container: HTMLElement;
  entry: BrowseBlame["lines"][number];
}

/** Attribution follows Pierre's mounted number cells. It reads only while shown,
 * one 200-line page at a time, into the cache that the line blame shares. */
export function createBlameGutter(
  file: BrowseRead | null,
  load: BlameLoader | undefined,
  enabled: boolean,
  report: (message: string) => void,
) {
  let visible = false;
  let snapshot: BlameCell[] = [];
  const listeners = new Set<() => void>();
  let notifyPending = false;
  const publish = (next: BlameCell[]) => {
    if (
      next.length === snapshot.length &&
      next.every(
        (cell, i) => cell.container === snapshot[i]!.container && cell.entry === snapshot[i]!.entry,
      )
    )
      return;
    snapshot = next;
    if (!notifyPending) {
      notifyPending = true;
      queueMicrotask(() => {
        notifyPending = false;
        for (const listener of listeners) listener();
      });
    }
  };
  let host: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const failed = new Set<number>();
  let reported: string | undefined;
  // The view rerenders for a notice, so only a changed message reaches it.
  const notice = (message: string) => {
    if (message === reported) return;
    reported = message;
    report(message);
  };
  const lineCount = Math.min(200_000, file?.text?.replace(/\n$/, "").split("\n").length ?? 0);
  const cells = () => [
    ...((host?.shadowRoot ?? host)?.querySelectorAll<HTMLElement>("[data-column-number]") ?? []),
  ];
  const clear = () =>
    (host?.shadowRoot ?? host)
      ?.querySelectorAll("[data-med-blame]")
      .forEach((node) => node.remove());
  const paint = () => {
    if (!visible) {
      clear();
      publish([]);
      return;
    }
    const next: BlameCell[] = [];
    for (const cell of cells()) {
      const line = Number(cell.dataset.columnNumber);
      const entry =
        file && load
          ? cachedBlame(load, file, blamePage(line))?.lines.find((value) => value.line === line)
          : undefined;
      let label = cell.querySelector<HTMLElement>("[data-med-blame]");
      if (!entry) {
        label?.remove();
        continue;
      }
      if (!label) {
        label = document.createElement("span");
        label.dataset.medBlame = String(line);
        cell.prepend(label);
      }
      next.push({ container: label, entry });
    }
    publish(next);
  };

  // Scrolling waits briefly for the rows to settle; the next page follows at once.
  const schedule = (delay = 80) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void fill();
    }, delay);
  };
  const fill = async () => {
    if (!enabled || !visible || !file || !load || request || !host) return;
    const pages = [...new Set(cells().map((cell) => blamePage(Number(cell.dataset.columnNumber))))]
      .filter((page) => page >= 0 && page * 200 < lineCount)
      .slice(0, 8);
    const page = pages.find((value) => !cachedBlame(load, file, value) && !failed.has(value));
    if (page === undefined) return;
    const current = new AbortController();
    request = current;
    try {
      const result = await loadBlamePage(load, file, page, lineCount, current.signal);
      if (current.signal.aborted) return;
      notice(result.reason ?? "");
      paint();
    } catch (error) {
      if (!current.signal.aborted) {
        failed.add(page);
        notice(error instanceof Error ? error.message : "Cannot read line history.");
      }
    } finally {
      if (request === current) {
        request = undefined;
        if (!current.signal.aborted) schedule(0);
      }
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setVisible(next: boolean) {
      visible = next && enabled;
      paint();
      if (visible) schedule(0);
      else {
        clearTimeout(timer);
        request?.abort();
        request = undefined;
      }
    },
    update(node: HTMLElement, phase: string) {
      if (phase === "unmount") {
        if (host === node) {
          clear();
          host = null;
          publish([]);
        }
        return;
      }
      host = node;
      if (!enabled) {
        clear();
        publish([]);
        return;
      }
      paint();
      schedule();
    },
    dispose() {
      clearTimeout(timer);
      request?.abort();
      request = undefined;
      clear();
      host = null;
      failed.clear();
      publish([]);
    },
  };
}
