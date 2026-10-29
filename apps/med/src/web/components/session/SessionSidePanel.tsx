import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import type { ReactNode, Ref } from "react";
import type { ThreadUsage } from "../../../shared/model-usage";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ContextBlock, dollars, modelName, SpendBlock, type ShownContext } from "./ThreadUsage";

// The session's side panel in a wide pane, as Claude Desktop has one: quiet
// cards for the context, the spend, the background tasks, the thread's
// reviews, and where the agent works. docs/SESSIONS.md#side-panel.

/** The narrowest pane that shows the panel: the thread's 540 pixel column,
 * 30 pixels at each of its sides, and the panel's 300. The column never
 * gets narrower for the panel. */
export const SIDE_PANEL_MIN_PANE = 900;

/** A row of the Reviews card: a part of the thread's review, or its pull request. */
export interface ThreadLink {
  id: string;
  icon: IconName;
  label: string;
  detail?: string;
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

function Card({
  label,
  figure,
  children,
  details,
}: {
  label: string;
  figure?: string;
  children?: ReactNode;
  /** Opens a popover with these from the card's title. */
  details?: ReactNode;
}) {
  const title = (
    <>
      <span {...stylex.props(styles.cardLabel)}>{label}</span>
      {details && (
        <span {...stylex.props(styles.chevron)}>
          <Icon name="chevron" size={11} />
        </span>
      )}
    </>
  );
  return (
    <section aria-label={label} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        {details ? (
          <Popover.Root>
            <Popover.Trigger
              aria-label={`${label} details`}
              {...stylex.props(ui.button, styles.cardTrigger)}
            >
              {title}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                side="left"
                align="start"
                sideOffset={10}
                {...stylex.props(styles.positioner)}
              >
                <Popover.Popup {...stylex.props(ui.popup, styles.popup)}>{details}</Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <span {...stylex.props(styles.cardTitle)}>{title}</span>
        )}
        <span {...stylex.props(ui.grow)} />
        {figure && <span {...stylex.props(styles.figure)}>{figure}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  icon,
  label,
  detail,
  onOpen,
  href,
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
      <button type="button" onClick={onOpen} {...stylex.props(styles.row, styles.link)}>
        {body}
      </button>
    );
  return <div {...stylex.props(styles.row)}>{body}</div>;
}

export function SessionSidePanel({
  usage,
  context,
  links,
  place,
  backgroundRef,
}: {
  usage: ThreadUsage | null;
  context: ShownContext | undefined;
  links?: ThreadLink[];
  place: SessionEnvironment;
  /** Where the thread puts its Background dock. */
  backgroundRef: Ref<HTMLDivElement>;
}) {
  const percent =
    context && context.window ? `${Math.round((context.used / context.window) * 100)}%` : undefined;
  return (
    <aside aria-label="Session details" {...stylex.props(styles.panel)}>
      {context && (
        <Card label="Context" figure={percent}>
          <ContextBlock context={context} />
        </Card>
      )}
      {usage && (
        <Card
          label="Spend"
          figure={dollars(usage.spend.total)}
          details={
            <div {...stylex.props(styles.details)}>
              <h3 {...stylex.props(ui.label, styles.detailsHeading)}>Spend in this thread</h3>
              <SpendBlock usage={usage} />
            </div>
          }
        >
          <SpendBlock usage={usage} table={false} />
        </Card>
      )}
      <div ref={backgroundRef} {...stylex.props(styles.slot)} />
      {links && links.length > 0 && (
        <Card label="Reviews">
          <div {...stylex.props(styles.rows)}>
            {links.map(({ id, ...link }) => (
              <Row key={id} {...link} />
            ))}
          </div>
        </Card>
      )}
      <Card label="Environment">
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
      </Card>
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
    scrollbarWidth: "thin",
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
  chevron: { display: "inline-flex", color: tokens.faint, transform: "rotate(-90deg)" },
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
  rowIcon: { display: "inline-flex", flexShrink: 0, color: tokens.faint },
  rowLabel: { flexShrink: 1 },
  rowDetail: {
    marginInlineStart: "auto",
    flexShrink: 0,
    maxWidth: "50%",
    color: tokens.faint,
    fontSize: 12,
  },
  positioner: { zIndex: 100, outline: "none" },
  popup: { width: 420, maxWidth: "calc(100vw - 24px)", maxHeight: "min(560px, 80vh)" },
  details: { paddingInline: 10, paddingBlock: 8 },
  detailsHeading: { margin: 0, marginBottom: 8 },
});
