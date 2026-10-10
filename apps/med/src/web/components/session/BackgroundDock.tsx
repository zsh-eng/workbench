import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { SessionItem } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { motion, rowStyles } from "./session-styles";
import { formatSeconds } from "./ToolCall";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;

/** A local address that a dev server prints, such as http://localhost:5173/. */
const ADDRESS =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(?::\d{2,5})?\/?[^\s"'`)]*/;

function backgroundTasks(items: SessionItem[], found: ToolItem[] = []) {
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (item.call.background) found.push(item);
    backgroundTasks(item.items, found);
  }
  return found;
}

function addressOf(item: ToolItem) {
  for (const part of item.call.content)
    if (part.type === "content" && part.content.type === "text") {
      const match = ADDRESS.exec(part.content.text);
      if (match) return match[0].replace(/\/$/, "");
    }
  return undefined;
}

/**
 * Shells and agents that run in the background, as Claude Desktop lists
 * them: running ones first, with the local address a dev server printed.
 * A task's name scrolls the thread to the call that started it.
 */
export function BackgroundDock({ items, now }: { items: SessionItem[]; now?: number }) {
  const [open, setOpen] = useState(true);
  const tasks = backgroundTasks(items);
  if (!tasks.length) return null;
  const isRunning = (item: ToolItem) =>
    item.call.status === "pending" || item.call.status === "in_progress";
  const running = tasks.filter(isRunning);
  const ordered = [...running, ...tasks.filter((item) => !isRunning(item)).reverse()];
  return (
    <section aria-label="Background tasks" {...stylex.props(styles.dock)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(rowStyles.row, styles.head)}
      >
        <span {...stylex.props(rowStyles.icon)}>
          {running.length ? (
            <span {...stylex.props(motion.spinner)} />
          ) : (
            <Icon name="terminal" size={14} />
          )}
        </span>
        <span {...stylex.props(styles.label)}>Background</span>
        <span {...stylex.props(styles.count)}>
          {running.length ? `${running.length} running` : `${tasks.length} done`}
        </span>
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(styles.chevron, open ? styles.chevronOpen : styles.chevronUp)}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <ul {...stylex.props(styles.list)}>
          {ordered.map((item) => {
            const live = isRunning(item);
            const address = live ? addressOf(item) : undefined;
            const elapsed = (live ? (now ?? item.at) : (item.endedAt ?? item.at)) - item.at;
            return (
              <li key={item.id} {...stylex.props(styles.task)}>
                <span {...stylex.props(styles.kind)}>
                  <Icon
                    name={item.call.background!.kind === "agent" ? "agent" : "terminal"}
                    size={13}
                  />
                </span>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .querySelector(`[data-tool-call-id="${CSS.escape(item.id)}"]`)
                      ?.scrollIntoView({ block: "center", behavior: "smooth" })
                  }
                  {...stylex.props(styles.name, !live && styles.finished)}
                >
                  {item.call.title}
                </button>
                {address && (
                  <a
                    href={address}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.props(styles.address)}
                  >
                    {address.replace(/^https?:\/\//, "")}
                  </a>
                )}
                <span
                  {...stylex.props(styles.state, item.call.status === "failed" && styles.failed)}
                >
                  {live
                    ? elapsed >= 1000
                      ? formatSeconds(elapsed)
                      : "Running"
                    : item.call.status === "failed"
                      ? "Failed"
                      : "Done"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const styles = stylex.create({
  dock: {
    flexShrink: 0,
    marginInline: 12,
    marginBottom: 8,
    paddingInline: 10,
    paddingBlock: 2,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  head: { cursor: "pointer", gap: 8 },
  label: { color: tokens.text, fontWeight: 500 },
  count: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  grow: { flex: "1" },
  chevron: {
    display: "flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
  },
  chevronOpen: { transform: "rotate(0deg)" },
  chevronUp: { transform: "rotate(180deg)" },
  list: {
    listStyle: "none",
    margin: 0,
    paddingTop: 0,
    paddingBottom: 8,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  task: { display: "flex", alignItems: "center", gap: 8, minHeight: 24, fontSize: 12.5 },
  kind: {
    display: "flex",
    width: 16,
    justifyContent: "center",
    color: tokens.faint,
    flexShrink: 0,
  },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.text, ":hover": tokens.accent },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
  },
  finished: { color: tokens.muted },
  address: {
    flexShrink: 0,
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 999,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontFamily: tokens.code,
    fontSize: 11,
    textDecoration: "none",
  },
  state: { flexShrink: 0, color: tokens.faint, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  failed: { color: tokens.red },
});
