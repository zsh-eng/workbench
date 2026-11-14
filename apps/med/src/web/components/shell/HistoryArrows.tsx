import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import { platform } from "../../data/keys";
import { useHistorySteps } from "../../data/navigation";
import { tokens } from "../../theme.stylex";
import { ToolButton } from "../ToolButton";

/**
 * Back and Forward through the steps the reader took: workspaces, pages that
 * cover them, a thread's pages and files, and its reviews (navigation.ts).
 * They sit after the sidebar's toggle, as in Claude's desktop app: in the
 * sidebar's top row while it shows, in the title band while it hides.
 */
export function HistoryArrows({ narrow }: { narrow?: "hide" }) {
  const { back, forward } = useHistorySteps();
  return (
    <span {...stylex.props(styles.arrows, narrow === "hide" && styles.narrowHides)}>
      <ToolButton
        label="Back"
        shortcut={platform === "mac" ? "Ctrl+-" : undefined}
        icon="arrowLeft"
        disabled={!back}
        onClick={() => history.back()}
      />
      <ToolButton
        label="Forward"
        shortcut={platform === "mac" ? "Ctrl+Shift+-" : undefined}
        icon="arrowRight"
        disabled={!forward}
        onClick={() => history.forward()}
      />
    </span>
  );
}

/**
 * The arrows' keys, once for the window, wherever the arrows are: ⌘[ and ⌘],
 * as in a browser, outside a text field or the editor, where they indent;
 * ⌃- and ⌃⇧-, as in VS Code, from anywhere.
 */
export function useHistoryKeys() {
  useEffect(() => {
    const go = (event: KeyboardEvent) => {
      if (event.altKey) return;
      // Elsewhere, Control and minus zoom out, and Alt and the arrows go back.
      const vscode =
        platform === "mac" && event.ctrlKey && !event.metaKey && event.code === "Minus";
      const browser =
        event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (event.code === "BracketLeft" || event.code === "BracketRight");
      if (!vscode && !browser) return;
      const target = event.target as HTMLElement | null;
      if (
        browser &&
        (target?.isContentEditable || target?.closest("input, textarea, select, .cm-editor"))
      )
        return;
      event.preventDefault();
      if (vscode ? event.shiftKey : event.code === "BracketRight") history.forward();
      else history.back();
    };
    window.addEventListener("keydown", go);
    return () => window.removeEventListener("keydown", go);
  }, []);
}

const styles = stylex.create({
  arrows: { display: "inline-flex", flexShrink: 0, gap: 0, color: tokens.muted },
  // A narrow title band gives their room to the workspace; their keys still go.
  narrowHides: { display: { default: "inline-flex", "@container (max-width: 480px)": "none" } },
});
