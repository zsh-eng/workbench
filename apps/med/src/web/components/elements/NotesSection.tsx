import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import type { SessionEvent } from "../../../shared/agent-session";
import { parseReviewPatch, type ParsedReviewFile } from "../../../shared/review";
import type { BriefComment, BriefCommentMutation, SavedPin } from "../../../shared/saved-review";
import { createSessionStore } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ReplyActionsContext, SessionThread, type ReplyActions } from "../session/SessionThread";
import { briefMarkdown } from "./brief-fixture";
import { relativeTimePatch, themePatch } from "./fixtures";
import { Section, Specimen } from "./Specimen";

const BriefView = lazy(() => import("../BriefView"));
const noop = () => {};
const noSource = async () => ({ old: "", new: "" });

/** The two changed files of the demo review. */
function demoFiles(): ParsedReviewFile[] {
  return [relativeTimePatch, themePatch].map((patch) => {
    const metadata = parseReviewPatch(patch)[0]!;
    const lines = patch.split("\n");
    return {
      id: `demo:${metadata.name}`,
      path: metadata.name,
      info: {
        path: metadata.name,
        status: "M",
        additions: lines.filter((line) => /^\+(?!\+\+)/.test(line)).length,
        deletions: lines.filter((line) => /^-(?!--)/.test(line)).length,
        binary: false,
      },
      metadata,
    };
  });
}

const brief = {
  text: `# Weeks in relative times

Commit dates from 7 to 30 days old now read in weeks. A \`week\` unit sits between days and months in [relative-time.ts:16-22](src/web/data/relative-time.ts:16).

The theme also writes its ID to the root, for CSS that differs by theme: [themes.ts:12-13](src/web/themes.ts:12).

## Tests

\`bun test relative-time\` passes. New cases cover 7, 13, and 29 days.`,
  updatedAt: "2026-10-10T09:02:00Z",
};

const BASE = Date.UTC(2026, 9, 10, 9, 0, 0);
const user = (seconds: number, text: string): SessionEvent => ({
  at: BASE + seconds * 1000,
  update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
});
const reply = (seconds: number, id: string, text: string): SessionEvent => ({
  at: BASE + seconds * 1000,
  update: { sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text } },
});
const whyWeeks = `## Why weeks come before months

The ladder checks each bound in order, so \`week\` must come before \`30 * day\` ([relative-time.ts:16-19](src/web/data/relative-time.ts:16)). A date 20 days old now reads "2 wk ago", not "20 days ago".

Nothing else reads the unit names, so the rename from \`label\` to \`unit\` stays in the function.`;
const whyTheme = `\`applyTheme\` now writes the theme ID to \`data-theme\` on the root ([themes.ts:13](src/web/themes.ts:13)). CSS that differs by theme selects on it. \`color-scheme\` only tells light from dark.

Colors also go through \`normalize()\` first ([themes.ts:10](src/web/themes.ts:10)), so a theme can give \`#abc\` or \`rgb()\` values.`;
const events: SessionEvent[] = [
  user(0, "Walk me through why week sits before month."),
  reply(20, "r1", whyWeeks),
  user(60, "Why does the theme now set data-theme on the root?"),
  reply(84, "r2", whyTheme),
];
const pinOf = (id: string, itemId: string, text: string, minute: number): SavedPin => ({
  id,
  text,
  createdAt: new Date(BASE + minute * 60_000).toISOString(),
  source: { agent: "claude", sessionId: "demo", itemId },
});

/**
 * Pin to review: a reply in the session becomes a note beside the brief.
 * Each note has its number, its source, and its own excerpts; the rail on the
 * right edge marks the notes, their headings, and their excerpts.
 */
function PinDemo() {
  const [files] = useState(demoFiles);
  const [store] = useState(() => {
    const store = createSessionStore();
    store.applyAll(events);
    return store;
  });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [pins, setPins] = useState<SavedPin[]>(() => [pinOf("p_demo1", "r1", whyWeeks, 1)]);
  const [reveal, setReveal] = useState<{ key: string; nonce: number }>();
  const actions = useMemo<ReplyActions>(
    () => ({
      pinned: (itemId) => pins.find((pin) => pin.source?.itemId === itemId)?.id,
      pin: async (item) => {
        const id = `p_demo${Date.now()}`;
        setPins((list) => [...list, pinOf(id, item.id, item.text, 2 + list.length)]);
        setReveal({ key: id, nonce: Date.now() });
      },
      showPin: (id) => setReveal({ key: id, nonce: Date.now() }),
    }),
    [pins],
  );
  return (
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.session)}>
        <header {...stylex.props(styles.panelHeader)}>
          <Icon name="claude" size={14} />
          <span {...stylex.props(styles.panelTitle)}>Weeks in relative times</span>
        </header>
        <div {...stylex.props(styles.thread)}>
          <ReplyActionsContext.Provider value={actions}>
            <SessionThread snapshot={snapshot} />
          </ReplyActionsContext.Provider>
        </div>
      </div>
      <div {...stylex.props(styles.notes)}>
        <Suspense fallback={null}>
          <BriefView
            brief={brief}
            pins={pins}
            reveal={reveal}
            files={files}
            active={false}
            loadSource={noSource}
            onOpen={noop}
            onOpenPath={noop}
            onPaste={noop}
            onCopy={noop}
            onRemove={noop}
            onUnpin={(id) => setPins((list) => list.filter((pin) => pin.id !== id))}
            notes={[]}
            onMutateNote={async () => {}}
          />
        </Suspense>
      </div>
    </div>
  );
}

