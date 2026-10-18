import * as stylex from "@stylexjs/stylex";
import { useMemo, useState, type ReactNode } from "react";
import type { Thread } from "../../../shared/threads";
import type { ReadState } from "../../data/tabs";
import type { WorkspaceSnapshot } from "../../data/workspaces";
import { tokens, ui } from "../../theme.stylex";
import { StreamHeader, type SidebarStream, type StreamActions } from "../shell/StreamHeader";
import {
  NoticeBar,
  ThreadSidebar,
  type SidebarSource,
  type TabNotice,
} from "../shell/ThreadSidebar";
import { Section, Specimen } from "./Specimen";
import { initialStreams, streamThreads } from "./states-fixture";

// Streams of work as tab groups (the durable sessions design): named, folded,
// closed as one, and back as they were after a restart.

const SOURCES: SidebarSource[] = [
  { kind: "repository", id: "med", name: "workbench", path: "/work/workbench" },
  { kind: "repository", id: "reader", name: "reader", path: "/work/reader" },
];
const SNAPSHOT: WorkspaceSnapshot = {
  workspaces: [
    { id: "w1", kind: "review", reviewId: streamThreads[2]!.id, title: streamThreads[2]!.title },
  ],
  active: "w1",
  recent: ["w1"],
};
const unread = new Set([streamThreads[2]!.id]);
const read: ReadState = {
  isUnread: (thread) => unread.has(thread.id),
  setUnread: () => {},
  isSubagentUnread: () => false,
  seeSubagent: () => {},
};
const noop = () => {};

/** The sidebar with streams; fold, name and close them here. */
function StreamSidebar() {
  const [streams, setStreams] = useState<SidebarStream[]>(initialStreams);
  const [closed, setClosed] = useState(6);
  const [notice, setNotice] = useState<TabNotice | null>({
    text: "Restored 3 streams and 8 tabs after a restart. One turn was cut.",
    actions: [{ label: "Show", run: noop }],
  });
  const actions = useMemo<StreamActions>(
    () => ({
      toggle: (stream) =>
        setStreams((list) =>
          list.map((entry) =>
            entry.id === stream.id ? { ...entry, collapsed: !entry.collapsed } : entry,
          ),
        ),
      rename: (stream, name) =>
        setStreams((list) =>
          list.map((entry) => (entry.id === stream.id ? { ...entry, name } : entry)),
        ),
      newThread: noop,
      close: (stream) => {
        setStreams((list) => list.filter((entry) => entry.id !== stream.id));
        setClosed((count) => count + 1);
        setNotice({
          text: `Closed ${stream.name}: its ${stream.threads.length} tabs are in history.`,
          actions: [
            {
              label: "Undo",
              run: () => {
                setStreams((list) =>
                  list.some((entry) => entry.id === stream.id) ? list : [...list, stream],
                );
                setClosed((count) => count - 1);
                setNotice(null);
              },
            },
          ],
        });
      },
    }),
    [],
  );
  return (
    <div {...stylex.props(styles.sidebar)}>
      <ThreadSidebar
        threads={streamThreads}
        streams={streams}
        streamActions={actions}
        closedStreams={{ count: closed, open: noop }}
        sources={SOURCES}
        snapshot={SNAPSHOT}
        read={read}
        loaded
        notice={notice && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />}
        onOpen={noop}
        onNewThread={noop}
        onHide={noop}
        onSources={noop}
        onClose={noop}
      />
    </div>
  );
}

const byId = new Map(streamThreads.map((thread) => [thread.id, thread]));
const threadsOf = (stream: SidebarStream): Thread[] =>
  stream.threads.flatMap((id) => byId.get(id) ?? []);
const fixed: StreamActions = { toggle: noop, rename: noop, newThread: noop, close: noop };

function Variant({ name, note, children }: { name: string; note: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.variant)}>
      <span {...stylex.props(ui.label, styles.variantName)}>{name}</span>
      <div {...stylex.props(styles.variantStage)}>{children}</div>
      <span {...stylex.props(styles.variantNote)}>{note}</span>
    </div>
  );
}

function HeaderVariants() {
  const [durable, reader, arctic] = initialStreams;
  return (
    <div {...stylex.props(styles.variants)}>
      <Variant name="Open" note="Its tabs show under it. + and × show on hover.">
        <StreamHeader
          stream={{ ...durable, collapsed: false }}
          threads={threadsOf(durable)}
          actions={fixed}
          renaming={false}
          onRenaming={noop}
        />
      </Variant>
      <Variant name="Folded" note="One line counts what its tabs need, most urgent first.">
        <StreamHeader
          stream={reader}
          threads={threadsOf(reader)}
          actions={fixed}
          renaming={false}
          onRenaming={noop}
        />
        <StreamHeader
          stream={arctic}
          threads={threadsOf(arctic)}
          actions={fixed}
          renaming={false}
          onRenaming={noop}
        />
      </Variant>
      <Variant name="Naming" note="A double-click or F2. A new stream opens here.">
        <StreamHeader
          stream={durable}
          threads={threadsOf(durable)}
          actions={fixed}
          renaming
          onRenaming={noop}
        />
      </Variant>
      <Variant name="Closing" note="Only while an agent works: closing stops it.">
        <StreamHeader
          stream={durable}
          threads={threadsOf(durable)}
          actions={fixed}
          renaming={false}
          onRenaming={noop}
          startConfirming
        />
      </Variant>
    </div>
  );
}

export function StreamsSection() {
  return (
    <Section
      id="streams"
      title="Streams"
      lede="A stream is a named group of tabs for one piece of work, like a browser's tab group. It stays until the work is done; then Close sends it to history with its tabs and stops their agents. After a restart or a reboot, every open stream comes back as it was."
    >
      <Specimen
        title="Sidebar with streams"
        note="Fold a stream, double-click its name, or close it: Undo brings it back."
        span="half"
        padded={false}
      >
        <StreamSidebar />
      </Specimen>
      <Specimen title="Stream header" note="Each state of the header." span="half">
        <HeaderVariants />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  sidebar: { width: 290, height: 620, paddingBlock: 8, backgroundColor: tokens.panel },
  variants: { display: "flex", flexDirection: "column", gap: 18, maxWidth: 300 },
  variant: { display: "flex", flexDirection: "column", gap: 6 },
  variantName: { fontSize: 10 },
  variantStage: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 8,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  variantNote: { color: tokens.muted, fontSize: 11.5, lineHeight: 1.45 },
});
