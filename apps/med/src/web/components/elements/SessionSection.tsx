import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentMessage, DraftComment } from "../../../shared/agent-inbox";
import type { SessionEvent, SessionUpdate } from "../../../shared/agent-session";
import { readClaudeTranscript } from "../../../shared/agent-session-claude";
import { withSentMessages } from "../../data/agent-inbox";
import { createSessionReplay } from "../../data/session-replay";
import { createSessionStore, type SessionStore } from "../../data/session-store";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { SessionComposer, type ComposerAttachment } from "../session/SessionComposer";
import { SessionThread } from "../session/SessionThread";
import { sessionGallery } from "./session-gallery";
import transcript from "./session-fixture.jsonl?raw";
import { Section, Specimen } from "./Specimen";

const SPEEDS = [1, 4, 16] as const;

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A frame like the secondary sidebar that will hold a session in Med. */
function Panel({
  title,
  store,
  now,
  children,
}: {
  title: string;
  store: SessionStore;
  now?: number;
  children?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.panelHeader)}>
        <Icon name="claude" size={14} />
        <span {...stylex.props(styles.panelTitle)}>{snapshot.title ?? title}</span>
        <span
          aria-label={snapshot.running ? "Working" : "Idle"}
          {...stylex.props(styles.dot, snapshot.running && styles.dotLive)}
        />
      </header>
      <div {...stylex.props(styles.thread)}>
        <SessionThread snapshot={snapshot} now={now} />
      </div>
      {children}
    </div>
  );
}

function Replay() {
  const [{ store, replay }] = useState(() => {
    const store = createSessionStore();
    const replay = createSessionReplay(store, readClaudeTranscript(transcript));
    // The page opens on the whole session; Play starts it from the beginning.
    replay.seek(replay.getState().duration);
    return { store, replay };
  });
  useEffect(() => () => replay.dispose(), [replay]);
  const state = useSyncExternalStore(replay.subscribe, replay.getState);
  // Elapsed labels change in tenths of a second.
  const now = Math.floor(replay.clock() / 100) * 100;
  return (
    <div {...stylex.props(styles.replay)}>
      <div {...stylex.props(styles.controls)} role="toolbar" aria-label="Replay">
        <button
          type="button"
          onClick={() => (state.playing ? replay.pause() : replay.play())}
          aria-label={state.playing ? "Pause" : "Play"}
          {...stylex.props(ui.button, ui.outlined, styles.play)}
        >
          <Icon name={state.playing ? "pause" : "play"} size={13} />
          {state.playing ? "Pause" : state.position >= state.duration ? "Replay" : "Play"}
        </button>
        <input
          type="range"
          aria-label="Position"
          min={0}
          max={state.duration}
          step={100}
          value={state.position}
          onChange={(event) => replay.seek(Number(event.target.value))}
          {...stylex.props(styles.scrubber)}
        />
        <span {...stylex.props(styles.time)}>
          {clock(state.position)} / {clock(state.duration)}
        </span>
        <span role="group" aria-label="Speed" {...stylex.props(styles.speeds)}>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={state.speed === speed}
              onClick={() => replay.setSpeed(speed)}
              {...stylex.props(ui.button, styles.speed, state.speed === speed && styles.speedOn)}
            >
              {speed}×
            </button>
          ))}
        </span>
      </div>
      <Panel title="Format trail durations" store={store} now={state.playing ? now : undefined}>
        <SessionComposer
          agent="claude"
          waiting={false}
          drafts={[]}
          attachments={[]}
          onRemoveAttachment={() => {}}
          onSend={async () => {}}
        />
      </Panel>
    </div>
  );
}