const commentBrief = {
  text: "## Durations\n\nThe summary now rounds to whole seconds, so short runs read as 0 s. Callers that need milliseconds use `formatMs` instead.\n\nSelect any words in this note, then choose **Comment** or press C.\n",
  updatedAt: "2026-10-09T09:00:00Z",
};

/** Comments on passages of a note, kept in this page. */
function CommentDemo() {
  const [comments, setComments] = useState<BriefComment[]>(() => [
    {
      id: "c_demo1",
      section: "brief",
      quote: "short runs read as 0 s",
      prefix: "The summary now rounds to whole seconds, so ",
      text: "Show one decimal below 10 s.",
      createdAt: "2026-10-09T09:05:00Z",
      updatedAt: "2026-10-09T09:05:00Z",
    },
  ]);
  const comment = async (mutation: BriefCommentMutation) => {
    const now = new Date().toISOString();
    setComments((current) =>
      "add" in mutation
        ? [
            ...current,
            { ...mutation.add, id: `c_demo${current.length + 2}`, createdAt: now, updatedAt: now },
          ]
        : "edit" in mutation
          ? current.map((item) =>
              item.id === mutation.edit.id
                ? { ...item, text: mutation.edit.text, updatedAt: now }
                : item,
            )
          : current.filter((item) => item.id !== mutation.remove),
    );
  };
  return (
    <div {...stylex.props(styles.frame)}>
      <Suspense fallback={null}>
        <BriefView
          brief={commentBrief}
          files={[]}
          active
          loadSource={noSource}
          onOpen={noop}
          onOpenPath={noop}
          onPaste={noop}
          onCopy={noop}
          onRemove={noop}
          notes={[]}
          onMutateNote={async () => {}}
          comments={comments}
          onCommentBrief={comment}
        />
      </Suspense>
    </div>
  );
}

export function NotesSection() {
  const [sample] = useState(() => ({ text: briefMarkdown(), updatedAt: "2026-10-09T09:00:00Z" }));
  return (
    <Section
      id="notes"
      title="Notes"
      lede="A review's Notes are the agent's brief and the replies you pin from its session. With more than one note, each note gets a numbered head, and a rail of ticks marks the notes, headings, and excerpts."
    >
      <Specimen
        title="Pin a reply"
        note="Pin the second reply to add note 03, or select Pinned to go to note 02. Remove a pin from its note menu."
        padded={false}
        zoomable={false}
      >
        <PinDemo />
      </Specimen>
      <Specimen
        title="Comment on a passage"
        note="Select words in a note and choose Comment, or press C. The passage stays marked, and the comment shows below its paragraph. Copy comments and Send to the agent include it with its quote."
        padded={false}
        zoomable={false}
      >
        <CommentDemo />
      </Specimen>
      <Specimen
        title="One note"
        note="A brief alone has no note heads. Text column, wide blocks, and diagrams in the current theme."
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.frame)}>
          <Suspense fallback={null}>
            <BriefView
              brief={sample}
              files={[]}
              active={false}
              loadSource={noSource}
              onOpen={noop}
              onOpenPath={noop}
              onPaste={noop}
              onCopy={noop}
              onRemove={noop}
              notes={[]}
              onMutateNote={async () => {}}
            />
          </Suspense>
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  // The whole brief shows; in the app it scrolls inside its pane.
  frame: { display: "flex", flexDirection: "column" },
  split: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(280px, 360px)",
      "@media (max-width: 760px)": "1fr",
    },
    gridTemplateRows: { default: "1fr", "@media (max-width: 760px)": "1fr 1fr" },
    height: { default: 680, "@media (max-width: 760px)": 960 },
  },
  // The Notes take the main view; the session sits in the sidebar on the right.
  notes: { order: -1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  session: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: tokens.line,
    backgroundColor: tokens.canvas,
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInline: 16,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  panelTitle: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  thread: { flex: "1", minHeight: 0 },
});
