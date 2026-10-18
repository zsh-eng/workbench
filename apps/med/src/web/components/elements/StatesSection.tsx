import * as stylex from "@stylexjs/stylex";
import {
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Thread } from "../../../shared/threads";
import { withSentMessages } from "../../data/agent-inbox";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { SessionComposer } from "../session/SessionComposer";
import { ConnectionNote, SessionNotice, TurnMark } from "../session/SessionNotice";
import { SessionThread } from "../session/SessionThread";
import { ThreadRowsPreview } from "../shell/ThreadSidebar";
import { Section, Specimen } from "./Specimen";
import {
  NOW,
  ownedIn,
  receipts,
  receiptsStore,
  storeFor,
  threadIn,
  type Story,
} from "./states-fixture";

// The durable sessions design, drawn with Med's own parts: each state of one
// thread as a frame, from the thread list to the composer, so a state reads
// the same everywhere it shows. Frames marked New are parts Med does not show
// yet; the host sends `halt` and the notices in the first step of the work.

const noop = () => {};
const act = async () => {};

function Composer(props: Partial<ComponentProps<typeof SessionComposer>>) {
  return (
    <SessionComposer
      agent="claude"
      name="Claude Code"
      waiting={false}
      drafts={[]}
      attachments={[]}
      onRemoveAttachment={noop}
      onSend={noop}
      {...props}
    />
  );
}

function ThreadPane({ story, endMark }: { story: Story; endMark?: ReactNode }) {
  const [store] = useState(() => storeFor(story));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div {...stylex.props(styles.thread)}>
      {/* The clock runs only while a turn does, as in Med. */}
      <SessionThread
        snapshot={snapshot}
        now={story === "running" ? NOW : undefined}
        endMark={endMark}
      />
    </div>
  );
}

type Tag = "in-med" | "new" | "changed";
const TAGS: Record<Tag, string> = { "in-med": "In Med", new: "New", changed: "Changed" };

interface FrameSpec {
  id: string;
  name: string;
  tag: Tag;
  cause: string;
  actions: string;
  thread: Thread;
  story: Story;
  endMark?: ReactNode;
  /** The pane under the thread: the composer, with a notice when one shows. */
  bottom: ReactNode;
  /** A notice above the composer needs a taller pane. */
  tall?: boolean;
}

const turnStopped = (
  <TurnMark
    title="Interrupted by a restart"
    at="13:52"
    actions={[
      { label: "Continue", primary: true, run: noop },
      { label: "Dismiss", run: noop },
    ]}
  >
    The turn stopped while it ran <code>bun test</code>. Continue asks Claude Code to go on from
    here.
  </TurnMark>
);

