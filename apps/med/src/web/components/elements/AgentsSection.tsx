import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentPreset, OwnedState } from "../../../shared/owned-session";
import type { AgentInbox } from "../../data/agent-inbox";
import type { AgentStatus } from "../../../shared/agent-status";
import type { Workspace } from "../../data/workspaces";
import { tokens } from "../../theme.stylex";
import { WorkspaceListPreview } from "../Workspaces";
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

const LIST: Workspace[] = [
  { id: "w1", kind: "repository", home: true, branch: "main", title: "main", detail: "3" },
  {
    id: "w2",
    kind: "review",
    reviewId: "r1",
    title: "Weeks in relative times",
    sessions: [{ agent: "claude", id: "s1", cwd: "/work/trail-notes" }],
  },
  { id: "w3", kind: "review", reviewId: "r2", title: "Durations in the export" },
  {
    id: "w4",
    kind: "review",
    reviewId: "r3",
    title: "Club summary layout",
    unread: true,
    sessions: [{ agent: "codex", id: "s3", cwd: "/work/trail-notes" }],
  },
  {
    id: "w5",
    kind: "review",
    reviewId: "r4",
    title: "Theme tokens",
    detail: "5",
    sessions: [{ agent: "claude", id: "s4", cwd: "/work/trail-notes" }],
  },
];
const STATUSES: AgentStatus[] = [
  { reviewId: "r1", sessionId: "s1", agent: "claude", state: "working", updatedAt: 3 },
  {
    reviewId: "r2",
    sessionId: "s2",
    agent: "acp",
    name: "OpenCode",
    state: "waiting",
    updatedAt: 2,
  },
  { reviewId: "r3", sessionId: "s3", agent: "codex", state: "idle", updatedAt: 2 },
  { reviewId: "r4", sessionId: "s4", agent: "claude", state: "idle", updatedAt: 1 },
];

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
        title="Workspace list"
        note="Each saved review shows its lead session: working, Needs you, or new when a turn ended while you looked elsewhere. Read rows show their changed files."
        span="half"
        padded={false}
      >
        <div {...stylex.props(styles.sidebar)}>
          <WorkspaceListPreview workspaces={LIST} statuses={STATUSES} />
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
