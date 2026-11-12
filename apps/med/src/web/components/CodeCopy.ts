import type { RefObject } from "react";
import { copyFrame, useCopyFrames } from "./CopyFrame";

/**
 * Each code block of the host's rendered blocks in a frame with its Copy
 * button (CopyFrame.ts), which sits on the block's first line at its right
 * end. While the text still arrives (`open`), the last block waits: its fence
 * can be open, and each chunk draws it again, which would take the button
 * from under the pointer or the focus.
 */
function frameCode(host: HTMLElement, open: boolean) {
  const last = open ? host.querySelector(":scope > .med-md-block:last-child") : null;
  // A diagram's block is React's own (DiagramBlock): it stays as it is.
  const blocks = host.querySelectorAll<HTMLElement>(
    ".med-md-block pre:not(.med-md-block > pre[data-mermaid])",
  );
  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains("med-md-code") || last?.contains(pre)) continue;
    if (pre.querySelector(":scope > code")) copyFrame(pre, "code", "Copy code", true);
  }
}

/**
 * Copy on the code blocks of rendered Markdown: the code as its fence holds
 * it, without the line break before the closing fence. The button shows a
 * check for a moment, and the frame's note tells a screen reader.
 */
export function useCodeCopy(host: RefObject<HTMLElement | null>, streaming: boolean) {
  useCopyFrames(
    host,
    "code",
    {
      frame: (node) => frameCode(node, streaming),
      // The renderer ends the code with one line break of its own.
      copy: async (frame) =>
        navigator.clipboard.writeText(
          frame.querySelector(":scope > pre > code")!.textContent.replace(/\n$/, ""),
        ),
      done: "Copied",
    },
    streaming,
  );
}