const FRAMES: FrameSpec[] = [
  {
    id: "not-started",
    name: "Not started",
    tag: "in-med",
    cause: "A tab that came back after a reboot. No agent runs yet.",
    actions: "Send starts Claude Code with the message.",
    thread: threadIn({ updatedAt: NOW - 14 * 3600_000 }),
    story: "history",
    bottom: <Composer presence="resumable" />,
  },
  {
    id: "starting",
    name: "Starting",
    tag: "in-med",
    cause: "The first message, or Restart.",
    actions: "Wait; the message goes once the agent runs.",
    thread: threadIn({ state: "working", turn: { activity: "Starting Claude Code" } }),
    story: "history",
    bottom: <Composer owned={{ state: ownedIn("starting"), act }} />,
  },
  {
    id: "ready",
    name: "Ready",
    tag: "in-med",
    cause: "The turn ended. The row is bold until you read the reply.",
    actions: "Send.",
    thread: threadIn({}),
    story: "history",
    bottom: <Composer owned={{ state: ownedIn("idle"), act }} />,
  },
  {
    id: "working",
    name: "Working",
    tag: "in-med",
    cause: "A turn runs. The row names what it does now.",
    actions: "Stop (Esc), or send a message that waits for the turn.",
    thread: threadIn({ state: "working", turn: { activity: "Running bun test" } }),
    story: "running",
    bottom: <Composer owned={{ state: ownedIn("working"), act }} />,
  },
  {
    id: "needs-you",
    name: "Needs you",
    tag: "in-med",
    cause: "A permission request, a question, or a plan to approve.",
    actions: "Allow, Deny, or answer.",
    thread: threadIn({
      state: "waiting",
      turn: { activity: "Asks for permission: Bash" },
    }),
    story: "running",
    bottom: (
      <Composer
        owned={{
          state: ownedIn("working", {
            permission: {
              id: "p1",
              title: "Claude Code wants to use Bash",
              detail: "bun test tests/export.test.ts",
              options: [
                { id: "allow", name: "Allow", kind: "allow_once" },
                { id: "always", name: "Allow for this session", kind: "allow_always" },
                { id: "deny", name: "Deny", kind: "reject_once" },
              ],
            },
          }),
          act,
        }}
      />
    ),
  },
  {
    id: "interrupted",
    name: "Interrupted",
    tag: "new",
    cause: "A reboot or a forced stop cut a turn. Med never goes on alone.",
    actions: "Continue, or Dismiss to leave the turn as it is.",
    thread: threadIn({ halt: { kind: "interrupted", detail: "A restart cut the turn at 13:52" } }),
    story: "cut",
    endMark: turnStopped,
    bottom: <Composer presence="resumable" />,
  },
  {
    id: "stopped",
    tall: true,
    name: "Stopped",
    tag: "new",
    cause: "The agent exited. The session itself is fine and resumes.",
    actions: "Restart resumes it. A message typed now sends after the restart.",
    thread: threadIn({ halt: { kind: "stopped", detail: "Exited with code 1" } }),
    story: "history",
    bottom: (
      <Composer
        owned={{ state: ownedIn("idle"), act }}
        notice={
          <SessionNotice
            tone="stopped"
            title="Claude Code stopped"
            lines={
              "Error: ENOSPC: no space left on device, write\n    at writeSync (node:fs:927:3)"
            }
            actions={[
              { label: "Restart", primary: true, run: noop },
              { label: "Show log", run: noop },
            ]}
          >
            It exited with code 1 at 14:06. Restart resumes the session where it was.
          </SessionNotice>
        }
      />
    ),
  },
  {
    id: "not-logged-in",
    tall: true,
    name: "Not logged in",
    tag: "new",
    cause: "Med's login check, before it starts the agent, or the agent's own exit.",
    actions: "Log in once in a terminal, then Try again.",
    thread: threadIn({ halt: { kind: "login", detail: "Claude Code is not logged in" } }),
    story: "history",
    bottom: (
      <Composer
        presence="resumable"
        notice={
          <SessionNotice
            tone="stopped"
            title="Claude Code is not logged in on this Mac"
            command="claude auth login"
            actions={[{ label: "Try again", primary: true, run: noop }]}
          >
            Log in once in a terminal. With an API key, export ANTHROPIC_API_KEY in your shell
            profile: Med reads your login shell’s environment.
          </SessionNotice>
        }
      />
    ),
  },
  {
    id: "keeps-stopping",
    tall: true,
    name: "Keeps stopping",
    tag: "new",
    cause: "Three exits in five minutes. Med stops restarting it alone.",
    actions: "Read the log, then Restart.",
    thread: threadIn({ halt: { kind: "crashing", detail: "Stopped 3 times in 5 minutes" } }),
    story: "history",
    bottom: (
      <Composer
        owned={{ state: ownedIn("idle"), act }}
        notice={
          <SessionNotice
            tone="stopped"
            title="Claude Code keeps stopping"
            lines="FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"
            actions={[
              { label: "Restart", primary: true, run: noop },
              { label: "Show log", run: noop },
            ]}
          >
            It stopped 3 times in 5 minutes, so Med does not restart it again by itself.
          </SessionNotice>
        }
      />
    ),
  },
  {
    id: "open-elsewhere",
    name: "Open elsewhere",
    tag: "in-med",
    cause: "The same session runs in a terminal. Med can’t type there.",
    actions: "Messages wait until it closes, or Continue in Med forks it.",
    thread: threadIn({}),
    story: "history",
    bottom: <Composer presence="terminal" onContinue={act} />,
  },
  {
    id: "read-only",
    name: "Read only",
    tag: "new",
    cause: "An agent that cannot resume a session, after its process ended.",
    actions: "New session, in the same checkout.",
    thread: threadIn({ agent: "acp" }),
    story: "history",
    bottom: (
      <SessionNotice
        tone="quiet"
        icon="history"
        title="OpenCode can’t resume this session"
        actions={[{ label: "New session", primary: true, run: noop }]}
      >
        Its history stays here to read. A new session starts fresh in the same checkout.
      </SessionNotice>
    ),
  },
];