// The reply flow: the agent hands off, waits in `med review wait`, and takes
// the user's message with the comments they chose.
const BASE = Date.UTC(2026, 9, 10, 9, 0, 0);
const at = (seconds: number) => BASE + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();
const wait = (id: string, status: "in_progress" | "completed"): SessionUpdate => ({
  sessionUpdate: "tool_call",
  toolCallId: id,
  title: "Wait for your review",
  kind: "execute",
  status,
  rawInput: { command: "med review wait --key durations" },
  _meta: { med: { tool: "Bash", background: { id: `b-${id}`, kind: "shell" } } },
});
const say = (id: string, text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  messageId: id,
  content: { type: "text", text },
});
const replyEvents: SessionEvent[] = [
  {
    at: at(0),
    update: {
      sessionUpdate: "user_message_chunk",
      content: {
        type: "text",
        text: "The weekly summary prints raw milliseconds. Add formatDuration(ms) and use it in summarize().",
      },
    },
  },
  {
    at: at(48),
    update: say(
      "a1",
      "Added `formatDuration` and used it in `summarize()` ([summary.ts:14](src/summary.ts:14)). The review is in Med; I wait for your comments there.",
    ),
  },
  { at: at(50), update: wait("w1", "in_progress") },
  {
    at: at(301),
    update: { sessionUpdate: "tool_call_update", toolCallId: "w1", status: "completed" },
  },
  {
    at: at(302),
    update: {
      sessionUpdate: "agent_thought_chunk",
      messageId: "t1",
      content: { type: "text", text: "" },
      _meta: { med: { durationMs: 4000 } },
    },
  },
  {
    at: at(340),
    update: say(
      "a2",
      "Durations over 90 seconds now round to whole minutes ([summary.ts:14](src/summary.ts:14)), and the export keeps milliseconds. New iteration in Med.",
    ),
  },
  { at: at(342), update: wait("w2", "in_progress") },
];
const sentBefore: AgentMessage = {
  id: "m1",
  sessionId: "demo",
  agent: "claude",
  text: "Use whole minutes for anything over 90 seconds, but keep milliseconds in the export.",
  noteIds: ["n0"],
  attachmentCount: 0,
  createdAt: iso(300),
  delivery: "delivered",
  deliveredAt: iso(300),
};
const demoDrafts: DraftComment[] = [
  {
    id: "d1",
    path: "src/summary.ts",
    line: 14,
    text: "Round half a minute up, so 1m 30s reads as 2 min.",
    replies: 0,
  },
  {
    id: "d2",
    path: "src/duration.ts",
    line: 3,
    endLine: 6,
    text: "Hours need a case too: a long ride is 3 h 12 min.",
    replies: 1,
  },
];
const demoThread =
  "src/summary.ts:R14\n\n@reviewer:\n> Can this handle a missing duration?\n\nhttps://github.com/example/trail-notes/pull/12#discussion_r1";
const STATES = [
  { id: "waiting", label: "Claude waits" },
  { id: "away", label: "Claude works" },
  { id: "codex", label: "Codex" },
] as const;

