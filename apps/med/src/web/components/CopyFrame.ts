import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { copyFailure } from "./DiagramCopy";
import { iconMarkup } from "./Icon";

const COPY_ICON = iconMarkup("copy", 14);
const COPIED_ICON = iconMarkup("check", 14);
/** How long a button shows its check and a note its text. */
const SHOWN_MS = 1400;

type CopyKind = "table" | "code";

/**
 * A frame around a table or a code block of rendered Markdown, with its Copy
 * button, which shows while the pointer or the focus is on the frame
 * (MarkdownPreview.css). The frame has no margins of its own, so its
 * content's collapse through it and the page lays out as before. `note` adds
 * the line that says what the copy did, where the page has no other place
 * for it.
 */
export function copyFrame(target: HTMLElement, kind: CopyKind, label: string, note: boolean) {
  const frame = document.createElement("div");
  frame.className = `med-md-${kind}`;
  target.before(frame);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "med-md-copy";
  button.dataset.copy = kind;
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.innerHTML = COPY_ICON;
  // The button and the note are not prose: a brief's passages skip them.
  button.dataset.passageUi = "";
  frame.append(target, button);
  if (note) {
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    status.className = "med-md-copy-note";
    status.dataset.passageUi = "";
    frame.append(status);
  }
}

/**
 * Copy on the frames of one kind in rendered Markdown. `frame` puts a frame
 * on what has none: it runs now, when `key` changes, and each time the
 * host's blocks change, as they do after the first paint and while a reply
 * streams. A click on a frame's button runs `copy`; the button then shows a
 * check for a moment. `say` tells the page's own notice what happened;
 * without it, the frame's note does.
 */
export function useCopyFrames(
  host: RefObject<HTMLElement | null>,
  kind: CopyKind,
  options: {
    frame(host: HTMLElement): void;
    copy(frame: HTMLElement): Promise<void>;
    /** What the note says after a copy. */
    done: string;
    say?(message: string, failed?: boolean): void;
  },
  key?: unknown,
) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (host.current) latest.current.frame(host.current);
  }, [host, key]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new MutationObserver(() => latest.current.frame(node));
    observer.observe(node, { childList: true, subtree: true });
    // One timer for each button and each note: a second copy starts its moment again.
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const later = (owner: HTMLElement, run: () => void) => {
      clearTimeout(timers.get(owner));
      timers.set(
        owner,
        setTimeout(() => {
          timers.delete(owner);
          run();
        }, SHOWN_MS),
      );
    };
    const click = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        `button.med-md-copy[data-copy='${kind}']`,
      );
      const frame = button?.parentElement;
      if (!button || !frame || !node.contains(button)) return;
      const status = frame.querySelector<HTMLElement>(":scope > .med-md-copy-note");
      const tell = (message: string, failed?: boolean) => {
        const { say } = latest.current;
        if (say) return say(message, failed);
        if (!status) return;
        status.textContent = message;
        status.toggleAttribute("data-failed", !!failed);
        frame.dataset.noted = "";
        later(status, () => {
          status.textContent = "";
          delete frame.dataset.noted;
        });
      };
      latest.current.copy(frame).then(
        () => {
          button.innerHTML = COPIED_ICON;
          button.dataset.copied = "";
          later(button, () => {
            button.innerHTML = COPY_ICON;
            delete button.dataset.copied;
          });
          tell(latest.current.done);
        },
        (cause: unknown) => tell(copyFailure(cause), true),
      );
    };
    node.addEventListener("click", click);
    return () => {
      observer.disconnect();
      node.removeEventListener("click", click);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [host, kind]);
}
