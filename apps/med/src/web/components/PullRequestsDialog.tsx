import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PullInbox, PullInboxRow } from "../../shared/pull-inbox";
import { relativeTime } from "../data/relative-time";
import { picked, tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";
import { ToolButton } from "./ToolButton";

// Every open pull request that involves you: what waits on you, then your
// own. Med reads GitHub when this opens, when the window comes back into
// focus, and every five minutes while it shows; nothing runs in the
// background. A row opens in a worktree with its review, as a pasted link
// does, or with an agent that reviews it.

/** While the sheet shows, it reads GitHub again this often. */
const EVERY_MS = 5 * 60_000;
/** A focus reads again only when the last read is this old. */
const FOCUS_MS = 30_000;

export type PullInboxLoader = (
  all: boolean,
  refresh: boolean,
  signal: AbortSignal,
) => Promise<PullInbox>;

function Facts({ row, now }: { row: PullInboxRow; now: number }) {
  const facts: { text: string; tone?: "good" | "bad" | "ask" }[] = [];
  // A review request asks; the rest of what waits on you went wrong.
  if (row.why) facts.push({ text: row.why, tone: row.why.startsWith("review") ? "ask" : "bad" });
  if (row.draft) facts.push({ text: "draft" });
  else if (row.review === "approved") facts.push({ text: "approved", tone: "good" });
  else if (row.review === "changes-requested" && row.why !== "changes requested")
    facts.push({ text: "changes requested", tone: "bad" });
  else if (row.review === "required") facts.push({ text: "in review" });
  if (row.checks === "pass") facts.push({ text: "checks pass", tone: "good" });
  else if (row.checks === "fail" && row.why !== "checks failing")
    facts.push({ text: "checks failing", tone: "bad" });
  else if (row.checks === "pending") facts.push({ text: "checks running" });
  if (row.conflicts && row.why !== "conflicts with its base")
    facts.push({ text: "conflicts", tone: "bad" });
  const updated = Date.parse(row.updatedAt);
  return (
    <span {...stylex.props(styles.facts)}>
      <span>
        {row.repository} #{row.number}
        {row.stack?.map((layer) => ` → #${layer.number}`).join("")}
      </span>
      {row.stack && <span>stack of {row.stack.length + 1}</span>}
      <span>{row.author}</span>
      {Number.isFinite(updated) && <span>{relativeTime(updated, now)}</span>}
      {facts.map((fact) => (
        <span
          key={fact.text}
          {...stylex.props(
            fact.tone === "good" && styles.good,
            fact.tone === "bad" && styles.bad,
            fact.tone === "ask" && styles.ask,
          )}
        >
          {fact.text}
        </span>
      ))}
    </span>
  );
}

export function PullRequestsDialog({
  open,
  onOpenChange,
  load,
  onOpenPull,
  agents = [],
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  load: PullInboxLoader;
  /** Opens the pull request in a worktree with its review, and starts
   * `agent` there to review it when set. */
  onOpenPull(url: string, agent?: string): void;
  /** Installed agents that can review a pull request in its worktree. */
  agents?: { id: string; name: string }[];
}) {
  const id = useId();
  const [all, setAll] = useState(false);
  const [inbox, setInbox] = useState<PullInbox | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [active, setActive] = useState(0);
  const [now, setNow] = useState(Date.now);
  const list = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController>(undefined);
  const readAt = useRef(0);
  const read = useCallback(
    (refresh: boolean) => {
      request.current?.abort();
      const abort = new AbortController();
      request.current = abort;
      setReading(true);
      load(all, refresh, abort.signal).then(
        (result) => {
          if (abort.signal.aborted) return;
          readAt.current = Date.now();
          setNow(Date.now());
          setInbox(result);
          setError("");
          setReading(false);
        },
        (cause: unknown) => {
          if (abort.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Med could not read GitHub.");
          setReading(false);
        },
      );
    },
    [all, load],
  );
  // On open, on focus, and every five minutes while it shows.
  useEffect(() => {
    if (!open) return;
    // The read's state shows at once; GitHub answers later.
    // oxlint-disable-next-line react/set-state-in-effect
    read(false);
    const timer = setInterval(() => read(true), EVERY_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const focus = () => {
      if (Date.now() - readAt.current > FOCUS_MS) read(true);
    };
    addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      removeEventListener("focus", focus);
      request.current?.abort();
    };
  }, [open, read]);
  const shown = inbox && inbox.scope === (all ? "all" : "registered") ? inbox : null;
  const rows = shown ? [...shown.waiting, ...shown.yours] : [];
  const selected = Math.min(active, Math.max(0, rows.length - 1));
  const agent = agents.find((entry) => entry.id === "claude") ?? agents[0];
  const agentName = agent?.name.replace(/ Code$/, "");
  useEffect(() => {
    list.current
      ?.querySelector(`#${CSS.escape(`${id}-row-${selected}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [id, selected]);
  const act = (row: PullInboxRow | undefined, how: "open" | "review" | "github") => {
    if (!row) return;
    if (how === "github") {
      window.open(row.url, "_blank", "noopener");
      return;
    }
    onOpenChange(false);
    onOpenPull(row.url, how === "review" ? agent?.id : undefined);
  };
  const section = (title: string, entries: PullInboxRow[], offset: number, empty: string) => (
    <div role="group" aria-label={title}>
      <div {...stylex.props(styles.groupTitle)}>
        <span>{title}</span>
        <span {...stylex.props(styles.count)}>{entries.length}</span>
      </div>
      {entries.map((row, at) => {
        const index = offset + at;
        const current = index === selected;
        return (
          <div
            key={row.url}
            id={`${id}-row-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={current}
            aria-label={`${row.title}, ${row.repository} #${row.number}`}
            onClick={(event) => act(row, event.metaKey || event.ctrlKey ? "review" : "open")}
            onKeyDown={(event) => {
              if (event.key === " ") {
                event.preventDefault();
                act(row, "open");
              }
            }}
            onPointerMove={() => setActive(index)}
            {...stylex.props(styles.option, current && [styles.selected, picked])}
          >
            <Icon name="pullRequest" size={14} />
            <span {...stylex.props(styles.entry)}>
              <span {...stylex.props(styles.titleLine)}>
                <span {...stylex.props(styles.rowTitle)}>{row.title}</span>
                <span {...stylex.props(styles.size)}>
                  <span {...stylex.props(styles.good)}>+{row.additions}</span>{" "}
                  <span {...stylex.props(styles.bad)}>−{row.deletions}</span>
                </span>
              </span>
              <Facts row={row} now={now} />
            </span>
            <span {...stylex.props(styles.actions, !current && styles.quiet)}>
              {agent && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    act(row, "review");
                  }}
                  {...stylex.props(ui.button, styles.action)}
                >
                  Review with {agentName}
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-label="On GitHub"
                title="On GitHub"
                onClick={(event) => {
                  event.stopPropagation();
                  act(row, "github");
                }}
                {...stylex.props(ui.button, styles.action)}
              >
                <Icon name="github" size={13} />
              </button>
            </span>
          </div>
        );
      })}
      {!entries.length && <p {...stylex.props(styles.notice)}>{empty}</p>}
    </div>
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      // It opens again at the top.
      onOpenChangeComplete={(shown) => {
        if (!shown) setActive(0);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          initialFocus={() => list.current}
          {...stylex.props(styles.dialog, ui.instant)}
        >
          <div {...stylex.props(styles.heading)}>
            <Dialog.Title {...stylex.props(styles.title)}>Pull requests</Dialog.Title>
            <div role="radiogroup" aria-label="Where to look" {...stylex.props(styles.scope)}>
              {(
                [
                  [
                    false,
                    shown?.scope === "registered" && shown.repositories.length
                      ? `Your ${shown.repositories.length} ${shown.repositories.length === 1 ? "repository" : "repositories"}`
                      : "Your repositories",
                  ],
                  [true, "All of GitHub"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={all === value}
                  onClick={() => {
                    setAll(value);
                    setActive(0);
                  }}
                  {...stylex.props(ui.button, styles.scopeButton, all === value && styles.scopeOn)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span {...stylex.props(ui.grow)} />
            <span role="status" {...stylex.props(styles.readAt)}>
              {reading
                ? "Reading GitHub…"
                : shown
                  ? `Read ${relativeTime(Date.parse(shown.readAt), now)}`
                  : ""}
            </span>
            <ToolButton
              label="Read GitHub again"
              icon="refresh"
              disabled={reading}
              onClick={() => read(true)}
            />
            <Dialog.Close aria-label="Close pull requests" {...stylex.props(ui.button)}>
              <ShortcutKeys value="Esc" />
            </Dialog.Close>
          </div>
          <Dialog.Description {...stylex.props(styles.hidden)}>
            Open pull requests that wait on you, and your own, read from GitHub with your gh
            sign-in.
          </Dialog.Description>
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="Pull requests"
            tabIndex={0}
            aria-activedescendant={rows[selected] ? `${id}-row-${selected}` : undefined}
            onKeyDown={(event) => {
              const down = event.key === "ArrowDown" || event.key === "j";
              const up = event.key === "ArrowUp" || event.key === "k";
              if (down || up) {
                event.preventDefault();
                setActive(Math.max(0, Math.min(rows.length - 1, selected + (down ? 1 : -1))));
              } else if (event.key === "Enter") {
                event.preventDefault();
                act(
                  rows[selected],
                  event.altKey
                    ? "github"
                    : (event.metaKey || event.ctrlKey) && agent
                      ? "review"
                      : "open",
                );
              }
            }}
            {...stylex.props(styles.results)}
          >
            {error && (
              <p role="alert" {...stylex.props(styles.notice, styles.bad)}>
                {error}
              </p>
            )}
            {shown?.unavailable ? (
              <p {...stylex.props(styles.notice)}>{shown.unavailable}</p>
            ) : shown ? (
              <>
                {section("Waiting on you", shown.waiting, 0, "Nothing waits on you.")}
                {section(
                  "Yours",
                  shown.yours,
                  shown.waiting.length,
                  "No other open pull requests of yours.",
                )}
              </>
            ) : (
              !error && <p {...stylex.props(styles.notice)}>Reading GitHub…</p>
            )}
          </div>
          <div {...stylex.props(styles.hints)}>
            <span {...stylex.props(styles.hint)}>
              <ShortcutKeys value="↵" /> Open in a worktree
            </span>
            {agent && (
              <span {...stylex.props(styles.hint)}>
                <ShortcutKeys value="⌘↵" /> Review with {agentName}
              </span>
            )}
            <span {...stylex.props(styles.hint)}>
              <ShortcutKeys value="⌥↵" /> On GitHub
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.scrim, zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "10vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(780px, 94vw)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.raised,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    borderRadius: `calc(12px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
  },
  heading: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 44,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: { fontSize: 12.5, fontWeight: 550, margin: 0 },
  scope: {
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  scopeButton: { minHeight: 22, paddingBlock: 0, paddingInline: 8, fontSize: 11.5 },
  scopeOn: { backgroundColor: tokens.raised, color: tokens.text },
  readAt: { color: tokens.faint, fontSize: 11 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  results: { flex: "1", minHeight: 0, padding: 6, overflowY: "auto", outline: "none" },
  groupTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    paddingInline: 8,
    paddingTop: 10,
    paddingBottom: 4,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  count: { color: tokens.faint, fontWeight: 400 },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingBlock: 6,
    paddingInline: 10,
    boxSizing: "border-box",
    borderRadius: `calc(7px * ${tokens.round})`,
    color: tokens.muted,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  selected: {
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
    color: tokens.selectedText,
  },
  entry: { display: "grid", gap: 3, minWidth: 0, flex: "1" },
  titleLine: { display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 },
  rowTitle: {
    flex: "1",
    minWidth: 0,
    color: tokens.text,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  size: { flexShrink: 0, fontFamily: tokens.code, fontSize: 11 },
  facts: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: 10,
    rowGap: 2,
    color: tokens.faint,
    fontSize: 11.5,
  },
  good: { color: tokens.green },
  ask: { color: tokens.accent },
  bad: { color: tokens.red },
  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  quiet: { visibility: "hidden" },
  action: { minHeight: 24, paddingBlock: 0, paddingInline: 8, fontSize: 11.5 },
  notice: { paddingBlock: 8, paddingInline: 10, color: tokens.muted, margin: 0 },
  hints: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 16,
    minHeight: 34,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11.5,
  },
  hint: { display: "flex", alignItems: "center", gap: 6 },
});
