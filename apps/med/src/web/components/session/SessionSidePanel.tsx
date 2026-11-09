import * as stylex from "@stylexjs/stylex";
import { useId, useState, type ReactNode, type Ref } from "react";
import type { ThreadUsage } from "../../../shared/model-usage";
import type { ContextBreakdown } from "../../../shared/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ContextDetails, ContextSummary } from "./ContextPanel";
import { dollars, modelName, SpendBlock, type ShownContext } from "./ThreadUsage";

// The session rail in a wide pane, as Claude Desktop has one: quiet cards for
// the context, the spend, the background tasks, the thread's reviews, and
// where the agent works. docs/SESSIONS.md#session-rail.

/** The narrowest pane that shows the panel: a 540 pixel column for the
 * thread, 30 pixels at each of its sides, and the panel's 300. Beside the
 * panel the thread's column (session-styles.ts) narrows to the room that is
 * left, down to 540 pixels, as Claude Desktop's transcript narrows beside its
 * session rail. */
export const SIDE_PANEL_MIN_PANE = 900;

/** A row of the Reviews card: one of the reviews that the session handed
 * off, the live changes, or the pull request. */
export interface ThreadLink {
  id: string;
  icon: IconName;
  label: string;
  detail?: string;
  /** The review on screen, among the session's several. */
  current?: boolean;
  /** Opens it in Med; or `href` opens a page. */
  onOpen?(): void;
  href?: string;
}

/** Where the agent works and what runs it. */
export interface SessionEnvironment {
  folder?: string;
  branch?: string;
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

/** Whether a card is open: as the reader left it, in any thread. */
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

/** A card of the panel, also for what the thread puts here (SessionThread.tsx). */
export function SidePanelCard({
  label,
  figure,
  children,
  details,
  folded = false,
}: {
  label: string;
  figure?: ReactNode;
  children?: ReactNode;
  /** Shows under the card's body while it is open. The card's title folds
   * and unfolds it, as a card in Claude Desktop's side panel does. */
  details?: ReactNode;
  /** Starts folded, until the reader opens it. */
  folded?: boolean;
}) {
  const [open, toggle] = useCardOpen(label, !folded);
  const body = useId();
  return (
    <section aria-label={label} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        {details ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            onClick={toggle}
            {...stylex.props(ui.button, styles.cardTrigger)}
          >
            <span {...stylex.props(styles.cardLabel)}>{label}</span>
            <span {...stylex.props(styles.chevron, !open && styles.chevronFolded)}>
              <Icon name="chevron" size={11} />
            </span>
          </button>
        ) : (
          <span {...stylex.props(styles.cardTitle, styles.cardLabel)}>{label}</span>
        )}
        <span {...stylex.props(ui.grow)} />
        {figure && <span {...stylex.props(styles.figure)}>{figure}</span>}
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
  onOpen,
  href,
  current = false,
  title = label,
}: Omit<ThreadLink, "id"> & { title?: string }) {
  const body = (
    <>
      <span {...stylex.props(styles.rowIcon)}>
        <Icon name={icon} size={14} />
      </span>
      <span {...stylex.props(ui.truncate, styles.rowLabel)} title={title}>
        {label}
      </span>
      {detail && (
        <span {...stylex.props(ui.truncate, styles.rowDetail)} title={detail}>
          {detail}
        </span>
      )}
    </>
  );
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" {...stylex.props(styles.row, styles.link)}>
        {body}
      </a>
    );
  if (onOpen)
    return (
      <button
        type="button"
        aria-current={current || undefined}
        onClick={onOpen}
        {...stylex.props(styles.row, styles.link, current && styles.current)}
      >
        {body}
      </button>
    );
  return <div {...stylex.props(styles.row)}>{body}</div>;
}

/** A scroller's props with the slim scroll bar (SessionThread.css). */
export const slim = (props: ReturnType<typeof stylex.props>, more = "") => ({
  ...props,
  className: `${props.className ?? ""} med-slim-scroll ${more}`.trim(),
});

export function SessionSidePanel({
  usage,
  context,
  breakdown,
  working = false,
  links,
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
  links?: ThreadLink[];
  place: SessionEnvironment;
  /** Where the thread puts its Background dock. */
  backgroundRef: Ref<HTMLDivElement>;
  /** Where the thread puts its list of subagents, in place of the tabs over it. */
  agentsRef?: Ref<HTMLDivElement>;
}) {
  return (
    <aside aria-label="Session rail" {...slim(stylex.props(styles.panel))}>
      {context && (
        <SidePanelCard
          label="Context"
          details={<ContextDetails context={context} breakdown={breakdown} working={working} />}
        >
          <ContextSummary context={context} breakdown={breakdown} />
        </SidePanelCard>
      )}
      {usage && (
        <SidePanelCard
          label="Spend"
          figure={dollars(usage.spend.total)}
          folded
          details={<SpendBlock usage={usage} table={false} />}
        />
      )}
      <div ref={backgroundRef} {...stylex.props(styles.slot)} />
      <div ref={agentsRef} {...stylex.props(styles.slot)} />
      {links && links.length > 0 && (
        <SidePanelCard label="Reviews">
          <div {...stylex.props(styles.rows)}>
            {links.map(({ id, ...link }) => (
              <Row key={id} {...link} />
            ))}
          </div>
        </SidePanelCard>
      )}
      <SidePanelCard label="Environment">
        <div {...stylex.props(styles.rows)}>
          {place.folder && (
            // The checkout's name, then the folder that holds it, as Claude Desktop shows a folder.
            <Row
              icon="folder"
              label={place.folder.split("/").filter(Boolean).at(-1) ?? place.folder}
              detail={place.folder.split("/").filter(Boolean).at(-2)}
              title={place.folder}
            />
          )}
          {place.branch && <Row icon="gitBranch" label={place.branch} />}
          <Row
            icon={place.agentIcon}
            label={place.model ? `${place.agent} · ${modelName(place.model)}` : place.agent}
            detail={place.runs}
          />
        </div>
      </SidePanelCard>
    </aside>
  );
}

const styles = stylex.create({
  panel: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flexShrink: 0,
    width: 300,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: 12,
    paddingBottom: 16,
    paddingInlineEnd: 12,
    paddingInlineStart: 0,
    fontFamily: tokens.ui,
  },
  card: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingInline: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  // A card without its own body, such as Background before a task runs.
  slot: { display: "contents" },
  cardHead: { display: "flex", alignItems: "center", gap: 6, minHeight: 26 },
  cardTitle: { display: "inline-flex", alignItems: "center", gap: 4 },
  cardTrigger: {
    gap: 4,
    height: 24,
    marginInlineStart: -6,
    paddingInline: 6,
    color: tokens.text,
  },
  cardLabel: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  chevron: {
    display: "inline-flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  chevronFolded: { transform: "rotate(-90deg)" },
  figure: { color: tokens.muted, fontSize: 12, fontVariantNumeric: "tabular-nums" },
  rows: { display: "flex", flexDirection: "column", gap: 2, marginInline: -6 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    minHeight: 26,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    textDecoration: "none",
  },
  link: {
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  current: { backgroundColor: { default: tokens.fill, ":hover": tokens.fill }, fontWeight: 500 },
  rowIcon: { display: "inline-flex", flexShrink: 0, color: tokens.faint },
  rowLabel: { flexShrink: 1 },
  rowDetail: {
    marginInlineStart: "auto",
    flexShrink: 0,
    maxWidth: "50%",
    color: tokens.faint,
    fontSize: 12,
  },
  details: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
});
