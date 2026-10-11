import type { SessionEvent, SessionUpdate } from "../../../shared/agent-session";
import type { OwnedPermission } from "../../../shared/owned-session";
import { sessionGallery } from "./session-gallery";

// Sample sessions for the Sessions prototypes: two that need the user, three
// that work, and two that finished. Working sessions take new steps while the
// page is open (`upcoming`).

export type DeskState = "waiting" | "working" | "idle";

export interface Step {
  kind: "read" | "edit" | "search" | "execute";
  title: string;
  /** A command, for `execute`. */
  command?: string;
  added?: number;
  removed?: number;
  failed?: boolean;
  /** One line of output, such as a test summary. */
  result?: string;
}

export interface DeskSession {
  id: string;
  agent: "claude" | "codex" | "acp";
  /** The agent's name: Claude, Codex, or the ACP agent's own. */
  name: string;
  title: string;
  repository: string;
  branch: string;
  state: DeskState;
  /** Minutes since the last update. */
  ago: number;
  /** The last update and the turn's start, in milliseconds, once the page runs them. */
  updatedAt?: number;
  turnStartedAt?: number;
  /** Seconds that the current turn has run, for a working session. */
  elapsed?: number;
  /** What the session waits for: an answer, or the user's review. */
  ask?: { kind: "permission"; permission: OwnedPermission } | { kind: "review"; comments: number };
  prompt: string;
  steps: Step[];
  /** Steps that arrive while the page is open, one at a time. */
  upcoming?: Step[];
  /** The agent's last reply. */
  reply?: string;
  /** A reply that the user has not read. */
  unread?: boolean;
  changes?: { files: number; added: number; removed: number };
}

