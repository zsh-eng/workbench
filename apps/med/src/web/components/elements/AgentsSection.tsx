import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentPreset, OwnedState } from "../../../shared/owned-session";
import type { AgentInbox } from "../../data/agent-inbox";
import type { Thread } from "../../../shared/threads";
import type { WorkspaceSnapshot } from "../../data/workspaces";
import { tokens } from "../../theme.stylex";
import { ThreadSidebar, type SidebarSource } from "../shell/ThreadSidebar";
import { PermissionCard, SessionComposer } from "../session/SessionComposer";
import { SessionPanel, SessionStart } from "../session/SessionPanel";
import { createDemoAgent, createLongSession, demoAgents } from "./owned-fixture";
import { Section, Specimen } from "./Specimen";

const DRAFTS = [
  {
    id: "n1",
    path: "src/web/data/relative-time.ts",
    line: 14,
    text: "Show weeks before months.",
    replies: 0,
  },
  { id: "n2", path: "tests/relative-time.test.ts", line: 8, text: "Test 7 days.", replies: 0 },
];

/** The real Session pane, with a scripted agent behind a fake host. */
function RunningSession({ preset }: { preset: AgentPreset }) {
  const [agent] = useState(() =>
    createDemoAgent(preset, { drafts: preset.kind === "claude" ? DRAFTS : [] }),
  );
  useEffect(() => () => agent.dispose(), [agent]);
  const state = useSyncExternalStore(agent.subscribeInbox, agent.inbox);
  const inbox = useMemo<AgentInbox>(() => ({ state, send: agent.send }), [state, agent]);
  const starter = useMemo(() => ({ agents: demoAgents, start: async () => {} }), []);
  return (
    <div {...stylex.props(styles.frame)}>
      <SessionPanel
        reviewId="demo"
        sessions={[agent.session]}
        fetcher={agent.fetcher}
        inbox={inbox}
        starter={starter}
        onOpenPath={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

const settings = (status: OwnedState["status"]): OwnedState => ({
  sessionId: "still",
  preset: "claude",
  name: "Claude Code",
  status,
  settings: [
    {
      id: "model",
      name: "Model",
      category: "model",
      value: "sonnet",
      options: [{ value: "sonnet", name: "Sonnet" }],
    },
    {
      id: "effort",
      name: "Effort",
      category: "effort",
      value: "high",
      idleOnly: true,
      options: [{ value: "high", name: "High" }],
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
  turns: 3,
});

const NOW = Date.UTC(2026, 9, 13, 21, 0);
const THREADS: Thread[] = [
  {
    id: "r1",
    title: "Weeks in relative times",
    createdAt: "2026-10-13T20:00:00Z",
    updatedAt: NOW - 20_000,
    repository: { id: "trail", name: "trail-notes", path: "/work/trail-notes" },
    branch: "relative-weeks",
    agent: "claude",
    state: "working",
    changes: { files: 3, additions: 42, deletions: 9 },
  },
  {
    id: "r2",
    title: "Durations in the export",
    createdAt: "2026-10-13T19:00:00Z",
    updatedAt: NOW - 6 * 60_000,
    repository: { id: "trail", name: "trail-notes", path: "/work/trail-notes" },
    branch: "export-durations",
    agent: "acp",
    state: "waiting",
    changes: { files: 2, additions: 18, deletions: 4 },
  },
  {
    id: "r3",
    title: "Club summary layout",
    createdAt: "2026-10-13T18:00:00Z",
    updatedAt: NOW - 25 * 60_000,
    repository: { id: "trail", name: "trail-notes", path: "/work/trail-notes" },
    branch: "summary-layout",
    agent: "codex",
    state: "idle",
    changes: { files: 4, additions: 61, deletions: 30 },
  },
  {
    id: "r4",
    title: "Theme tokens",
    createdAt: "2026-10-12T18:00:00Z",
    updatedAt: NOW - 26 * 3600_000,
    repository: { id: "site", name: "club-site", path: "/work/club-site" },
    branch: "main",
    agent: "claude",
    state: "idle",
  },
];
const SOURCES: SidebarSource[] = [
  { kind: "repository", id: "trail", name: "trail-notes", path: "/work/trail-notes" },
  { kind: "repository", id: "site", name: "club-site", path: "/work/club-site" },
  { kind: "vault", id: "notes", name: "Club notes" },
];
const SNAPSHOT: WorkspaceSnapshot = {
  workspaces: [{ id: "w1", kind: "review", reviewId: "r1", title: "Weeks in relative times" }],
  active: "w1",
  recent: ["w1"],
};

/** The real Session pane on a session of 600 turns. */
function LongSession() {
  const [long] = useState(createLongSession);
  return (
    <div {...stylex.props(styles.frame)}>
      <SessionPanel
        reviewId="demo"
        sessions={[long.session]}
        fetcher={long.fetcher}
        onOpenPath={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

/** One composer state, without an agent behind it. */
function Still({ state }: { state: OwnedState }) {
  return (
    <div {...stylex.props(styles.still)}>
      <SessionComposer
        agent="claude"
        name="Claude"
        waiting={false}
        drafts={[]}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onSend={async () => {}}
        owned={{ state, act: async () => {} }}
      />
    </div>
  );
}

/**
 * Sessions that Med starts and runs: the agent that the user installed,
 * started in the review's repository. Claude Code runs with stream-json;
 * other agents, such as OpenCode, run with the Agent Client Protocol.
 */
export function AgentsSection() {
  const [starter] = useState(() => ({
    agents: demoAgents,
    start: () => new Promise<void>((resolve) => setTimeout(resolve, 1200)),
  }));
  return (
    <Section
      id="agents"
      title="Agents that Med runs"
      lede="Med starts an agent that you installed, in the review's repository, and runs it beside the review. Send a message: the agent reads a file, asks to edit it, and replies. Model, effort, and mode are pickers; / lists the agent's own commands; Stop or Esc ends a turn."
    >
      <Specimen
        title="Claude Code"
        note="Two review comments wait as drafts. Try Plan mode, Accept edits, or Stop while it works."
        span="half"
        padded={false}
        zoomable={false}
      >
        <RunningSession preset={demoAgents[0]!} />
      </Specimen>
      <Specimen
        title="An ACP agent"
        note="OpenCode through the Agent Client Protocol: its own models, modes, and answers."
        span="half"
        padded={false}
        zoomable={false}
      >
        <RunningSession preset={demoAgents[1]!} />
      </Specimen>
      <Specimen
        title="Start a session"
        note="A review without a session. Agents that are not installed show, so you know what Med can run."
        span="half"
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.frame, styles.short)}>
          <SessionStart starter={starter} repo="/work/trail-notes" />
        </div>
      </Specimen>
      <Specimen
        title="Thread list"
        note="Every thread, by repository: a turning arc while its agent works, a pulsing dot when it needs you, and a dot when a turn ended while you looked elsewhere. Each row names its branch and its changed lines."
        span="half"
        padded={false}
      >
        <div {...stylex.props(styles.sidebar)}>
          <ThreadSidebar
            threads={THREADS}
            sources={SOURCES}
            snapshot={SNAPSHOT}
            loaded
            onOpen={() => {}}
            onNewThread={() => {}}
            onHide={() => {}}
            onSources={() => {}}
          />
        </div>
      </Specimen>
      <Specimen title="Permission requests" note="Claude Code, then an ACP agent." span="half">
        <div {...stylex.props(styles.stack)}>
          <PermissionCard
            permission={{
              id: "a",
              title: "Claude Code wants to use Bash",
              detail: "bun test tests/relative-time.test.ts",
              options: [
                { id: "allow", name: "Allow", kind: "allow_once" },
                { id: "always", name: "Allow for this session", kind: "allow_always" },
                { id: "deny", name: "Deny", kind: "reject_once" },
              ],
            }}
            onAnswer={() => {}}
          />
          <PermissionCard
            permission={{
              id: "b",
              title: "OpenCode wants to run Edit relative-time.ts",
              detail: "src/web/data/relative-time.ts",
              options: [
                { id: "once", name: "Allow once", kind: "allow_once" },
                { id: "always", name: "Always allow", kind: "allow_always" },
                { id: "reject", name: "Reject", kind: "reject_once" },
              ],
            }}
            onAnswer={() => {}}
          />
        </div>
      </Specimen>
      <Specimen
        title="Questions and plans"
        note="Claude Code's AskUserQuestion: number keys pick a choice, and Other takes an answer of your own. ExitPlanMode: the plan, then Approve with the mode to continue in, or Keep planning."
        span="half"
      >
        <div {...stylex.props(styles.stack)}>
          <PermissionCard
            permission={{
              id: "q",
              title: "Claude Code asks",
              options: [
                { id: "answer", name: "Answer", kind: "allow_once" },
                { id: "deny", name: "Skip", kind: "reject_once" },
              ],
              questions: [
                {
                  question: "Which format should durations use?",
                  header: "Format",
                  options: [
                    { label: "Short", description: "1h 5m" },
                    { label: "Long", description: "1 hour 5 minutes" },
                  ],
                },
                {
                  question: "Which units can show?",
                  header: "Units",
                  multiSelect: true,
                  options: [{ label: "Hours" }, { label: "Minutes" }, { label: "Seconds" }],
                },
              ],
            }}
            onAnswer={() => {}}
          />
          <PermissionCard
            permission={{
              id: "p",
              title: "Claude Code's plan",
              options: [
                { id: "approve", name: "Approve", kind: "allow_once" },
                { id: "deny", name: "Keep planning", kind: "reject_once" },
              ],
              plan: {
                text: "# Format durations\n\n1. Add `formatDuration` to `src/web/data/relative-time.ts`.\n2. Show hours past 60 minutes.\n3. Test the hour and the minute.\n",
                modes: [
                  { value: "acceptEdits", name: "Accept edits" },
                  { value: "default", name: "Ask" },
                  { value: "auto", name: "Auto" },
                ],
                mode: "acceptEdits",
              },
            }}
            onAnswer={() => {}}
          />
        </div>
      </Specimen>
      <Specimen
        title="A long session"
        note="600 turns. The thread holds a window of at most 600 rows; scroll up for earlier rows, then earlier pages. Turns (the clock) lists every prompt and jumps to it."
        padded={false}
        zoomable={false}
      >
        <LongSession />
      </Specimen>
      <Specimen
        title="Composer states"
        note="Starting, a full context window, and a stopped agent."
      >
        <div {...stylex.props(styles.row)}>
          <Still state={settings("starting")} />
          <Still state={{ ...settings("idle"), context: { used: 172_000, total: 200_000 } }} />
          <Still state={settings("exited")} />
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  frame: {
    display: "flex",
    height: 560,
    overflow: "hidden",
    backgroundColor: tokens.canvas,
  },
  short: { height: 360 },
  sidebar: { width: 280, paddingBlock: 8, backgroundColor: tokens.panel },
  stack: { display: "flex", flexDirection: "column", gap: 8, marginInline: -12 },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 12,
    marginInline: -12,
  },
  still: { display: "flex", flexDirection: "column" },
});
