import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Thread } from "../../../shared/threads";
import { needsYou } from "../../data/threads";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

/**
 * A stream of work: a named group of tabs that the reader keeps until the
 * work is done, then closes as one (the durable sessions design). With
 * streams, the sidebar groups tabs by stream in place of repository.
 */
export interface SidebarStream {
  id: string;
  name: string;
  /** Its tabs' IDs, in the reader's order. */
  threads: readonly string[];
  collapsed?: boolean;
}

export interface StreamActions {
  toggle(stream: SidebarStream): void;
  rename(stream: SidebarStream, name: string): void;
  /** Starts a thread in the stream. */
  newThread?(stream: SidebarStream): void;
  /** Sends the stream to history with its tabs, and stops their agents. */
  close(stream: SidebarStream): void;
}

/** What a collapsed stream says about its tabs, most urgent first. */
export function streamSummary(threads: readonly Thread[]) {
  const needs = threads.filter(needsYou).length;
  const working = threads.filter(
    (thread) => thread.state === "working" && !needsYou(thread),
  ).length;
  const parts = [
    ...(needs ? [`${needs} needs you`] : []),
    ...(working ? [`${working} working`] : []),
  ];
  return parts.length
    ? parts.join(" · ")
    : `${threads.length} ${threads.length === 1 ? "tab" : "tabs"}`;
}

/**
 * A stream's header in the sidebar. A click on it folds or unfolds the
 * stream; a double-click names it in place, as Dia names a tab. A folded
 * stream counts what its tabs need. Close asks first while an agent works,
 * because closing stops the stream's agents.
 */