/** One state as a frame: the tab's row, then the Session pane. */
function Frame({ spec }: { spec: FrameSpec }) {
  return (
    <article
      id={`state-${spec.id}`}
      aria-labelledby={`state-${spec.id}-name`}
      {...stylex.props(styles.frame)}
    >
      <header {...stylex.props(styles.frameHeader)}>
        <h3 id={`state-${spec.id}-name`} {...stylex.props(styles.frameName)}>
          {spec.name}
        </h3>
        <span {...stylex.props(styles.tag, spec.tag === "new" && styles.tagNew)}>
          {TAGS[spec.tag]}
        </span>
      </header>
      <div {...stylex.props(styles.board)}>
        <span {...stylex.props(ui.label, styles.layer)}>Thread list</span>
        <div {...stylex.props(styles.rowSlot)}>
          <ThreadRowsPreview
            threads={[spec.thread]}
            now={NOW}
            unread={spec.id === "ready" ? [spec.thread.id] : []}
          />
        </div>
        <span {...stylex.props(ui.label, styles.layer)}>Session</span>
        <div {...stylex.props(styles.pane, spec.tall && styles.tall)}>
          <ThreadPane story={spec.story} endMark={spec.endMark} />
          {spec.bottom}
        </div>
      </div>
      <dl {...stylex.props(styles.spec)}>
        <dt {...stylex.props(styles.specTerm)}>Cause</dt>
        <dd {...stylex.props(styles.specValue)}>{spec.cause}</dd>
        <dt {...stylex.props(styles.specTerm)}>You can</dt>
        <dd {...stylex.props(styles.specValue)}>{spec.actions}</dd>
      </dl>
    </article>
  );
}

// ------------------------------------------------------------------ map

type Node = { id: string; label: string; x: number; y: number; tone?: "warning" | "red" };
const W = 132;
const H = 32;
const RUN = 44;
const HALT = 262;
const NODES: Node[] = [
  { id: "not-started", label: "Not started", x: 82, y: RUN },
  { id: "starting", label: "Starting", x: 262, y: RUN },
  { id: "ready", label: "Ready", x: 452, y: RUN },
  { id: "working", label: "Working", x: 642, y: RUN },
  { id: "needs-you", label: "Needs you", x: 862, y: RUN },
  { id: "not-logged-in", label: "Not logged in", x: 262, y: HALT, tone: "red" },
  { id: "stopped", label: "Stopped", x: 452, y: HALT, tone: "red" },
  { id: "keeps-stopping", label: "Keeps stopping", x: 642, y: HALT, tone: "red" },
  { id: "interrupted", label: "Interrupted", x: 862, y: HALT, tone: "warning" },
];

