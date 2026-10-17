import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import type { Thread } from "../../../shared/threads";
import { tokens } from "../../theme.stylex";

// The element that had the focus last outside a dialog, such as the diff
// before ⌘K opened the palette: a rename that the palette starts gives the
// focus back to it.
let lastFocus: HTMLElement | null = null;
document.addEventListener(
  "focusin",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && !target.closest('[role="dialog"], [data-rename-field]'))
      lastFocus = target;
  },
  true,
);

/**
 * The field that names a thread in place: in its sidebar row, or in the title
 * band. It starts with the shown name selected. Enter, or a click elsewhere,
 * keeps the new name; Esc keeps the old one. An empty name gives the thread
 * its agent's title again. After Enter or Esc, the focus goes back to where it
 * was, or to the thread's row.
 */
export function RenameField({
  thread,
  onDone,
  xstyle,
}: {
  thread: Thread;
  /** The new name, or null to keep the old one. */
  onDone(name: string | null): void;
  xstyle?: stylex.StyleXStyles;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const back = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    back.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest('[role="dialog"]')
        ? active
        : lastFocus;
    input.current!.focus();
    input.current!.select();
  }, []);
  const finish = (name: string | null, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
    if (!refocus) return;
    const id = thread.id;
    requestAnimationFrame(() => {
      const target = back.current?.isConnected
        ? back.current
        : document.querySelector<HTMLElement>(`[data-thread="${CSS.escape(id)}"]`);
      target?.focus({ preventScroll: true });
    });
  };
  return (
    <input
      ref={input}
      data-rename-field=""
      aria-label="Thread name"
      defaultValue={thread.title}
      placeholder={thread.agentTitle ?? thread.title}
      maxLength={120}
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === "Enter" ? event.currentTarget.value : null, true);
      }}
      onBlur={(event) => finish(event.currentTarget.value, false)}
      {...stylex.props(styles.field, xstyle)}
    />
  );
}

const styles = stylex.create({
  // The field takes the place of the name, in its type and size.
  field: {
    boxSizing: "border-box",
    flex: "1",
    minWidth: 0,
    width: "100%",
    marginBlock: -2,
    paddingBlock: 1,
    paddingInline: 5,
    marginInline: -6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.accentLine,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 3px ${tokens.accentSoft}`,
    color: tokens.text,
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    outline: "none",
  },
});
