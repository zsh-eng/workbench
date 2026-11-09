import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { copyTable } from "../markdown/copy";
import { copyFailure } from "./DiagramCopy";
import { iconMarkup } from "./Icon";

const COPY_ICON = iconMarkup("copy", 14);
const COPIED_ICON = iconMarkup("check", 14);

/**
 * Each table in a frame with its Copy button, which shows while the pointer
 * or the focus is on the table. The frame has no margins of its own, so the
 * table's collapse through it and the page lays out as before; the button
 * sits in the margin above the table's right end (MarkdownPreview.css).
 * `note` adds the line that says what the copy did, where the page has no
 * other place for it.
 */
export function frameTables(host: HTMLElement, { note = false } = {}) {
  for (const table of host.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.classList.contains("med-md-table")) continue;
    const frame = document.createElement("div");
    frame.className = "med-md-table";
    // The button and the note are not prose: a brief's passages skip them.
    table.before(frame);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "med-md-copy";
    button.dataset.copy = "table";
    button.setAttribute("aria-label", "Copy table");
    button.dataset.tooltip = "Copy table";
    button.innerHTML = COPY_ICON;
    button.dataset.passageUi = "";
    frame.append(table, button);
    if (note) {
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      status.className = "med-md-copy-note";
      status.dataset.passageUi = "";
      frame.append(status);
    }
  }
}

/**
 * Copy on the tables of rendered Markdown: as their Markdown, from the lines
 * of `text()` that they came from, and as a table that rich editors and
 * spreadsheets paste. The button shows a check for a moment. `say` tells the
 * page's own notice what happened; without it, each table's note does.
 */
export function useTableCopy(
  host: RefObject<HTMLElement | null>,
  text: () => string,
  say?: (message: string, failed?: boolean) => void,
) {
  const latest = useRef({ text, say });
  useLayoutEffect(() => {
    latest.current = { text, say };
  });
  const note = !say;
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    frameTables(node, { note });
    // Blocks render after the first paint, and again as a reply streams.
    const observer = new MutationObserver(() => {
      if (node.querySelector("table:not(.med-md-table > table)")) frameTables(node, { note });
    });
    observer.observe(node, { childList: true, subtree: true });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (run: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, 1400);
      timers.add(timer);
    };
    const click = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button.med-md-copy[data-copy='table']",
      );
      const frame = button?.parentElement;
      const table = frame?.querySelector<HTMLElement>(":scope > table");
      if (!button || !frame || !table || !node.contains(button)) return;
      const status = frame.querySelector<HTMLElement>(":scope > .med-md-copy-note");
      const tell = (message: string, failed?: boolean) => {
        const { say } = latest.current;
        if (say) return say(message, failed);
        if (!status) return;
        status.textContent = message;
        frame.dataset.noted = "";
        later(() => {
          status.textContent = "";
          delete frame.dataset.noted;
        });
      };
      copyTable(latest.current.text(), table).then(
        () => {
          button.innerHTML = COPIED_ICON;
          button.dataset.copied = "";
          later(() => {
            button.innerHTML = COPY_ICON;
            delete button.dataset.copied;
          });
          tell("Table copied");
        },
        (cause: unknown) => tell(copyFailure(cause), true),
      );
    };
    node.addEventListener("click", click);
    return () => {
      observer.disconnect();
      node.removeEventListener("click", click);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [host, note]);
}
