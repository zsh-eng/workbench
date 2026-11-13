import * as stylex from "@stylexjs/stylex";
import { useId, useState, type ReactNode, type Ref } from "react";
import type { PullRequestState } from "../../../shared/saved-review";
import type { ThreadUsage } from "../../../shared/model-usage";
import type { ContextBreakdown } from "../../../shared/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { tooltip } from "../ToolButton";
import { ContextDetails, ContextSummary } from "./ContextPanel";
import { dollars, modelName, SpendBlock, type ShownContext } from "./ThreadUsage";

// The session rail in a wide pane, as Claude Desktop has one: a pane of plain
// sections, a line between each. What the thread shows, the agent and where
// it works, the thread's reviews, its pull requests, the background tasks,
// the spend, and the context.
// docs/SESSIONS.md#session-rail.

/** The narrowest pane that shows the panel: a 540 pixel column for the
 * thread, 30 pixels at each of its sides, and the panel's 300. Beside the
 * panel the thread's column (session-styles.ts) narrows to the room that is
 * left, down to 540 pixels, as Claude Desktop's transcript narrows beside its
 * session rail. */
export const SIDE_PANEL_MIN_PANE = 900;

/** A row of the rail: one of the thread's reviews, or one of its pull requests. */
export interface ThreadLink {
  id: string;
  icon: IconName;
  label: string;
  detail?: string;
  /** A pull request's state: the colour of its mark, as in the review's header. */
  tone?: PullRequestState;
  /** What the pointer reads under the row's name, such as "Pull request #7, merged". */
  hint?: string;
  /** The one on screen, among several. */
  current?: boolean;
  /** Opens it in Med; or `href` opens a page. */
  onOpen?(): void;
  href?: string;
}

/** What the thread shows, and the agent with where it works. The two are
 * apart: the agent can work on one branch while the thread shows another. */
export interface SessionEnvironment {
  /** The repository that the thread shows, by its name. A worktree goes by
   * its repository's, not by its folder's. */
  repository?: string;
  /** The branch that the thread shows: its Changes, files, and search. */
  branch?: string;
  /** Opens the repositories, to show another one. */
  onRepository?(): void;
  /** Opens the branches and worktrees, to show another one. */
  onBranch?(): void;
  /** The branch of the checkout where the agent works. */
  agentBranch?: string;
  /** The agent's repository, when it is not the one that the thread shows. */
  agentRepository?: string;
  /** Shows the agent's branch in the thread. None while the thread shows it. */
  onAgentBranch?(): void;
  agent: string;
  agentIcon: IconName;
  model?: string;
  /** Who runs it: Med, a terminal, the Claude app, or nothing now. */
  runs: string;
}

const FOLDS = "med:session-panel-cards";
const readFolds = (): Record<string, boolean> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FOLDS) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

/** Whether a section is open: as the reader left it, in any thread. */
function useCardOpen(label: string, initial: boolean) {
  const [open, setOpen] = useState(() => readFolds()[label] ?? initial);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(FOLDS, JSON.stringify({ ...readFolds(), [label]: next }));
    } catch {
      // The choice lasts until the page reloads.
    }
  };
  return [open, toggle] as const;
}

/** A section of the rail, also for what the thread puts here (SessionThread.tsx). */
export function SidePanelCard({
  label,
  figure,
  children,
  details,
  folded = false,
  first = false,
}: {
  label: string;
  /** At the title's end: a total, or what the section says while it is folded. */
  figure?: ReactNode | ((open: boolean) => ReactNode);
  children?: ReactNode;
  /** Shows under the section's body while it is open. The title folds and
   * unfolds it, as a section of Claude Desktop's side panel does. */
  details?: ReactNode;
  /** Starts folded, until the reader opens it. */
  folded?: boolean;
  /** The rail's first section: no line over it. */
  first?: boolean;
}) {
  const [open, toggle] = useCardOpen(label, !folded);
  const body = useId();
  const end = typeof figure === "function" ? figure(open) : figure;
  return (
    <section aria-label={label} {...stylex.props(styles.section, first && styles.first)}>
      <div {...stylex.props(styles.head)}>
        {details ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            onClick={toggle}
            {...stylex.props(ui.button, styles.fold)}
          >
            <span {...stylex.props(styles.title)}>{label}</span>
            <span {...stylex.props(styles.chevron, !open && styles.chevronFolded)}>
              <Icon name="chevron" size={11} />
            </span>
          </button>
        ) : (
          <span {...stylex.props(styles.title)}>{label}</span>
        )}
        <span {...stylex.props(ui.grow)} />
        {end && <span {...stylex.props(styles.figure)}>{end}</span>}
      </div>
      {children}
      {details && open && (
        <div id={body} {...stylex.props(styles.details)}>
          {details}
        </div>
      )}
    </section>
  );
}

