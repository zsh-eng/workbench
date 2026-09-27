import type { BrowseRead } from "../../shared/browse";
import type { BrowseBlame } from "../../shared/inspect";
import type { BlameLoader } from "./blame";

export interface BlameCell {
  container: HTMLElement;
  entry: BrowseBlame["lines"][number];
}

/** Attribution follows Pierre's mounted number cells. At most one Git read runs
 * at a time, in 200-line pages; cache at most eight pages for this file version. */
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
  const cache = new Map<number, BrowseBlame>();
  const failed = new Set<number>();
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
      const page = Math.floor((line - 1) / 200);
      const entry = cache.get(page)?.lines.find((value) => value.line === line);
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

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void fill();
    }, 80);
  };
  const fill = async () => {
    if (!enabled || !file || !load || request || !host) return;
    const pages = [
      ...new Set(cells().map((cell) => Math.floor((Number(cell.dataset.columnNumber) - 1) / 200))),
    ]
      .filter((page) => page >= 0 && page * 200 < lineCount)
      .slice(0, 8);
    const page = pages.find((value) => !cache.has(value) && !failed.has(value));
    if (page === undefined) return;
    const current = new AbortController();
    request = current;
    try {
      const result = await load(
        file,
        page * 200 + 1,
        Math.min(lineCount, (page + 1) * 200),
        current.signal,
      );
      if (current.signal.aborted) return;
      cache.set(page, result);
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
      report(result.reason ?? "");
      paint();
    } catch (error) {
      if (!current.signal.aborted) {
        failed.add(page);
        report(error instanceof Error ? error.message : "Cannot read line history.");
      }
    } finally {
      if (request === current) {
        request = undefined;
        if (!current.signal.aborted) schedule();
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
      cache.clear();
      failed.clear();
      publish([]);
    },
  };
}
