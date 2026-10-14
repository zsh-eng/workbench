import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import type { Thread } from "../../../shared/threads";
import {
  attemptEntries,
  attemptName,
  openAttempts,
  useAttemptsAddress,
  type AttemptGroup,
} from "../../data/attempts";
import { shortAge } from "../../data/threads";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";

/**
 * Sidebar rows for threads, with the attempts of one task as one group row.
 * `row` draws one thread's row, here with the attempt's letter and agent as
 * its name.
 */
export function withAttempts(
  threads: readonly Thread[],
  row: (thread: Thread, name?: string) => ReactNode,
  options: { current: string | null; now: number },
) {
  return attemptEntries(threads).map((entry) =>
    entry.kind === "thread" ? (
      row(entry.thread)
    ) : (
      <AttemptGroupRow
        key={`attempts:${entry.group.id}`}
        group={entry.group}
        row={row}
        {...options}
      />
    ),
  );
}

/**
 * A task that several agents do: one row that opens the Attempts page, with
 * the attempts under it. The attempts fold when all of them are done, unless
 * one is open; the chevron, → and ← fold them by hand.
 */
function AttemptGroupRow({
  group,
  row,
  current,
  now,
}: {
  group: AttemptGroup;
  row(thread: Thread, name?: string): ReactNode;
  current: string | null;
  now: number;
}) {
  const shown = useAttemptsAddress() === group.id;
  const working = group.attempts.some((thread) => thread.state === "working");
  const waiting = group.attempts.some((thread) => thread.state === "waiting");
  const holdsCurrent = group.attempts.some((thread) => thread.id === current);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (working || waiting || holdsCurrent);
  const updatedAt = Math.max(...group.attempts.map((thread) => thread.updatedAt));
  const label = open ? "Hide attempts" : "Show attempts";
  return (
    <li data-attempt-group={group.id} {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.head, shown && styles.current)}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          aria-expanded={open}
          title={label}
          onClick={() => setChoice(!open)}
          {...stylex.props(styles.toggle)}
        >
          <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
            <Icon name="chevron" size={12} />
          </span>
        </button>
        <button
          type="button"
          data-sidebar-row=""
          aria-current={shown ? "page" : undefined}
          onClick={() => openAttempts(group.id)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            setChoice(event.key === "ArrowRight");
          }}
          {...stylex.props(styles.main)}
        >
          <span {...stylex.props(styles.titleLine)}>
            <span {...stylex.props(styles.title)}>{group.title}</span>
            <span {...stylex.props(styles.age, waiting && styles.needsYou)}>
              {working ? "Working" : waiting ? "Needs you" : shortAge(updatedAt, now)}
            </span>
          </span>
          <span {...stylex.props(styles.detail)}>
            <Icon name="compare" size={11} />
            {group.attempts.length} attempts
            {!working && !waiting && <span {...stylex.props(styles.ready)}>· Compare</span>}
          </span>
        </button>
      </div>
      {open && (
        <ul aria-label={`Attempts at ${group.title}`} {...stylex.props(styles.list)}>
          {group.attempts.map((thread) => row(thread, attemptName(thread)))}
        </ul>
      )}
    </li>
  );
}

const styles = stylex.create({
  item: { listStyle: "none" },
  // As a thread row: the hover and the current row cover the chevron too.
  head: {
    display: "flex",
    alignItems: "flex-start",
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    transitionProperty: "background-color, color",
    transitionDuration: "120ms",
  },
  current: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 30,
    height: 32,
    paddingInlineStart: 8,
    paddingInlineEnd: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.faint,
    cursor: "pointer",
  },
  chevron: {
    display: "inline-flex",
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: "150ms",
  },
  chevronOpen: { transform: "rotate(0deg)" },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: "1",
    minWidth: 0,
    paddingBlock: 7,
    paddingInlineStart: 1,
    paddingInlineEnd: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  titleLine: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, lineHeight: "18px" },
  title: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  age: { flexShrink: 0, color: tokens.faint, fontSize: 11, fontVariantNumeric: "tabular-nums" },
  needsYou: { color: tokens.accent, fontWeight: 500 },
  detail: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11,
    lineHeight: "15px",
  },
  ready: { color: tokens.muted },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    paddingInlineStart: 12,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    marginTop: 1,
  },
});
