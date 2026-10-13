import * as stylex from "@stylexjs/stylex";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { SessionEvent } from "../../../shared/agent-session";
import { createSessionStore } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { PaneHeader, PaneTree, usePaneTree, type PaneSpec } from "../PaneTree";
import type { PaneNode } from "../../data/pane-tree";
import { SessionThread } from "../session/SessionThread";
import { ToolButton } from "../ToolButton";
import { Section, Specimen } from "./Specimen";

const BASE = Date.UTC(2026, 9, 10, 9, 0, 0);
const events: SessionEvent[] = [
  {
    at: BASE,
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Read the review and fix what I commented." },
    },
  },
  {
    at: BASE + 30_000,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Run the tests",
      kind: "execute",
      status: "completed",
      rawInput: { command: "bun test" },
    },
  },
  {
    at: BASE + 42_000,
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "r1",
      content: {
        type: "text",
        text: "Weeks now come before months, and `bun test` passes. The review has a new iteration.",
      },
    },
  },
];
const files = [
  "src/web/data/relative-time.ts",
  "src/web/themes.ts",
  "tests/relative-time.test.ts",
  "README.md",
];

function SessionBody({ controls }: { controls: ReactNode }) {
  const [store] = useState(() => {
    const store = createSessionStore();
    store.applyAll(events);
    return store;
  });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <>
      <PaneHeader title="Session" detail="Weeks in relative times" controls={controls} />
      <div {...stylex.props(styles.body)}>
        <SessionThread snapshot={snapshot} />
      </div>
    </>
  );
}

function demoPanes(): PaneSpec[] {
  return [
    {
      id: "review",
      label: "Changes",
      ariaLabel: "Changes",
      icon: "diff",
      fixed: true,
      render: (controls) => (
        <>
          <PaneHeader title="Changes" detail="4 files" controls={controls} />
          <div {...stylex.props(styles.lines)} aria-hidden="true">
            {[72, 56, 88, 40, 64, 80, 52].map((width, index) => (
              <span key={index} {...stylex.props(styles.line(width))} />
            ))}
          </div>
        </>
      ),
    },
    {
      id: "session",
      label: "Thread",
      ariaLabel: "Agent session",
      icon: "claude",
      render: (controls) => <SessionBody controls={controls} />,
    },
    {
      id: "files",
      label: "Files",
      ariaLabel: "Workspace files",
      icon: "folder",
      render: (controls) => (
        <>
          <PaneHeader title="Files" detail="Working files · main" controls={controls} />
          <ul {...stylex.props(styles.files)}>
            {files.map((path) => (
              <li key={path} {...stylex.props(styles.file)}>
                <Icon name="file" size={13} />
                <span {...stylex.props(styles.directory)}>
                  {path.slice(0, path.lastIndexOf("/") + 1)}
                </span>
                {path.split("/").at(-1)}
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: "preview",
      label: "Preview",
      ariaLabel: "Markdown preview",
      icon: "preview",
      render: (controls) => (
        <>
          <PaneHeader title="Preview" detail="README.md" controls={controls} />
          <div {...stylex.props(styles.body, styles.scroll)}>
            <div {...stylex.props(styles.prose)}>
              <div className="med-md-prose">
                <h1>Trail notes</h1>
                <p>Weekly trail summaries for the hiking club, with best times as durations.</p>
              </div>
            </div>
          </div>
        </>
      ),
    },
  ];
}

const TOGGLES = [
  { id: "session", label: "Thread", icon: "claude", side: "left", share: 0.5 },
  { id: "files", label: "Files", icon: "folder", side: "right", share: 0.3 },
  { id: "preview", label: "Preview", icon: "preview", side: "below", share: 0.45 },
] as const;

const initial = (): PaneNode => ({
  axis: "row",
  children: [{ id: "session" }, { id: "review" }],
  sizes: [0.5, 0.5],
});

/** A workspace in small: the thread beside the changes, and toggles for more panes. */
function PaneDemo() {
  const panes = usePaneTree({ initial, persist: false });
  const [specs] = useState(demoPanes);
  return (
    <div {...stylex.props(styles.window)} data-pane-scope="">
      <div {...stylex.props(styles.toolbar)}>
        {TOGGLES.map((toggle) => (
          <ToolButton
            key={toggle.id}
            label={`${panes.isOpen(toggle.id) ? "Close" : "Open"} ${toggle.label.toLowerCase()}`}
            icon={toggle.icon}
            aria-pressed={panes.isOpen(toggle.id)}
            active={panes.isOpen(toggle.id)}
            onClick={() =>
              panes.toggle(toggle.id, { near: "review", side: toggle.side, share: toggle.share })
            }
          />
        ))}
        <span {...stylex.props(styles.grow)} />
        <ToolButton
          label="Balance panes"
          icon="split"
          disabled={panes.balanced}
          onClick={panes.balance}
        />
      </div>
      <PaneTree state={panes} panes={specs} />
    </div>
  );
}

/**
 * A workspace's panes tile its room, as splits in a terminal multiplexer do.
 * Each pane is a card; gutters between them resize them.
 */
export function PanesSection() {
  return (
    <Section
      id="panes"
      title="Panes"
      lede="A workspace's panes tile its room as a tree of splits. Drag a gutter to resize two panes; double-click it to give them the same room. ⌘E zooms the focused pane, and ⌘⌥ with an arrow moves focus to the next pane. Opening, closing, or zooming a pane never rebuilds the others, so each keeps its scroll and its thread."
    >
      <Specimen
        title="Tiled"
        note="The thread beside the changes. Open files to the right or a preview below; the pane beside it gives up its room."
        padded={false}
        zoomable={false}
      >
        <PaneDemo />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  window: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    height: 560,
    padding: 6,
    backgroundColor: tokens.panel,
  },
  toolbar: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 },
  grow: { flex: "1" },
  lines: { display: "flex", flexDirection: "column", gap: 12, padding: 20 },
  line: (width: number) => ({
    width: `${width}%`,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.fill,
  }),
  body: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  scroll: { overflowY: "auto" },
  prose: { paddingInline: 20, paddingBlock: 12, fontSize: 14 },
  files: { listStyle: "none", margin: 0, paddingBlock: 6, paddingInline: 8 },
  file: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 26,
    paddingInline: 6,
    color: tokens.text,
    fontSize: 12.5,
  },
  directory: { marginInlineEnd: -7, color: tokens.faint },
});
