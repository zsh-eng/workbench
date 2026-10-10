import * as stylex from "@stylexjs/stylex";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { SessionEvent } from "../../../shared/agent-session";
import { createSessionStore } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import {
  PaneColumn,
  PaneHeader,
  usePaneColumn,
  type PaneLayout,
  type PaneSpec,
} from "../PaneColumn";
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
      <PaneHeader
        icon="claude"
        title="Session"
        detail="Weeks in relative times"
        controls={controls}
      />
      <div {...stylex.props(styles.body)}>
        <SessionThread snapshot={snapshot} />
      </div>
    </>
  );
}

function demoPanes(): PaneSpec[] {
  return [
    {
      id: "session",
      label: "Session",
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
          <PaneHeader
            icon="folder"
            title="Files"
            detail="Working files · main"
            controls={controls}
          />
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
          <PaneHeader icon="preview" title="Preview" detail="README.md" controls={controls} />
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
  { id: "session", label: "Session", icon: "claude" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "preview", label: "Preview", icon: "preview" },
] as const;

/** A review window in small: the main view, the pane toggles, and the column. */
function PaneDemo({ layout }: { layout: PaneLayout }) {
  const panes = usePaneColumn({ persist: false, layout, initial: ["session", "files"] });
  const [specs] = useState(demoPanes);
  return (
    <div {...stylex.props(styles.window)}>
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.toolbar)}>
          <span {...stylex.props(styles.tab)}>
            <Icon name="diff" size={13} />
            Changes
          </span>
          <span {...stylex.props(styles.grow)} />
          {TOGGLES.map((toggle) => (
            <ToolButton
              key={toggle.id}
              label={`${panes.isOpen(toggle.id) ? "Hide" : "Show"} ${toggle.label.toLowerCase()}`}
              icon={toggle.icon}
              aria-pressed={panes.isOpen(toggle.id)}
              active={panes.isOpen(toggle.id)}
              onClick={() => panes.toggle(toggle.id)}
            />
          ))}
        </div>
        <div {...stylex.props(styles.lines)} aria-hidden="true">
          {[72, 56, 88, 40, 64, 80, 52].map((width, index) => (
            <span key={index} {...stylex.props(styles.line(width))} />
          ))}
        </div>
      </div>
      <PaneColumn state={panes} panes={specs} />
    </div>
  );
}

/**
 * The right column holds the Session, Files, and Preview panes at one width.
 * Two layouts are prototypes: stacked panes and tabs.
 */
export function PanesSection() {
  return (
    <Section
      id="panes"
      title="Side panes"
      lede="One column on the right holds the Session, Files, and Preview panes at one width. Drag its left edge to resize it. The two layouts are prototypes; choose one in the app with the command Show side panes as tabs."
    >
      <Specimen
        title="Stacked"
        note="The two latest panes, one above the other. Opening a third closes the oldest. Maximize leaves the other pane as its header."
        padded={false}
        zoomable={false}
      >
        <PaneDemo layout="stack" />
      </Specimen>
      <Specimen
        title="Tabs"
        note="One pane at a time. Each open pane has a tab."
        padded={false}
        zoomable={false}
      >
        <PaneDemo layout="tabs" />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  window: {
    display: "flex",
    height: 520,
    padding: 6,
    backgroundColor: tokens.panel,
  },
  main: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 40,
    flexShrink: 0,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  tab: { display: "flex", alignItems: "center", gap: 6, color: tokens.text, fontSize: 12 },
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