function ReplyDemo() {
  const [store] = useState(() => {
    const store = createSessionStore();
    store.applyAll(replyEvents);
    return store;
  });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [mode, setMode] = useState<(typeof STATES)[number]["id"]>("waiting");
  const [messages, setMessages] = useState<AgentMessage[]>([sentBefore]);
  const [drafts, setDrafts] = useState(demoDrafts);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([
    { id: "g1", label: "summary.ts:R14", text: demoThread },
  ]);
  const agent = mode === "codex" ? "codex" : "claude";
  const shown = useMemo(
    () => ({ ...snapshot, items: withSentMessages(snapshot.items, messages) }),
    [snapshot, messages],
  );
  return (
    <div {...stylex.props(styles.replay)}>
      <div {...stylex.props(styles.controls)} role="group" aria-label="Agent state">
        {STATES.map((state) => (
          <button
            key={state.id}
            type="button"
            aria-pressed={mode === state.id}
            onClick={() => setMode(state.id)}
            {...stylex.props(ui.button, styles.speed, mode === state.id && styles.speedOn)}
          >
            {state.label}
          </button>
        ))}
      </div>
      <div {...stylex.props(styles.panel)}>
        <header {...stylex.props(styles.panelHeader)}>
          <Icon name={agent} size={14} />
          <span {...stylex.props(styles.panelTitle)}>Format trail durations</span>
          <span {...stylex.props(styles.state)}>
            <span
              {...stylex.props(
                styles.dot,
                mode === "away" && styles.dotLive,
                mode === "waiting" && styles.dotWaiting,
              )}
            />
            {mode === "waiting" ? "Waiting for you" : mode === "away" ? "Working" : "Idle"}
          </span>
        </header>
        <div {...stylex.props(styles.thread)}>
          <SessionThread snapshot={shown} />
        </div>
        <SessionComposer
          key={agent}
          agent={agent}
          waiting={mode === "waiting"}
          drafts={drafts}
          attachments={attachments}
          onRemoveAttachment={(id) =>
            setAttachments((list) => list.filter((entry) => entry.id !== id))
          }
          onSend={async (message) => {
            const sent: AgentMessage = {
              id: `m${Date.now()}`,
              sessionId: "demo",
              agent,
              text: message.text,
              noteIds: message.noteIds,
              attachmentCount: message.attachments.length,
              // After the recorded work, so it shows last.
              createdAt: iso(400 + messages.length),
              delivery: agent === "codex" ? "queued" : "pending",
            };
            setMessages((list) => [...list, sent]);
            setDrafts((list) => list.filter((draft) => !message.noteIds.includes(draft.id)));
            if (agent === "claude" && mode === "waiting")
              setTimeout(
                () =>
                  setMessages((list) =>
                    list.map((entry) =>
                      entry.id === sent.id ? { ...entry, delivery: "delivered" } : entry,
                    ),
                  ),
                1200,
              );
          }}
        />
      </div>
    </div>
  );
}

function Gallery() {
  const [store] = useState(() => {
    const store = createSessionStore();
    store.applyAll(sessionGallery());
    return store;
  });
  return <Panel title="Cache the branch list" store={store} />;
}

/**
 * Agent sessions in the thread that Med will show beside a review. The replay
 * reads a real Claude Code transcript with the same reader that will follow
 * live sessions, and plays it at the recorded pace.
 */
export function SessionSection() {
  return (
    <Section
      id="session"
      title="Agent session"
      lede="A Claude Code session, read from its transcript and played back at the recorded pace. Replies stream in token-sized chunks, as a live agent sends them. Click a row to see its command, output, or diff."
    >
      <Specimen
        title="Replay"
        note="A subagent adds formatDuration() to a small repository. Waits longer than 4 seconds play shorter."
        padded={false}
        zoomable={false}
        span="half"
      >
        <Replay />
      </Specimen>
      <Specimen
        title="Reply to the agent"
        note="Comments and GitHub threads go into one message. A waiting Claude takes it at once; otherwise it waits in Med until the agent runs med review wait. Codex gets it in its queue."
        padded={false}
        zoomable={false}
        span="half"
      >
        <ReplyDemo />
      </Specimen>
      <Specimen
        title="Every part"
        note="Sample updates: a plan, a dev server in the background, a failed test, a subagent, a notice, and a compaction."
        padded={false}
        zoomable={false}
        span="half"
      >
        <div {...stylex.props(styles.replay)}>
          <Gallery />
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  replay: { display: "flex", flexDirection: "column", height: 760 },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  play: { minWidth: 84, gap: 6 },
  scrubber: { flex: "1", minWidth: 60, accentColor: tokens.accent },
  time: { color: tokens.muted, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  speeds: { display: "flex", gap: 2 },
  speed: { minWidth: 32, paddingInline: 6, fontVariantNumeric: "tabular-nums" },
  speedOn: { color: tokens.text, backgroundColor: tokens.fill },
  panel: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
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
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.lineStrong },
  dotLive: { backgroundColor: tokens.green },
  dotWaiting: { backgroundColor: tokens.accent },
  state: { display: "flex", alignItems: "center", gap: 6, color: tokens.faint, fontSize: 11.5 },
  thread: { flex: "1", minHeight: 0 },
});