export const deskSessions: DeskSession[] = [
  {
    id: "export",
    agent: "acp",
    name: "OpenCode",
    title: "Rename the export command",
    repository: "trail-notes",
    branch: "export-cli",
    state: "waiting",
    ago: 1,
    ask: {
      kind: "permission",
      permission: {
        id: "p1",
        title: "Run the export tests?",
        detail: "bun test tests/export.test.ts",
        options: [
          { id: "once", name: "Allow once", kind: "allow_once" },
          { id: "always", name: "Always allow", kind: "allow_always" },
          { id: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    },
    prompt: "Rename `trail dump` to `trail export`, and keep `dump` as an alias for one release.",
    steps: [
      { kind: "search", title: "Search “dump” in src" },
      { kind: "read", title: "Read src/cli/commands.ts" },
      { kind: "edit", title: "Edit src/cli/commands.ts", added: 12, removed: 4 },
      { kind: "edit", title: "Edit README.md", added: 3, removed: 3 },
    ],
    changes: { files: 2, added: 15, removed: 7 },
  },
  {
    id: "durations",
    agent: "claude",
    name: "Claude",
    title: "Format trail durations",
    repository: "trail-notes",
    branch: "durations",
    state: "waiting",
    ago: 4,
    ask: { kind: "review", comments: 2 },
    prompt:
      "The weekly summary prints raw milliseconds. Add formatDuration(ms) and use it in summarize().",
    steps: [
      { kind: "read", title: "Read src/summary.ts" },
      { kind: "edit", title: "Edit src/duration.ts", added: 18 },
      { kind: "edit", title: "Edit src/summary.ts", added: 2, removed: 1 },
      { kind: "execute", title: "Run the tests", command: "bun test", result: "12 pass" },
    ],
    reply:
      "Added `formatDuration` and used it in `summarize()`. The review is in Med; I wait for your comments there.",
    changes: { files: 3, added: 31, removed: 1 },
  },
  {
    id: "branch-cache",
    agent: "claude",
    name: "Claude",
    title: "Cache the branch list",
    repository: "med",
    branch: "branch-cache",
    state: "working",
    ago: 0,
    elapsed: 372,
    prompt:
      "The review list is slow on big repositories. Make it faster, and keep the dev server running so I can check.",
    steps: [
      { kind: "execute", title: "Start the dev server", command: "bun run dev -- --port 5173" },
      { kind: "read", title: "Read src/host/branches.ts" },
      { kind: "search", title: "Search “listBranches” in src", result: "3 matches" },
      { kind: "edit", title: "Edit src/host/branches.ts", added: 16, removed: 3 },
      {
        kind: "execute",
        title: "Run the branch tests",
        command: "bun test tests/branches.test.ts",
        failed: true,
        result: "1 fail, 4 pass",
      },
    ],
    upcoming: [
      { kind: "search", title: "Search “fetch” in src/host", result: "2 matches" },
      { kind: "edit", title: "Edit src/host/remote.ts", added: 2 },
      { kind: "edit", title: "Edit src/host/pull-sync.ts", added: 2 },
      {
        kind: "execute",
        title: "Run the branch tests",
        command: "bun test tests/branches.test.ts",
        result: "5 pass",
      },
    ],
  },
  {
    id: "hours",
    agent: "codex",
    name: "Codex",
    title: "Show hours in long durations",
    repository: "trail-notes",
    branch: "hours",
    state: "working",
    ago: 0,
    elapsed: 95,
    prompt: "A long ride prints 192 min. Show hours from 90 minutes up: 3 h 12 min.",
    steps: [
      { kind: "read", title: "Read src/duration.ts" },
      { kind: "read", title: "Read tests/duration.test.ts" },
    ],
    upcoming: [
      { kind: "edit", title: "Edit src/duration.ts", added: 9, removed: 2 },
      { kind: "edit", title: "Edit tests/duration.test.ts", added: 14 },
      { kind: "execute", title: "Run the tests", command: "bun test", result: "15 pass" },
    ],
  },
  {
    id: "sticky",
    agent: "claude",
    name: "Claude",
    title: "Keep file headers in view",
    repository: "med",
    branch: "sticky-headers",
    state: "working",
    ago: 0,
    elapsed: 1240,
    prompt: "In a long diff, keep each file's header at the top while its lines scroll.",
    steps: [
      { kind: "read", title: "Read src/web/components/DiffView.tsx" },
      { kind: "edit", title: "Edit src/web/components/DiffView.tsx", added: 22, removed: 9 },
      { kind: "edit", title: "Edit src/web/components/DiffView.css", added: 11 },
      {
        kind: "execute",
        title: "Run the browser tests",
        command: "bun run test:browser -- diff",
        result: "38 pass",
      },
    ],
    upcoming: [
      { kind: "read", title: "Read tests/browser/app.test.tsx" },
      { kind: "edit", title: "Edit tests/browser/app.test.tsx", added: 27 },
    ],
  },
  {
    id: "covers",
    agent: "claude",
    name: "Claude",
    title: "Load book covers as they scroll in",
    repository: "reader",
    branch: "lazy-covers",
    state: "idle",
    ago: 38,
    unread: true,
    prompt: "The library loads every cover at once. Load each one as it comes into view.",
    steps: [
      { kind: "read", title: "Read src/library/Shelf.tsx" },
      { kind: "edit", title: "Edit src/library/Cover.tsx", added: 41, removed: 12 },
      { kind: "edit", title: "Edit src/library/Shelf.tsx", added: 6, removed: 6 },
      { kind: "execute", title: "Run the tests", command: "bun run test", result: "64 pass" },
    ],
    reply:
      "Covers now load as they come within one screen of view, and keep their size while they load, so the shelf does not jump.",
    changes: { files: 4, added: 61, removed: 18 },
  },
  {
    id: "vite",
    agent: "codex",
    name: "Codex",
    title: "Upgrade Vite",
    repository: "reader",
    branch: "vite-upgrade",
    state: "idle",
    ago: 140,
    prompt: "Upgrade Vite to the current major version and fix what breaks.",
    steps: [
      { kind: "edit", title: "Edit package.json", added: 2, removed: 2 },
      { kind: "execute", title: "Build", command: "bun run build", result: "Built in 3.1 s" },
      { kind: "execute", title: "Run the tests", command: "bun run test", result: "64 pass" },
    ],
    reply:
      "Vite builds and the tests pass. Two plugins needed new options; the notes are in the review.",
    changes: { files: 3, added: 9, removed: 7 },
  },
];

const text = (value: string) => ({ type: "text" as const, text: value });

function toolCall(step: Step, id: string, running: boolean): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: step.title,
    kind: step.kind,
    status: running ? "in_progress" : step.failed ? "failed" : "completed",
    ...(step.command && { rawInput: { command: step.command } }),
    ...(step.result && { content: [{ type: "content", content: text(step.result) }] }),
    ...(step.kind === "execute" && { _meta: { med: { tool: "Bash" } } }),
  } as SessionUpdate;
}

/**
 * The session's thread as the real Session pane reads it. The branch cache
 * session is the gallery's; the others are built from their steps.
 */
export function threadFor(session: DeskSession, steps = session.steps) {
  const start = Date.UTC(2026, 9, 11, 9, 0, 0);
  if (session.id === "branch-cache") {
    // Up to the subagent's answer: the session is in its turn.
    const gallery = sessionGallery();
    const events = gallery.filter((event) => event.at <= gallery[0]!.at + 23_000);
    const extra = steps.slice(session.steps.length);
    return {
      events: [
        ...events,
        ...extra.map((step, index) => ({
          at: events.at(-1)!.at + (index + 1) * 2000,
          update: toolCall(step, `extra-${index}`, false),
        })),
      ],
      running: true,
    };
  }
  const events: SessionEvent[] = [
    { at: start, update: { sessionUpdate: "user_message_chunk", content: text(session.prompt) } },
  ];
  steps.forEach((step, index) => {
    const last = index === steps.length - 1;
    events.push({
      at: start + (index + 1) * 9000,
      update: toolCall(step, `${session.id}-${index}`, session.state === "working" && last),
    });
  });
  if (session.reply)
    events.push({
      at: start + (steps.length + 1) * 9000,
      update: { sessionUpdate: "agent_message_chunk", content: text(session.reply) },
    });
  if (session.ask?.kind === "review")
    events.push({
      at: start + (steps.length + 2) * 9000,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `${session.id}-wait`,
        title: "Wait for your review",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: `med review wait --key ${session.branch}` },
        _meta: { med: { tool: "Bash", background: { id: `b-${session.id}`, kind: "shell" } } },
      } as SessionUpdate,
    });
  return { events, running: session.state === "working" };
}
