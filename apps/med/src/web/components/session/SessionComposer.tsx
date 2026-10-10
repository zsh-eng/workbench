import * as stylex from "@stylexjs/stylex";
import { useId, useState, type KeyboardEvent } from "react";
import type { AgentMessage, DraftComment } from "../../../shared/agent-inbox";
import type {
  OwnedAction,
  OwnedCommand,
  OwnedPermission,
  OwnedSetting,
  OwnedState,
} from "../../../shared/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { ChoiceSelect } from "../Controls";
import { Icon } from "../Icon";

export interface ComposerAttachment {
  id: string;
  label: string;
  text: string;
}

/** A session that Med runs: its state and the actions it takes. */
export interface OwnedControls {
  state: OwnedState;
  act(action: OwnedAction): Promise<void>;
}

const SETTING_ORDER: OwnedSetting["category"][] = ["model", "effort", "mode", "other"];
/** Commands shown at most in the `/` menu. */
const MAX_COMMANDS = 8;

/** The commands whose names start with, then contain, the typed text. */
function matchCommands(commands: OwnedCommand[], query: string) {
  const needle = query.toLowerCase();
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(needle));
  const contains = commands.filter(
    (command) => !starts.includes(command) && command.name.toLowerCase().includes(needle),
  );
  return [...starts, ...contains].slice(0, MAX_COMMANDS);
}

const tokenCount = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value);

/** How full the context window is, after the last turn. */
function ContextMeter({ used, total }: { used: number; total: number }) {
  const share = Math.min(1, used / total);
  const percent = Math.round(share * 100);
  const radius = 5.25;
  const length = 2 * Math.PI * radius;
  return (
    <span
      role="img"
      aria-label={`Context ${percent}% full`}
      title={`${tokenCount(used)} of ${tokenCount(total)} tokens in context`}
      {...stylex.props(styles.meter, share >= 0.8 && styles.meterFull)}
    >
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
        <circle cx={7} cy={7} r={radius} {...stylex.props(styles.meterTrack)} />
        <circle
          cx={7}
          cy={7}
          r={radius}
          strokeDasharray={`${share * length} ${length}`}
          transform="rotate(-90 7 7)"
          {...stylex.props(styles.meterValue)}
        />
      </svg>
      {percent}%
    </span>
  );
}

