import type { SessionEvent, SessionUpdate } from "../../../shared/agent-session";
import type { OwnedState } from "../../../shared/owned-session";
import type { Thread } from "../../../shared/threads";
import type { SentMessage } from "../../data/agent-inbox";
import { createSessionStore } from "../../data/session-store";

// One thread, "Durations in the export", in each state of the durable
// sessions design, and the streams of the sidebar. Times are fixed so the
// page reads the same on each visit.

export const NOW = Date.UTC(2026, 9, 18, 14, 10);
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;
const iso = (minutesAgo: number) => new Date(at(minutesAgo)).toISOString();
const text = (value: string) => ({ type: "text" as const, text: value });
const repository = { id: "trail", name: "trail-notes", path: "/work/trail-notes" };

export const baseThread: Thread = {
  id: "claude-states",
  kind: "session",
  title: "Durations in the export",
  createdAt: iso(90),
  updatedAt: at(4),
  repository,
  branch: "export-durations",
  agent: "claude",
  state: "idle",
  changes: { files: 2, additions: 18, deletions: 4 },
  reviews: [],
};

/** The thread in one state: its row's fields over the base thread's. */
export const threadIn = (fields: Partial<Thread>): Thread => ({ ...baseThread, ...fields });

const history: [minutesAgo: number, SessionUpdate][] = [
  [
    12,
    {
      sessionUpdate: "user_message_chunk",
      content: text(
        "The export prints raw milliseconds. Use formatDuration there too, but keep milliseconds in the CSV column.",
      ),
    },
  ],
  [
    11.9,
    {
      sessionUpdate: "agent_thought_chunk",
      content: text("The summary column and the CSV share one formatter; split them."),
      _meta: { med: { durationMs: 3200 } },
    },
  ],
  [
    11.8,
    {
      sessionUpdate: "tool_call",
      toolCallId: "read-1",
      title: "Read src/export.ts",
      kind: "read",
      status: "completed",
    },
  ],
  [
    11.5,
    {
      sessionUpdate: "tool_call",
      toolCallId: "edit-1",
      title: "Edit src/export.ts",
      kind: "edit",
      status: "completed",
      _meta: { med: { tool: "Edit" } },
    },
  ],
  [
    11.2,
    {
      sessionUpdate: "agent_message_chunk",
      content: text(
        "The summary now reads `1 h 30 min`; the CSV keeps milliseconds ([export.ts:22](src/export.ts:22)).",
      ),
    },
  ],
];

const testsAsked: [number, SessionUpdate][] = [
  [3, { sessionUpdate: "user_message_chunk", content: text("Run the export tests.") }],
  [
    2.9,
    {
      sessionUpdate: "agent_thought_chunk",
      content: text("The export tests are in tests/export.test.ts."),
      _meta: { med: { durationMs: 2100 } },
    },
  ],
];
const testRun = (fields: Partial<SessionUpdate> = {}): [number, SessionUpdate] => [
  2.8,
  {
    sessionUpdate: "tool_call",
    toolCallId: "test-1",
    title: "Run the export tests",
    kind: "execute",
    status: "in_progress",
    rawInput: { command: "bun test tests/export.test.ts" },
    _meta: { med: { tool: "Bash" } },
    ...fields,
  } as SessionUpdate,
];

const events = (updates: [number, SessionUpdate][]): SessionEvent[] =>
  updates.map(([minutesAgo, update]) => ({ at: at(minutesAgo), update }));

/** What a frame's Session pane shows: the finished task, its prompt and reply
 * alone (above a notice), the turn that runs, or the turn that a restart cut. */
export type Story = "history" | "reply" | "running" | "cut";

export function storeFor(story: Story): ReturnType<typeof createSessionStore> {
  const store = createSessionStore();
  store.applyAll(
    events(
      story === "history"
        ? history
        : story === "reply"
          ? [history[0]!, history.at(-1)!]
          : story === "cut"
            ? [...testsAsked, testRun({ _meta: { med: { tool: "Bash", interrupted: true } } })]
            : [...testsAsked, testRun()],
    ),
  );
  if (story === "running") store.setRunning(true);
  return store;
}

/** The composer's state for a session that Med runs. */
export const ownedIn = (
  status: OwnedState["status"],
  fields: Partial<OwnedState> = {},
): OwnedState => ({
  sessionId: "states",
  preset: "claude",
  name: "Claude Code",
  status,
  settings: [
    {
      id: "model",
      name: "Model",
      category: "model",
      value: "opus",
      options: [{ value: "opus", name: "Opus" }],
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      value: "acceptEdits",
      options: [{ value: "acceptEdits", name: "Accept edits" }],
    },
  ],
  commands: [],
  turns: 2,
  ...fields,
});

/** A message from Med in each place that the thread shows. */
const sent = (id: string, minutesAgo: number, value: string, fields: Partial<SentMessage>) =>
  ({
    id,
    sessionId: "states",
    agent: "claude",
    text: value,
    noteIds: [],
    attachmentCount: 0,
    createdAt: iso(minutesAgo),
    delivery: "delivered",
    ...fields,
  }) as SentMessage;

export const receipts: SentMessage[] = [
  sent("m1", 10, "Keep the column header as it is.", { delivery: "delivered" }),
  sent("m2", 9, "Round half a minute up.", { delivery: "sending" }),
  sent("m3", 8, "Then run the export tests.", { delivery: "pending" }),
  sent("m6", 5, "Push the branch.", {
    delivery: "failed",
    error: "Med could not save it",
    retry() {},
    discard() {},
  }),
];

/** The receipts' thread: the history, with the messages after it. */
export function receiptsStore() {
  const store = createSessionStore();
  store.applyAll(events(history));
  return store;
}