function Row({
  icon,
  label,
  detail,
  tone,
  hint,
  onOpen,
  href,
  current = false,
  tip,
}: Omit<ThreadLink, "id"> & {
  /** What a click does, with its keys: the tooltip of a row that is a control. */
  tip?: { label: string; keys?: string };
}) {
  // The pointer reads what a click does; else the whole name, with its hint.
  const says = tip
    ? tooltip(tip.label, tip.keys, "inline-start")
    : hint
      ? tooltip(label, undefined, "inline-start", hint)
      : { title: label };
  const body = (
    <>
      <span data-state={tone} {...stylex.props(styles.rowIcon, tone && styles[tone])}>
        <Icon name={icon} size={15} />
      </span>
      <span {...stylex.props(ui.truncate, styles.rowLabel)}>{label}</span>
      {detail && <span {...stylex.props(ui.truncate, styles.rowDetail)}>{detail}</span>}
    </>
  );
  // A row's name says its hint, or what a click on it does.
  const name = hint ? `${label}. ${hint}` : tip ? `${label}. ${tip.label}` : undefined;
  if (href)
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={name}
        {...says}
        {...stylex.props(styles.row, styles.link)}
      >
        {body}
      </a>
    );
  if (onOpen)
    return (
      <button
        type="button"
        aria-current={current || undefined}
        aria-label={name}
        onClick={onOpen}
        {...says}
        {...stylex.props(styles.row, styles.link, current && styles.current)}
      >
        {body}
      </button>
    );
  return (
    <div {...says} {...stylex.props(styles.row)}>
      {body}
    </div>
  );
}

/** A scroller's props with the slim scroll bar (SessionThread.css). */
export const slim = (props: ReturnType<typeof stylex.props>, more = "") => ({
  ...props,
  className: `${props.className ?? ""} med-slim-scroll ${more}`.trim(),
});

/** The context while its section is folded: the share, and a small meter. */
function ContextFigure({ context }: { context: ShownContext }) {
  const share = context.window ? Math.min(1, context.used / context.window) : 0;
  const near = context.used >= 0.8 * (context.compaction?.at ?? context.window);
  return (
    <>
      {Math.round(share * 100)}%
      <span
        role="meter"
        aria-label="Context in use"
        aria-valuemin={0}
        aria-valuemax={context.window}
        aria-valuenow={context.used}
        aria-valuetext={`${Math.round(share * 100)}%`}
        {...stylex.props(styles.meter)}
      >
        <span {...stylex.props(styles.meterFill(`${share * 100}%`), near && styles.meterNear)} />
      </span>
    </>
  );
}