/** A tool call that waits for the user: the agent's question and its answers. */
export function PermissionCard({
  permission,
  onAnswer,
}: {
  permission: OwnedPermission;
  onAnswer(option: string): void;
}) {
  const first = permission.options.find((option) => option.kind === "allow_once");
  return (
    <div role="group" aria-label="Permission request" {...stylex.props(styles.ask)}>
      <div {...stylex.props(styles.askTitle)}>
        <Icon name="alert" size={13} />
        {permission.title}
      </div>
      {permission.detail && <code {...stylex.props(styles.askDetail)}>{permission.detail}</code>}
      <div {...stylex.props(styles.askActions)}>
        {permission.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onAnswer(option.id)}
            {...stylex.props(
              ui.button,
              ui.pressable,
              styles.askButton,
              option === first ? ui.primary : ui.outlined,
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Writes to the agent from the review: the user's text, the comments not yet
 * sent, and other text such as GitHub comments. A Claude session takes the
 * message when it runs `med review wait`; a Codex session reads its queue.
 */
export function SessionComposer({
  agent,
  name,
  waiting,
  drafts,
  attachments,
  onRemoveAttachment,
  onSend,
  owned,
}: {
  /** Med runs this session: pickers, the `/` menu, Stop, and permission requests. */
  owned?: OwnedControls;
  agent: AgentMessage["agent"];
  /** The agent's name, such as Claude or OpenCode. */
  name: string;
  /** The agent waits in `med review wait` now. */
  waiting: boolean;
  drafts: DraftComment[];
  attachments: ComposerAttachment[];
  onRemoveAttachment(id: string): void;
  onSend(message: {
    text: string;
    noteIds: string[];
    attachments: { label: string; text: string }[];
  }): Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuClosed, setMenuClosed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const menuId = useId();
  const chosen = drafts.filter((draft) => !left.has(draft.id));
  const empty = !text.trim() && !chosen.length && !attachments.length;
  const status = owned?.state.status;
  const working = status === "working";
  const stopped = status === "exited";
  const slash = owned && !menuClosed ? /^\/(\S*)$/.exec(text) : null;
  const matches = slash ? matchCommands(owned!.state.commands, slash[1]!) : [];
  const active = Math.min(highlight, Math.max(0, matches.length - 1));
  const act = (action: OwnedAction) =>
    owned
      ?.act(action)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "The agent did not respond."),
      );
  const settings = [...(owned?.state.settings ?? [])].sort(
    (a, b) => SETTING_ORDER.indexOf(a.category) - SETTING_ORDER.indexOf(b.category),
  );
  const complete = (command: OwnedCommand) => {
    setText(`/${command.name} `);
    setHighlight(0);
  };

  const send = async () => {
    if (empty || sending || working || stopped) return;
    setSending(true);
    setError(null);
    try {
      await onSend({
        text: text.trim(),
        noteIds: chosen.map((draft) => draft.id),
        attachments: attachments.map(({ label, text }) => ({ label, text })),
      });
      setText("");
      setLeft(new Set());
      setOpen(false);
      for (const attachment of attachments) onRemoveAttachment(attachment.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message was not sent.");
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (move) {
        event.preventDefault();
        setHighlight((active + move + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
        event.preventDefault();
        complete(matches[active]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuClosed(true);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && working) {
      // As in Claude Code, Escape stops the turn.
      event.preventDefault();
      event.stopPropagation();
      void act({ action: "interrupt" });
    }
  };
  const ownedStatus = error
    ? error
    : status === "starting"
      ? `Starting ${name}…`
      : stopped
        ? `${name} stopped. Start a new session to continue.`
        : owned?.state.error;

  return (
    <>
      {owned?.state.permission && (
        <PermissionCard
          key={owned.state.permission.id}
          permission={owned.state.permission}
          onAnswer={(option) =>
            void act({ action: "permission", id: owned.state.permission!.id, option })
          }
        />
      )}
      <form
        aria-label={`Message ${name}`}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        {...stylex.props(styles.box)}
      >
        {(drafts.length > 0 || attachments.length > 0) && (
          <div {...stylex.props(styles.chips)}>
            {drafts.length > 0 && (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                {...stylex.props(styles.chip, chosen.length > 0 && styles.chipOn)}
              >
                <Icon name="note" size={12} />
                {chosen.length === drafts.length
                  ? `${drafts.length} ${drafts.length === 1 ? "comment" : "comments"}`
                  : `${chosen.length} of ${drafts.length} comments`}
              </button>
            )}
            {attachments.map((attachment) => (
              <span key={attachment.id} {...stylex.props(styles.chip, styles.chipOn)}>
                <Icon name="github" size={12} />
                <span {...stylex.props(styles.chipLabel)}>{attachment.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.label}`}
                  onClick={() => onRemoveAttachment(attachment.id)}
                  {...stylex.props(styles.chipRemove)}
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {open && drafts.length > 0 && (
          <ul aria-label="Comments to send" {...stylex.props(styles.drafts)}>
            {drafts.map((draft) => {
              const on = !left.has(draft.id);
              const lines =
                draft.endLine && draft.endLine !== draft.line
                  ? `${draft.line}–${draft.endLine}`
                  : `${draft.line}`;
              return (
                <li key={draft.id}>
                  <label {...stylex.props(styles.draft)}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = new Set(left);
                        if (on) next.add(draft.id);
                        else next.delete(draft.id);
                        setLeft(next);
                      }}
                      {...stylex.props(styles.check)}
                    />
                    <span {...stylex.props(styles.draftPath)}>
                      {draft.path.split("/").at(-1)}:{lines}
                    </span>
                    <span {...stylex.props(styles.draftText)}>{draft.text}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > 0 && (
          <div id={menuId} role="listbox" aria-label="Commands" {...stylex.props(styles.commands)}>
            {matches.map((command, index) => (
              <button
                type="button"
                key={command.name}
                id={`${menuId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => complete(command)}
                {...stylex.props(styles.command, index === active && styles.commandActive)}
              >
                <span {...stylex.props(styles.commandName)}>
                  /{command.name}
                  {command.hint && (
                    <span {...stylex.props(styles.commandHint)}> {command.hint}</span>
                  )}
                </span>
                <span {...stylex.props(styles.commandText)}>{command.description}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          aria-label={`Message ${name}`}
          placeholder={
            owned?.state.commands.length
              ? `Message ${name}, or / for commands…`
              : `Message ${name}…`
          }
          value={text}
          rows={2}
          role={owned ? "combobox" : undefined}
          aria-expanded={owned ? matches.length > 0 : undefined}
          aria-controls={matches.length ? menuId : undefined}
          aria-activedescendant={matches.length ? `${menuId}-${active}` : undefined}
          aria-autocomplete={owned ? "list" : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setHighlight(0);
            if (!event.target.value.startsWith("/")) setMenuClosed(false);
          }}
          onKeyDown={onKeyDown}
          {...stylex.props(styles.input)}
        />
        {owned && ownedStatus && (
          <span
            role="status"
            {...stylex.props(
              styles.status,
              styles.ownedStatus,
              (!!error || !!owned.state.error) && styles.error,
            )}
          >
            {ownedStatus}
          </span>
        )}
        <div {...stylex.props(styles.footer)}>
          {owned ? (
            <div {...stylex.props(styles.pickers)}>
              {settings.map((setting) => (
                <ChoiceSelect
                  key={setting.id}
                  label={setting.name}
                  value={setting.value}
                  choices={setting.options.map((option) => ({
                    value: option.value,
                    label: option.name,
                    ...(option.description ? { description: option.description } : {}),
                  }))}
                  disabled={stopped || (setting.idleOnly && working)}
                  onChange={(value) => void act({ action: "setting", id: setting.id, value })}
                  trigger={styles.picker}
                />
              ))}
            </div>
          ) : (
            <span role="status" {...stylex.props(styles.status, error !== null && styles.error)}>
              {error ? (
                error
              ) : agent === "codex" ? (
                "Codex reads this at its next turn"
              ) : waiting ? (
                <>
                  <span {...stylex.props(styles.live)} />
                  {name} is waiting for your review
                </>
              ) : (
                <>
                  {name} gets this when it runs{" "}
                  <code {...stylex.props(styles.code)}>med review wait</code>
                </>
              )}
            </span>
          )}
          {owned?.state.context && (
            <ContextMeter used={owned.state.context.used} total={owned.state.context.total} />
          )}
          {working ? (
            <button
              type="button"
              aria-label="Stop"
              title="Stop (Esc)"
              onClick={() => void act({ action: "interrupt" })}
              {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.send)}
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              title="Send (⌘↩)"
              disabled={empty || sending || stopped}
              {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.send)}
            >
              <Icon name="arrowUp" size={14} />
            </button>
          )}
        </div>
      </form>
    </>
  );
}

const styles = stylex.create({
  box: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginInline: 12,
    marginBottom: 12,
    paddingTop: 8,
    paddingBottom: 6,
    paddingInline: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":focus-within": `inset 0 0 0 1px ${tokens.accentLine}`,
    },
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 4 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    height: 22,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
  },
  chipOn: { backgroundColor: tokens.accentSoft, color: tokens.accent },
  chipLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chipRemove: {
    display: "inline-flex",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    opacity: { default: 0.7, ":hover": 1 },
  },
  drafts: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: 160,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  draft: {
    display: "flex",
    alignItems: "baseline",
    gap: 7,
    paddingBlock: 3,
    color: tokens.muted,
    fontSize: 12,
    cursor: "pointer",
  },
  check: { margin: 0, accentColor: tokens.accent, transform: "translateY(1px)" },
  draftPath: { flexShrink: 0, color: tokens.text, fontFamily: tokens.code, fontSize: 11 },
  draftText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 40,
    maxHeight: 200,
    padding: 0,
    borderWidth: 0,
    resize: "none",
    fieldSizing: "content",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: "var(--med-font-prose)",
    fontSize: 13.5,
    lineHeight: 1.55,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  footer: { display: "flex", alignItems: "center", gap: 8 },
  pickers: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 2,
    marginInlineStart: -6,
    overflow: "hidden",
  },
  picker: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 160,
    minHeight: 24,
    paddingInlineStart: 6,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 400,
  },
  ownedStatus: { flex: "none", whiteSpace: "normal" },
  meter: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  meterFull: { color: tokens.accent },
  meterTrack: { fill: "none", stroke: tokens.line, strokeWidth: 1.75 },
  meterValue: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
  commands: {
    listStyle: "none",
    margin: 0,
    marginInline: -6,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  command: {
    display: "flex",
    width: "100%",
    borderWidth: 0,
    backgroundColor: "transparent",
    fontFamily: tokens.ui,
    textAlign: "start",
    alignItems: "baseline",
    gap: 8,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: `calc(6px * ${tokens.round})`,
    color: tokens.muted,
    fontSize: 12,
    cursor: "pointer",
  },
  commandActive: { backgroundColor: tokens.fill, color: tokens.text },
  commandName: { flexShrink: 0, color: tokens.text, fontFamily: tokens.code, fontSize: 11.5 },
  commandHint: { color: tokens.faint },
  commandText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ask: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginInline: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `inset 0 0 0 1px ${tokens.accentLine}`,
  },
  askTitle: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  askDetail: {
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11.5,
    lineHeight: 1.5,
    wordBreak: "break-all",
  },
  askActions: { display: "flex", flexWrap: "wrap", gap: 6 },
  askButton: { minHeight: 26, fontSize: 12 },
  status: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    color: tokens.faint,
    fontSize: 11.5,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  error: { color: tokens.red, whiteSpace: "normal" },
  live: { width: 6, height: 6, flexShrink: 0, borderRadius: "50%", backgroundColor: tokens.green },
  code: { fontFamily: tokens.code, fontSize: 10.5 },
  send: {
    width: 26,
    minWidth: 26,
    minHeight: 26,
    borderRadius: 999,
    color: { default: tokens.primaryText, ":hover:not(:disabled)": tokens.primaryText },
    backgroundColor: {
      default: tokens.primary,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.primary} 86%, ${tokens.canvas})`,
    },
  },
});