export function StreamHeader({
  stream,
  threads,
  actions,
  renaming,
  onRenaming,
  startConfirming = false,
}: {
  stream: SidebarStream;
  threads: readonly Thread[];
  actions: StreamActions;
  /** The header shows its name field. */
  renaming: boolean;
  onRenaming(renaming: boolean): void;
  /** Starts on the close question, as the Elements page shows it. */
  startConfirming?: boolean;
}) {
  // "asked": the reader pressed Close, so the question takes the focus.
  const [confirming, setConfirming] = useState<"no" | "shown" | "asked">(
    startConfirming ? "shown" : "no",
  );
  // A turn that waits for an answer runs too: closing stops it.
  const working = threads.filter(
    (thread) => thread.state === "working" || thread.state === "waiting",
  );
  const close = () => (working.length ? setConfirming("asked") : actions.close(stream));
  const collapsed = !!stream.collapsed;
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setConfirming("no");
  };

  if (confirming !== "no")
    return (
      <div
        role="alertdialog"
        aria-label={`Close ${stream.name}`}
        {...stylex.props(styles.header, styles.confirm)}
      >
        <span {...stylex.props(styles.confirmText)}>
          <span {...stylex.props(styles.confirmTitle)}>Close {stream.name}?</span>{" "}
          {working.length === 1
            ? `${working[0]!.title} is working; closing stops it.`
            : working.length === 2
              ? `${working[0]!.title} and ${working[1]!.title} are working; closing stops them.`
              : `${working.length} agents are working; closing stops them.`}
        </span>
        <span {...stylex.props(styles.confirmActions)}>
          <button
            type="button"
            onClick={() => setConfirming("no")}
            onKeyDown={cancelOnEscape}
            {...stylex.props(ui.button, styles.small)}
          >
            Cancel
          </button>
          <AutoFocus on={confirming === "asked"}>
            <button
              type="button"
              onKeyDown={cancelOnEscape}
              onClick={() => {
                setConfirming("no");
                actions.close(stream);
              }}
              {...stylex.props(ui.button, ui.outlined, styles.small, styles.stop)}
            >
              Stop and close
            </button>
          </AutoFocus>
        </span>
      </div>
    );

  return (
    <div data-stream={stream.id} {...stylex.props(styles.header, stylex.defaultMarker())}>
      {renaming ? (
        <span {...stylex.props(styles.toggle, styles.editing)}>
          <span {...stylex.props(styles.chevron, collapsed && styles.chevronClosed)}>
            <Icon name="chevron" size={12} />
          </span>
          <StreamNameField
            name={stream.name}
            onDone={(name) => {
              onRenaming(false);
              if (name !== null && name.trim() && name.trim() !== stream.name)
                actions.rename(stream, name.trim());
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          aria-expanded={!collapsed}
          title="Double-click to rename"
          onClick={(event) => {
            // The second click of a double-click undoes the first one's fold.
            actions.toggle(stream);
            if (event.detail === 2) onRenaming(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "F2") {
              event.preventDefault();
              onRenaming(true);
            } else if (
              (event.key === "ArrowLeft" && !collapsed) ||
              (event.key === "ArrowRight" && collapsed)
            ) {
              event.preventDefault();
              actions.toggle(stream);
            }
          }}
          data-sidebar-row=""
          {...stylex.props(styles.toggle)}
        >
          <span {...stylex.props(styles.chevron, collapsed && styles.chevronClosed)}>
            <Icon name="chevron" size={12} />
          </span>
          <span {...stylex.props(styles.name)}>{stream.name}</span>
          {collapsed && <span {...stylex.props(styles.summary)}>{streamSummary(threads)}</span>}
        </button>
      )}
      {!renaming && (
        <span {...stylex.props(styles.actions)}>
          {actions.newThread && (
            <button
              type="button"
              aria-label={`New thread in ${stream.name}`}
              title={`New thread in ${stream.name} (⌥N)`}
              onClick={() => actions.newThread?.(stream)}
              {...stylex.props(styles.action)}
            >
              <Icon name="plus" size={12} />
            </button>
          )}
          <button
            type="button"
            aria-label={`Close ${stream.name}`}
            title="Close stream: its tabs go to history"
            onClick={close}
            {...stylex.props(styles.action)}
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

/** The stream's tabs, folded away with a short slide while it is collapsed.
 * A folded list is inert, so ↑ and ↓ and Tab skip its rows. */
export function StreamTabs({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fold, collapsed && styles.folded)} inert={collapsed}>
      <div {...stylex.props(styles.foldInner)}>{children}</div>
    </div>
  );
}

function AutoFocus({ on, children }: { on: boolean; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (on) box.current?.querySelector("button")?.focus();
  }, [on]);
  return (
    <span ref={box} {...stylex.props(styles.contents)}>
      {children}
    </span>
  );
}

/** The stream's name in place: Enter keeps it, Esc or an empty name keeps the old one. */
function StreamNameField({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    input.current!.focus();
    input.current!.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      ref={input}
      aria-label="Stream name"
      defaultValue={name}
      placeholder={name}
      maxLength={80}
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === "Enter" ? event.currentTarget.value : null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      {...stylex.props(styles.field)}
    />
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    height: 28,
    marginBottom: 2,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: "1",
    minWidth: 0,
    height: 28,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  editing: { cursor: "text", backgroundColor: "transparent" },
  chevron: {
    display: "inline-flex",
    flexShrink: 0,
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "150ms",
  },
  chevronClosed: { transform: "rotate(-90deg)" },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  summary: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontWeight: 450,
    fontVariantNumeric: "tabular-nums",
  },
  // The stream's own controls show while the pointer or the focus is on it.
  actions: {
    display: "flex",
    gap: 1,
    flexShrink: 0,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
  },
  action: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  confirm: {
    height: "auto",
    flexWrap: "wrap",
    gap: 6,
    paddingBlock: 7,
    paddingInline: 8,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  confirmText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 0,
    color: tokens.text,
    fontSize: 12,
    lineHeight: 1.45,
  },
  confirmTitle: { fontWeight: 600 },
  confirmActions: { display: "flex", gap: 4, marginInlineStart: "auto" },
  small: { height: 24, paddingInline: 8, fontSize: 12 },
  stop: { color: tokens.red },
  contents: { display: "contents" },
  field: {
    boxSizing: "border-box",
    flex: "1",
    minWidth: 0,
    marginBlock: -2,
    paddingBlock: 1,
    paddingInline: 5,
    marginInlineStart: -6,
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
  fold: {
    display: "grid",
    gridTemplateRows: "1fr",
    transitionProperty: "grid-template-rows",
    transitionDuration: { default: "160ms", "@media (prefers-reduced-motion: reduce)": "0s" },
    transitionTimingFunction: tokens.easeOut,
  },
  folded: { gridTemplateRows: "0fr" },
  foldInner: { minHeight: 0, overflow: "hidden" },
});