type Edge = { d: string; label: string; lx: number; ly: number; anchor?: "start" | "end" };
const top = RUN + H / 2;
const bottom = HALT - H / 2;
const BUS = 214;
const CAUSES: Edge[] = [
  { d: `M${82 + W / 2},${RUN} H${262 - W / 2 - 4}`, label: "Send", lx: 172, ly: RUN - 9 },
  { d: `M${262 + W / 2},${RUN} H${452 - W / 2 - 4}`, label: "Runs", lx: 357, ly: RUN - 9 },
  { d: `M${452 + W / 2},${RUN - 6} H${642 - W / 2 - 4}`, label: "Send", lx: 547, ly: RUN - 15 },
  {
    d: `M${642 - W / 2},${RUN + 6} H${452 + W / 2 + 4}`,
    label: "Turn ends",
    lx: 547,
    ly: RUN + 22,
  },
  { d: `M${642 + W / 2},${RUN - 6} H${862 - W / 2 - 4}`, label: "Asks", lx: 752, ly: RUN - 15 },
  { d: `M${862 - W / 2},${RUN + 6} H${642 + W / 2 + 4}`, label: "Answer", lx: 752, ly: RUN + 22 },
  {
    d: `M246,${top} V${bottom - 4}`,
    label: "Login check fails",
    lx: 238,
    ly: 132,
    anchor: "end",
  },
  {
    d: `M436,${top} V${bottom - 4}`,
    label: "The agent exits",
    lx: 428,
    ly: 132,
    anchor: "end",
  },
  {
    d: `M${452 + W / 2},${HALT} H${642 - W / 2 - 4}`,
    label: "3 times in 5 min",
    lx: 547,
    ly: HALT + 24,
  },
  {
    d: `M846,${top} V${bottom - 4}`,
    label: "A restart cuts the turn",
    lx: 838,
    ly: 132,
    anchor: "end",
  },
];
// Every way back goes through Starting: the reader's action, never Med's own.
const RETURNS: Edge[] = [
  {
    d: `M878,${bottom} V${BUS} H278 V${top + 4}`,
    label: "Continue",
    lx: 886,
    ly: BUS + 22,
    anchor: "start",
  },
  { d: `M658,${bottom} V${BUS}`, label: "Restart", lx: 666, ly: BUS + 22, anchor: "start" },
  { d: `M468,${bottom} V${BUS}`, label: "Restart", lx: 476, ly: BUS + 22, anchor: "start" },
  { d: `M278,${bottom} V${BUS}`, label: "Try again", lx: 286, ly: BUS + 22, anchor: "start" },
];

