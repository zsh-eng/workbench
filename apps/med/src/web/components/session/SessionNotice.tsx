import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";

// What a session says when its work stopped, and what the reader can do: the
// durable sessions design. Each stop has a cause and one clear action; none
// is silent. The Elements page's Agent states draw every one.

export interface NoticeAction {
  label: string;
  /** The action that the notice is for; one per notice. */
  primary?: boolean;
  run(): void;
}

/** A command in mono with a Copy button, such as the one that logs in. */
function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span {...stylex.props(styles.command)}>
      <code {...stylex.props(styles.commandText)}>{command}</code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(command).then(
            () => setCopied(true),
            () => {},
          )
        }
        {...stylex.props(styles.copy)}
      >
        <Icon name={copied ? "check" : "copy"} size={12} />
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function Actions({ actions }: { actions?: readonly NoticeAction[] }) {
  if (!actions?.length) return null;
  return (
    <div {...stylex.props(styles.actions)}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.run}
          {...stylex.props(
            ui.button,
            ui.pressable,
            styles.button,
            action.primary ? ui.primary : ui.outlined,
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Above the composer, while the session cannot take a message as it is: the
 * agent stopped, needs a login, keeps stopping, or cannot resume. A message
 * typed meanwhile stays in the composer.
 */
export function SessionNotice({
  tone,
  icon = "alert",
  title,
  children,
  lines,
  command,
  actions,
}: {
  /** `stopped`: the agent is not running. `attention`: work waits on the
   * reader. `quiet`: a fact, such as a session that is read-only. */
  tone: "stopped" | "attention" | "quiet";
  icon?: IconName;
  title: string;
  children?: ReactNode;
  /** The agent's own last lines, such as its error, in mono. */
  lines?: string;
  command?: string;
  actions?: readonly NoticeAction[];
}) {
  return (
    <div role={tone === "quiet" ? "status" : "alert"} {...stylex.props(styles.notice, tones[tone])}>
      <div {...stylex.props(styles.title)}>
        <span {...stylex.props(styles.icon, iconTones[tone])}>
          <Icon name={icon} size={13} />
        </span>
        {title}
      </div>
      {children && <p {...stylex.props(styles.body)}>{children}</p>}
      {lines && <pre {...stylex.props(styles.lines)}>{lines}</pre>}
      {command && <Command command={command} />}
      <Actions actions={actions} />
    </div>
  );
}

/**
 * In the thread, where a turn stopped before its end: a restart or a forced
 * stop cut it. Continue asks the agent to go on; Med never does it alone,
 * because the turn may have stopped in the middle of a migration or a push.
 */
export function TurnMark({
  title,
  at,
  children,
  actions,
}: {
  title: string;
  /** When the turn stopped, as the thread shows times. */
  at?: string;
  children?: ReactNode;
  actions?: readonly NoticeAction[];
}) {
  return (
    <div role="status" {...stylex.props(styles.mark)}>
      <div {...stylex.props(styles.markRule)} aria-hidden="true">
        <span {...stylex.props(styles.markLine)} />
        <span {...stylex.props(styles.markIcon)}>
          <Icon name="pause" size={11} />
        </span>
        <span {...stylex.props(styles.markLine)} />
      </div>
      <div {...stylex.props(styles.markText)}>
        <span {...stylex.props(styles.markTitle)}>{title}</span>
        {at && <span {...stylex.props(styles.markAt)}>{at}</span>}
      </div>
      {children && <p {...stylex.props(styles.markBody)}>{children}</p>}
      <Actions actions={actions} />
    </div>
  );
}

const CONNECTION = {
  reconnecting: { text: "Reconnecting to Med.", rest: "Agents keep working." },
  restarting: { text: "Med is restarting.", rest: "Agents keep working." },
  offline: { text: "Med is not running.", rest: "Agents keep running; start Med to see them." },
} as const;

/**
 * A line at the top of a pane while the page has no host. It shows only
 * after a short wait, so a quick restart passes without a word; agents keep
 * working throughout, because the host does not own them.
 */
export function ConnectionNote({
  state,
  command,
}: {
  state: keyof typeof CONNECTION;
  /** What starts Med, for `offline`. */
  command?: string;
}) {
  const { text, rest } = CONNECTION[state];
  return (
    <div role="status" {...stylex.props(styles.connection, state === "offline" && styles.offline)}>
      <span
        aria-hidden="true"
        {...stylex.props(styles.connectionDot, state !== "offline" && styles.connectionDotLive)}
      />
      <span {...stylex.props(styles.connectionText)}>
        <span {...stylex.props(styles.connectionStrong)}>{text}</span> {rest}
      </span>
      {command && <Command command={command} />}
    </div>
  );
}

const breathe = stylex.keyframes({
  "0%, 100%": { opacity: 0.35 },
  "50%": { opacity: 1 },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const tones = stylex.create({
  stopped: { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.red} 45%, transparent)` },
  attention: {
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.warning} 55%, transparent)`,
  },
  quiet: { boxShadow: `inset 0 0 0 1px ${tokens.line}` },
});
const iconTones = stylex.create({
  stopped: { color: tokens.red },
  attention: { color: tokens.warning },
  quiet: { color: tokens.faint },
});

const styles = stylex.create({
  // The permission card's shape, so the two read as one family.
  notice: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginInline: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  icon: { display: "inline-flex", flexShrink: 0 },
  body: { margin: 0, color: tokens.muted, fontSize: 12, lineHeight: 1.5 },
  lines: {
    margin: 0,
    maxHeight: "calc(4 * 1.5em + 12px)",
    overflow: "auto",
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  command: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    paddingBlock: 3,
    paddingInlineStart: 8,
    paddingInlineEnd: 3,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  commandText: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  copy: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 22,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 6 },
  button: { minHeight: 26, fontSize: 12 },

  mark: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBlock: 4,
  },
  markRule: { display: "flex", alignItems: "center", gap: 8 },
  markLine: {
    flex: "1",
    height: 0,
    borderTopWidth: 1,
    borderTopStyle: "dashed",
    borderTopColor: `color-mix(in srgb, ${tokens.warning} 60%, transparent)`,
  },
  markIcon: {
    display: "grid",
    placeItems: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    color: tokens.warning,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.warning} 60%, transparent)`,
  },
  markText: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  markTitle: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  markAt: { color: tokens.faint, fontSize: 11, fontVariantNumeric: "tabular-nums" },
  markBody: {
    margin: 0,
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "center",
    textWrap: "balance",
  },

  connection: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    minHeight: 30,
    paddingBlock: 5,
    paddingInline: 12,
    backgroundColor: tokens.raised,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
    color: tokens.muted,
    fontSize: 12,
  },
  offline: { color: tokens.text },
  connectionDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: tokens.faint,
  },
  connectionDotLive: {
    backgroundColor: tokens.warning,
    animationName: { default: breathe, [reduced]: "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
  },
  connectionText: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
  connectionStrong: { color: tokens.text, fontWeight: 500 },
});
