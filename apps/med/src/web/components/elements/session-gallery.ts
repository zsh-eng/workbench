import type { SessionEvent, SessionUpdate } from "../../../shared/agent-session";

// Sample updates in ACP's shapes for every part of a session thread. They do
// not come from a transcript; they show the parts that the recorded session
// above does not use: a plan, a background shell, a failure, a subagent, a
// notice, a compaction, and a queued message.

const before = `import { git } from "./git";

export async function listBranches(root: string) {
  const output = await git(root, ["branch", "--format=%(refname:short)"]);
  return output.split("\\n").filter(Boolean);
}
`;
const after = `import { git } from "./git";

const cache = new Map<string, Promise<string[]>>();

export function listBranches(root: string) {
  let branches = cache.get(root);
  if (!branches) {
    branches = git(root, ["branch", "--format=%(refname:short)"]).then((output) =>
      output.split("\\n").filter(Boolean),
    );
    cache.set(root, branches);
  }
  return branches;
}

/** A fetch can add branches. */
export function forgetBranches(root: string) {
  cache.delete(root);
}
`;

const text = (value: string) => ({ type: "text" as const, text: value });
const agent = { parentToolCallId: "agent-1" };

const updates: [seconds: number, SessionUpdate][] = [
  [
    0,
    {
      sessionUpdate: "user_message_chunk",
      content: text(
        "The review list is slow on big repositories. Make it faster, and keep the dev server running so I can check.",
      ),
    },
  ],
  [
    6,
    {
      sessionUpdate: "agent_thought_chunk",
      content: text(
        "The list asks Git for every branch each time it opens. A cache per repository removes the repeated work; a fetch must clear it, or new branches stay hidden.",
      ),
      _meta: { med: { durationMs: 6200 } },
    },
  ],
  [
    7,
    {
      sessionUpdate: "plan",
      entries: [
        {
          content: "Profile the list on a large repository",
          priority: "high",
          status: "completed",
        },
        { content: "Cache branch names per repository", priority: "high", status: "in_progress" },
        { content: "Clear the cache after a fetch", priority: "medium", status: "pending" },
        { content: "Add a test for the cache", priority: "medium", status: "pending" },
      ],
    },
  ],
  [
    8,
    {
      sessionUpdate: "tool_call",
      toolCallId: "shell-1",
      title: "Start the dev server",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "bun run dev -- --port 5173" },
      content: [{ type: "content", content: text("Local: http://localhost:5173/") }],
      _meta: { med: { tool: "Bash", background: { id: "b7k2", kind: "shell" } } },
    },
  ],
  [
    9,
    {
      sessionUpdate: "tool_call",
      toolCallId: "read-1",
      title: "Read src/host/branches.ts",
      kind: "read",
      status: "completed",
    },
  ],
  [
    10,
    {
      sessionUpdate: "tool_call",
      toolCallId: "search-1",
      title: "Search “listBranches” in src",
      kind: "search",
      status: "completed",
      content: [
        {
          type: "content",
          content: text(
            "src/host/branches.ts:3\nsrc/host/review-list.ts:18\nsrc/host/review-list.ts:41",
          ),
        },
      ],
    },
  ],
  [
    13,
    {
      sessionUpdate: "tool_call",
      toolCallId: "edit-1",
      title: "Edit src/host/branches.ts",
      kind: "edit",
      status: "completed",
      content: [
        { type: "diff", path: "/work/med/src/host/branches.ts", oldText: before, newText: after },
      ],
      _meta: { med: { tool: "Edit" } },
    },
  ],
  [
    16,
    {
      sessionUpdate: "tool_call",
      toolCallId: "test-1",
      title: "Run the branch tests",
      kind: "execute",
      status: "failed",
      rawInput: { command: "bun test tests/branches.test.ts" },
      content: [
        {
          type: "content",
          content: text(
            '✗ lists new branches after a fetch\n  Expected: ["main", "topic"]\n  Received: ["main"]\n\n1 fail, 4 pass',
          ),
        },
      ],
      _meta: { med: { tool: "Bash" } },
    },
  ],
  [
    17,
    {
      sessionUpdate: "agent_message_chunk",
      content: text(
        "The test shows the stale case: a fetch must clear the cache. I'll ask a subagent to find every fetch path.",
      ),
    },
  ],
  [
    18,
    {
      sessionUpdate: "tool_call",
      toolCallId: "agent-1",
      title: "Find every place that fetches",
      kind: "other",
      status: "in_progress",
      _meta: { med: { tool: "Agent", background: { id: "a3", kind: "agent" } } },
    },
  ],
  [
    20,
    {
      sessionUpdate: "tool_call",
      toolCallId: "agent-1-search",
      title: "Search “fetch” in src/host",
      kind: "search",
      status: "completed",
      _meta: { med: agent },
    },
  ],
  [
    22,
    {
      sessionUpdate: "agent_message_chunk",
      content: text(
        'Two paths fetch: `refreshRemote()` and the pull-request sync. Both run through `git(root, ["fetch"])`.',
      ),
      _meta: { med: agent },
    },
  ],
  [23, { sessionUpdate: "tool_call_update", toolCallId: "agent-1", status: "completed" }],
  [
    24,
    {
      sessionUpdate: "notice",
      title: "The API is overloaded",
      severity: "warning",
      description: "Retry 1 of 10",
    },
  ],
  [
    40,
    {
      sessionUpdate: "compaction_update",
      compactionId: "compact-1",
      status: "completed",
      summary: [
        text(
          "The branch list now has a cache per repository. Fetches must clear it; two fetch paths need a call to forgetBranches().",
        ),
      ],
    },
  ],
  [
    41,
    {
      sessionUpdate: "user_message_chunk",
      content: text("Also check the empty state."),
      _meta: { med: { queued: true } },
    },
  ],
  [
    44,
    {
      sessionUpdate: "agent_message_chunk",
      content: text(
        "The list now opens from a cache. Changes:\n\n- [branches.ts:3](src/host/branches.ts:3) keeps one promise per repository.\n- `forgetBranches()` clears it; both fetch paths call it next.\n\nThe empty state shows when a repository has no branches yet, so it does not change.",
      ),
    },
  ],
];

export function sessionGallery(): SessionEvent[] {
  const start = Date.UTC(2026, 9, 9, 9, 0, 0);
  return updates.map(([seconds, update]) => ({ at: start + seconds * 1000, update }));
}