function StateMap() {
  const id = useId();
  const cause = `${id}-cause`;
  const back = `${id}-back`;
  return (
    <div {...stylex.props(styles.map)}>
      <svg
        viewBox="0 0 960 300"
        role="img"
        aria-label="How a thread moves between states"
        {...stylex.props(styles.mapSvg)}
      >
        <defs>
          <marker
            id={cause}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" {...stylex.props(styles.headCause)} />
          </marker>
          <marker
            id={back}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" {...stylex.props(styles.headBack)} />
          </marker>
        </defs>
        <text x={8} y={RUN - 30} {...stylex.props(styles.lane)}>
          RUNS
        </text>
        <text x={8} y={HALT + 40} {...stylex.props(styles.lane)}>
          WAITS FOR YOU
        </text>
        {CAUSES.map((edge) => (
          <g key={edge.d}>
            <path d={edge.d} markerEnd={`url(#${cause})`} {...stylex.props(styles.edgeCause)} />
            <text
              x={edge.lx}
              y={edge.ly}
              textAnchor={edge.anchor ?? "middle"}
              {...stylex.props(styles.edgeLabel)}
            >
              {edge.label}
            </text>
          </g>
        ))}
        {RETURNS.map((edge, index) => (
          <g key={edge.d}>
            <path
              d={edge.d}
              markerEnd={index === 0 ? `url(#${back})` : undefined}
              {...stylex.props(styles.edgeBack)}
            />
            <text
              x={edge.lx}
              y={edge.ly}
              textAnchor={edge.anchor ?? "middle"}
              {...stylex.props(styles.backLabel)}
            >
              {edge.label}
            </text>
          </g>
        ))}
        {NODES.map((node) => (
          <a key={node.id} href={`#state-${node.id}`} {...stylex.props(styles.nodeLink)}>
            <rect
              x={node.x - W / 2}
              y={node.y - H / 2}
              width={W}
              height={H}
              rx={H / 2}
              {...stylex.props(styles.node, node.tone && styles.nodeHalt)}
            />
            {node.tone && (
              <circle
                cx={node.x - W / 2 + 16}
                cy={node.y}
                r={3.5}
                {...stylex.props(node.tone === "warning" ? styles.dotWarning : styles.dotRed)}
              />
            )}
            <text
              x={node.tone ? node.x + 6 : node.x}
              y={node.y + 4}
              textAnchor="middle"
              {...stylex.props(styles.nodeLabel)}
            >
              {node.label}
            </text>
          </a>
        ))}
      </svg>
      <div {...stylex.props(styles.legend)}>
        <span {...stylex.props(styles.legendItem)}>
          <span {...stylex.props(styles.swatchCause)} /> What happens
        </span>
        <span {...stylex.props(styles.legendItem)}>
          <span {...stylex.props(styles.swatchBack)} /> What you do: every way back starts the agent
          again, and none runs by itself
        </span>
        <span {...stylex.props(styles.legendItem)}>
          <Icon name="terminal" size={12} /> Open elsewhere and Read only are not steps of a turn:
          another app holds the session, or the agent cannot resume.
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- receipts

function Receipts() {
  const [store] = useState(receiptsStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const shown = useMemo(
    () => ({ ...snapshot, items: withSentMessages(snapshot.items, receipts) }),
    [snapshot],
  );
  return (
    <div {...stylex.props(styles.receipts)}>
      <div {...stylex.props(styles.pane, styles.receiptPane)}>
        <div {...stylex.props(styles.thread)}>
          <SessionThread snapshot={shown} now={NOW} />
        </div>
      </div>
      <ol {...stylex.props(styles.steps)}>
        {[
          ["Received", "No mark: the agent took it. This is the normal case."],
          [
            "Sending…",
            "The browser’s copy, until Med answers. It survives a reload in the outbox.",
          ],
          ["Waiting for Claude to take it", "Saved: Med wrote it to disk. Safe from here."],
          ["Queued for Claude", "The agent is in a turn; it takes the message next."],
          ["Waiting for the terminal session", "Held: the session is open in a terminal."],
          ["Not sent", "The reason, with Retry and Discard. The text stays."],
        ].map(([name, note]) => (
          <li key={name} {...stylex.props(styles.step)}>
            <span {...stylex.props(styles.stepName)}>{name}</span>
            <span {...stylex.props(styles.stepNote)}>{note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------- connection

function ConnectionFrame({
  state,
  command,
}: {
  state: ComponentProps<typeof ConnectionNote>["state"];
  command?: string;
}) {
  return (
    <div {...stylex.props(styles.connectionFrame)}>
      <div {...stylex.props(styles.paneTitle)}>
        <Icon name="claude" size={13} />
        <span {...stylex.props(styles.paneTitleText)}>Durations in the export</span>
      </div>
      <ConnectionNote state={state} command={command} />
      <div {...stylex.props(styles.pane, styles.connectionPane)}>
        <ThreadPane story={state === "offline" ? "reply" : "running"} />
      </div>
    </div>
  );
}

export function StatesSection() {
  return (
    <Section
      id="agent-states"
      title="Agent states"
      lede={
        <>
          Every state of one thread, from the durable sessions design. Each frame shows the same
          moment in the thread list and the Session pane. A state that stops work names its cause
          and one action; nothing stops in silence, and nothing runs again by itself. Frames marked
          New are parts that Med does not show yet.
        </>
      }
    >
      <Specimen
        title="State map"
        note="Select a state to see its frame."
        padded={false}
        zoomable={false}
      >
        <StateMap />
      </Specimen>
      <Specimen
        title="Thread states"
        note="One thread, “Durations in the export”, in each state. The row and the pane always agree."
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.canvas)}>
          {FRAMES.map((spec) => (
            <Frame key={spec.id} spec={spec} />
          ))}
        </div>
      </Specimen>
      <Specimen
        title="Messages and receipts"
        note="Each message from Med says where it is until the agent takes it. One ID goes from the composer to the agent, so a retry never sends twice."
        padded={false}
        zoomable={false}
      >
        <Receipts />
      </Specimen>
      <Specimen
        title="Connection"
        note="The line shows after 2 seconds without Med, so a quick restart passes without a word. Agents keep working: the host does not own them."
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.connectionRow)}>
          <ConnectionFrame state="reconnecting" />
          <ConnectionFrame state="restarting" />
          <ConnectionFrame state="offline" command="med" />
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  // A canvas of frames, as in a design file: a dot grid behind them.
  canvas: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: 32,
    padding: 32,
    backgroundColor: tokens.panel,
    backgroundImage: `radial-gradient(${tokens.line} 1px, transparent 1px)`,
    backgroundSize: "16px 16px",
  },
  frame: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    scrollMarginTop: 64,
  },
  frameHeader: { display: "flex", alignItems: "center", gap: 8, paddingInline: 2 },
  frameName: { margin: 0, color: tokens.text, fontSize: 12.5, fontWeight: 600 },
  tag: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    color: tokens.faint,
    fontSize: 10.5,
    fontWeight: 500,
  },
  tagNew: { backgroundColor: tokens.accentSoft, color: tokens.accent },
  board: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 6px 20px -12px rgb(0 0 0 / 0.35)`,
  },
  layer: {
    paddingTop: 8,
    paddingBottom: 4,
    paddingInline: 12,
    fontSize: 10,
  },
  rowSlot: {
    paddingInline: 8,
    paddingBottom: 8,
    backgroundColor: tokens.panel,
    boxShadow: `inset 0 -1px 0 ${tokens.line}, inset 0 1px 0 ${tokens.line}`,
    paddingTop: 6,
  },
  pane: {
    display: "flex",
    flexDirection: "column",
    height: 480,
    minHeight: 0,
    backgroundColor: tokens.canvas,
  },
  tall: { height: 600 },
  thread: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  spec: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    rowGap: 3,
    columnGap: 10,
    margin: 0,
    paddingInline: 2,
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  specTerm: { color: tokens.faint },
  specValue: { margin: 0, color: tokens.muted },

  map: { display: "flex", flexDirection: "column", gap: 12, padding: 20 },
  mapSvg: { width: "100%", maxWidth: 960, height: "auto", overflow: "visible" },
  lane: {
    fill: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.08em",
  },
  nodeLink: { cursor: "pointer", outline: "none" },
  node: {
    fill: { default: tokens.raised, ":hover": tokens.hover },
    stroke: tokens.lineStrong,
    strokeWidth: 1,
  },
  nodeHalt: { fill: tokens.canvas },
  nodeLabel: {
    fill: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 500,
    pointerEvents: "none",
  },
  dotWarning: { fill: tokens.warning },
  dotRed: { fill: tokens.red },
  edgeCause: { fill: "none", stroke: tokens.faint, strokeWidth: 1.25 },
  edgeBack: {
    fill: "none",
    stroke: tokens.accent,
    strokeWidth: 1.25,
    strokeDasharray: "4 4",
  },
  headCause: { fill: tokens.faint },
  headBack: { fill: tokens.accent },
  edgeLabel: { fill: tokens.muted, fontFamily: tokens.ui, fontSize: 11 },
  backLabel: { fill: tokens.accent, fontFamily: tokens.ui, fontSize: 11, fontWeight: 500 },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: 6,
    columnGap: 20,
    color: tokens.muted,
    fontSize: 11.5,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  swatchCause: {
    width: 18,
    height: 0,
    borderTopWidth: 1.5,
    borderTopStyle: "solid",
    borderTopColor: tokens.faint,
  },
  swatchBack: {
    width: 18,
    height: 0,
    borderTopWidth: 1.5,
    borderTopStyle: "dashed",
    borderTopColor: tokens.accent,
  },

  receipts: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 1100px)": "minmax(0, 420px) minmax(0, 1fr)",
    },
    gap: 24,
    padding: 24,
  },
  receiptPane: {
    height: 520,
    borderRadius: `calc(10px * ${tokens.round})`,
    overflow: "hidden",
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  steps: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    alignSelf: "start",
  },
  step: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)",
    gap: 12,
    paddingBlock: 9,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    fontSize: 12,
    lineHeight: 1.45,
  },
  stepName: { color: tokens.text, fontWeight: 500 },
  stepNote: { color: tokens.muted },

  connectionRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 24,
    padding: 24,
    backgroundColor: tokens.panel,
  },
  connectionFrame: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  paneTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingInline: 12,
    color: tokens.muted,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
  },
  paneTitleText: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  connectionPane: { height: 280 },
});
