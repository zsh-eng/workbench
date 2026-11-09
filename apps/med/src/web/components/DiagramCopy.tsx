import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { copyDiagram, copyDiagramSvg } from "../markdown/copy";
import { ActionMenu } from "./Controls";
import { Icon } from "./Icon";
import type { PointMenuItem } from "./PointMenu";

/** What a copy put on the clipboard, or why it could not, for a moment. */
export interface CopyNote {
  id: number;
  text: string;
  failed?: boolean;
}

/** Why a copy failed, in a few words: a page without clipboard access, or an image that does not load. */
export function copyFailure(cause: unknown) {
  return cause instanceof DOMException && cause.name === "NotAllowedError"
    ? "Copying needs clipboard access"
    : cause instanceof Error && cause.message
      ? cause.message
      : "Could not copy";
}

/** The newest copy's note, which clears after a moment. */
export function useCopyNote() {
  const [note, setNote] = useState<CopyNote | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 1600);
    return () => clearTimeout(timer);
  }, [note]);
  const say = useCallback(
    (text: string, failed?: boolean) =>
      setNote((current) => ({ id: (current?.id ?? 0) + 1, text, ...(failed && { failed }) })),
    [],
  );
  return [note, say] as const;
}

/**
 * A diagram's copies: a PNG at twice its size on its surface, an SVG that
 * draws without the page's styles, and its Mermaid text. The right-click menu
 * and the Copy menu beside Full screen offer the same three.
 */
export function diagramCopies(
  /** The element that Pele draws in. */
  figure: () => Element | null | undefined,
  source: string,
  say: (text: string, failed?: boolean) => void,
) {
  const run = (copy: (drawn: SVGSVGElement) => Promise<void>, done: string) => () => {
    const drawn = figure()?.querySelector("svg");
    if (!drawn) return;
    copy(drawn).then(
      () => say(done),
      (cause: unknown) => say(copyFailure(cause), true),
    );
  };
  return [
    { label: "Copy as image", letter: "i", run: run(copyDiagram, "Diagram copied") },
    { label: "Copy as SVG", letter: "s", run: run(copyDiagramSvg, "SVG copied") },
    {
      label: "Copy text",
      letter: "t",
      // The code inside its fence, without the fence's last line break.
      run: () =>
        void navigator.clipboard.writeText(source.replace(/\s+$/, "")).then(
          () => say("Mermaid copied"),
          (cause: unknown) => say(copyFailure(cause), true),
        ),
    },
  ];
}

/** The copies as a right-click menu's items. */
export const pointItems = (copies: ReturnType<typeof diagramCopies>): PointMenuItem[] =>
  copies.map(({ label, run }) => ({ label, run }));

/**
 * Copy, as a menu from a button, so the keys reach what the right-click
 * menu offers. A letter chooses an item while the menu is open.
 */
export function DiagramCopyMenu({
  figure,
  source,
  say,
  copied,
  trigger,
  layer,
}: {
  figure: () => Element | null | undefined;
  source: string;
  say: (text: string, failed?: boolean) => void;
  /** A copy just finished: the button shows a check. */
  copied?: boolean;
  trigger?: stylex.StyleXStyles;
  layer?: "dialog";
}) {
  const copies = diagramCopies(figure, source, say);
  return (
    <ActionMenu
      label="Copy diagram"
      sections={[copies.map(({ label, letter, run }) => ({ label, letter, onClick: run }))]}
      trigger={trigger}
      layer={layer}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
    </ActionMenu>
  );
}

/** A copy's note beside the buttons that made it. The live region stays,
 * empty between copies, so a screen reader reads each note. */
export function CopyNoteText({ note }: { note: CopyNote | null }) {
  return (
    <span role="status" className="med-md-copy-note" data-failed={note?.failed ? "" : undefined}>
      {note?.text}
    </span>
  );
}