export function SessionSidePanel({
  usage,
  context,
  breakdown,
  working = false,
  reviews,
  pulls,
  place,
  backgroundRef,
  agentsRef,
}: {
  usage: ThreadUsage | null;
  context: ShownContext | undefined;
  /** What fills the context, from the agent that Med runs. */
  breakdown?: ContextBreakdown;
  /** A turn runs, at whose end the breakdown is read again. */
  working?: boolean;
  /** What the agent handed off to read, newest first. */
  reviews?: ThreadLink[];
  /** The thread's pull requests: each opens its own page. */
  pulls?: ThreadLink[];
  place: SessionEnvironment;
  /** Where the thread puts its Background dock. */
  backgroundRef: Ref<HTMLDivElement>;
  /** Where the thread puts its list of subagents, in place of the tabs over it. */
  agentsRef?: Ref<HTMLDivElement>;
}) {
  return (
    <aside aria-label="Session rail" {...slim(stylex.props(styles.panel))}>
      {(place.repository || place.branch) && (
        <SidePanelCard label="Thread" first>
          <div {...stylex.props(styles.rows)}>
            {place.repository && (
              <Row
                icon="repository"
                label={place.repository}
                onOpen={place.onRepository}
                tip={place.onRepository && { label: "Show another repository", keys: "Mod+O" }}
              />
            )}
            {place.branch && (
              <Row
                icon="gitBranch"
                label={place.branch}
                onOpen={place.onBranch}
                tip={
                  place.onBranch && {
                    label: "Show another branch or worktree",
                    keys: "Mod+Shift+G",
                  }
                }
              />
            )}
          </div>
        </SidePanelCard>
      )}
      <SidePanelCard label="Agent" first={!place.repository && !place.branch}>
        <div {...stylex.props(styles.rows)}>
          <Row
            icon={place.agentIcon}
            label={place.model ? `${place.agent} ${modelName(place.model)}` : place.agent}
            detail={place.runs}
          />
          {place.agentBranch && (
            <Row
              icon="gitBranch"
              label={place.agentBranch}
              detail={place.agentRepository}
              onOpen={place.onAgentBranch}
              tip={place.onAgentBranch && { label: "Show the agent's branch" }}
            />
          )}
        </div>
      </SidePanelCard>
      {reviews && reviews.length > 0 && (
        <SidePanelCard label="Reviews">
          <div {...stylex.props(styles.rows)}>
            {reviews.map(({ id, ...link }) => (
              <Row key={id} {...link} />
            ))}
          </div>
        </SidePanelCard>
      )}
      {pulls && pulls.length > 0 && (
        <SidePanelCard label="Pull requests">
          <div {...stylex.props(styles.rows)}>
            {pulls.map(({ id, ...link }) => (
              <Row key={id} {...link} />
            ))}
          </div>
        </SidePanelCard>
      )}
      <div ref={backgroundRef} {...stylex.props(styles.slot)} />
      <div ref={agentsRef} {...stylex.props(styles.slot)} />
      {usage && (
        <SidePanelCard
          label="Spend"
          figure={dollars(usage.spend.total)}
          folded
          details={<SpendBlock usage={usage} table={false} />}
        />
      )}
      {context && (
        <SidePanelCard
          label="Context"
          // Folded, one line says it; open, the summary under it does.
          figure={(open) => !open && <ContextFigure context={context} />}
          folded
          details={
            <>
              <ContextSummary context={context} breakdown={breakdown} />
              <ContextDetails context={context} breakdown={breakdown} working={working} />
            </>
          }
        />
      )}
    </aside>
  );
}

const styles = stylex.create({
  // A pane beside the thread: a line at its start, and its sections on the
  // thread's own ground.
  panel: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    width: 300,
    minHeight: 0,
    overflowY: "auto",
    paddingInline: 16,
    paddingBottom: 16,
    boxShadow: `inset 1px 0 0 ${tokens.line}`,
    fontFamily: tokens.ui,
  },
  section: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  first: { borderTopWidth: 0 },
  // A section without its own body, such as Background before a task runs.
  slot: { display: "contents" },
  head: { display: "flex", alignItems: "center", gap: 6, minHeight: 26 },
  title: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  fold: {
    gap: 4,
    height: 24,
    marginInlineStart: -6,
    paddingInline: 6,
    color: tokens.text,
  },
  chevron: {
    display: "inline-flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  chevronFolded: { transform: "rotate(-90deg)" },
  figure: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: tokens.muted,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
  },
  meter: {
    display: "inline-flex",
    width: 28,
    height: 6,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: tokens.fill,
  },
  meterFill: (width: string) => ({
    width,
    minWidth: 3,
    borderRadius: 3,
    backgroundColor: tokens.muted,
  }),
  meterNear: { backgroundColor: tokens.accent },
  rows: { display: "flex", flexDirection: "column", gap: 1, marginInline: -8 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    minHeight: 30,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    textAlign: "left",
    textDecoration: "none",
  },
  link: {
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  current: { backgroundColor: { default: tokens.fill, ":hover": tokens.fill } },
  rowIcon: { display: "inline-flex", flexShrink: 0, color: tokens.muted },
  open: { color: tokens.green },
  draft: { color: tokens.muted },
  merged: { color: tokens.accent },
  closed: { color: tokens.red },
  rowLabel: { flexShrink: 1 },
  rowDetail: {
    marginInlineStart: "auto",
    flexShrink: 0,
    maxWidth: "50%",
    color: tokens.faint,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  details: { display: "flex", flexDirection: "column", gap: 10, minWidth: 0, paddingTop: 4 },
});
