import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PullInbox, PullInboxRow } from "../../shared/pull-inbox";
import { useDocumentTitle } from "../data/document-title";
import { relativeTime } from "../data/relative-time";
import { picked, tokens, ui } from "../theme.stylex";
import { ChoiceSelect } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { settingStyles } from "./settings/SettingsParts";
import { tooltip, ToolButton } from "./ToolButton";

// Every open pull request that involves you: what waits on you, then your
// own. A page, laid out as Settings is: the title, the sections' headings and
// the rows' text share one left edge, and the cards reach 20 pixels past it.
// Med reads GitHub when the page opens, when the window comes back into
// focus, and every five minutes while it shows; nothing runs in the
// background. A row opens in a worktree with its review, as a pasted link
// does, or with an agent that reviews it.

/** While the page shows, it reads GitHub again this often. */
const EVERY_MS = 5 * 60_000;
/** A focus reads again only when the last read is this old. */
const FOCUS_MS = 30_000;

/** The page's address. */
export const PULLS_PATH = "/pulls";
/** Asks the workspaces to open a pull request: `{ url, agent? }`. */
export const OPEN_PULL_EVENT = "med:open-pull";
export interface OpenPull {
  url: string;
  agent?: string;
}

/** Opens the page. */
export function openPullRequests() {
  if (location.pathname !== PULLS_PATH) history.pushState(null, "", PULLS_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export type PullInboxLoader = (
  all: boolean,
  refresh: boolean,
  signal: AbortSignal,
) => Promise<PullInbox>;

type Tone = "good" | "bad" | "ask" | "wait";

/** What the reviewers say, as the row's icon. */
function stateOf(row: PullInboxRow): { icon: IconName; label: string; tone?: Tone } {
  if (row.draft) return { icon: "draft", label: "Draft" };
  if (row.review === "approved") return { icon: "approved", label: "Approved", tone: "good" };
  if (row.review === "changes-requested")
    return { icon: "pullRequest", label: "Changes requested", tone: "bad" };
  if (row.review === "required") return { icon: "inReview", label: "In review" };
  return { icon: "pullRequest", label: "Open" };
}

/** Checks and conflicts, as icons at the row's right. */
function signsOf(row: PullInboxRow) {
  const signs: { icon: IconName; label: string; tone: Tone }[] = [];
  if (row.conflicts)
    signs.push({ icon: "conflict", label: "Conflicts with its base", tone: "bad" });
  if (row.checks === "pass")
    signs.push({ icon: "checkCircle", label: "Checks pass", tone: "good" });
  else if (row.checks === "fail")
    signs.push({ icon: "ciFailed", label: "Checks failing", tone: "bad" });
  else if (row.checks === "pending")
    signs.push({ icon: "inProgress", label: "Checks running", tone: "wait" });
  return signs;
}

const toneStyle = (tone: Tone | undefined) =>
  tone === "good"
    ? styles.good
    : tone === "bad"
      ? styles.bad
      : tone === "ask"
        ? styles.ask
        : tone === "wait"
          ? styles.wait
          : null;

export function PullRequestsPage({
  load,
  onOpenPull,
  agents = [],
}: {
  load: PullInboxLoader;
  /** Opens the pull request in a worktree with its review, and starts
   * `agent` there to review it when set. */
  onOpenPull(url: string, agent?: string): void;
  /** Installed agents that can review a pull request in its worktree. */
  agents?: { id: string; name: string }[];
}) {
  useDocumentTitle("Pull requests", 3);
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
  }, [read]);
  useEffect(() => list.current?.focus({ preventScroll: true }), []);
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
    if (how === "github") window.open(row.url, "_blank", "noopener");
    else onOpenPull(row.url, how === "review" ? agent?.id : undefined);
  };
  const repositories = shown?.scope === "registered" ? shown.repositories.length : 0;
  const section = (title: string, entries: PullInboxRow[], offset: number, empty: string) => (
    <section role="group" aria-label={title} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(styles.sectionTitle)}>
        {title}
        <span {...stylex.props(styles.count)}>{entries.length}</span>
      </h2>
      <div {...stylex.props(styles.card)}>
        {entries.map((row, at) => {
          const index = offset + at;
          const current = index === selected;
          const state = stateOf(row);
          const updated = Date.parse(row.updatedAt);
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
              {...stylex.props(
                styles.row,
                at === 0 && styles.firstRow,
                current && [styles.selected, picked],
              )}
            >
              <span
                {...tooltip(state.label)}
                {...stylex.props(styles.state, toneStyle(state.tone))}
              >
                <Icon name={state.icon} size={15} />
              </span>
              <span {...stylex.props(styles.text)}>
                <span {...stylex.props(styles.title)}>{row.title}</span>
                <span {...stylex.props(styles.facts)}>
                  {row.why && (
                    <span
                      {...stylex.props(
                        toneStyle(row.why.startsWith("review") ? "ask" : "bad"),
                        styles.why,
                      )}
                    >
                      {row.why}
                    </span>
                  )}
                  <span {...stylex.props(styles.fact)}>
                    {row.repository} #{row.number}
                    {row.stack?.map((layer) => ` → #${layer.number}`).join("")}
                  </span>
                  {row.author !== shown?.viewer && (
                    <span {...stylex.props(styles.fact)}>{row.author}</span>
                  )}
                  {Number.isFinite(updated) && (
                    <span {...stylex.props(styles.fact)}>{relativeTime(updated, now)}</span>
                  )}
                </span>
              </span>
              <span {...stylex.props(styles.end)}>
                <span {...stylex.props(styles.actions, !current && styles.quiet)}>
                  {agent && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Review with ${agentName}`}
                      {...tooltip(`Review with ${agentName}`, "⌘↵")}
                      onClick={(event) => {
                        event.stopPropagation();
                        act(row, "review");
                      }}
                      {...stylex.props(ui.button, ui.iconButton)}
                    >
                      <Icon name={agent.id === "codex" ? "codex" : "claude"} size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="On GitHub"
                    {...tooltip("On GitHub", "⌥↵")}
                    onClick={(event) => {
                      event.stopPropagation();
                      act(row, "github");
                    }}
                    {...stylex.props(ui.button, ui.iconButton)}
                  >
                    <Icon name="github" size={14} />
                  </button>
                </span>
                {signsOf(row).map((sign) => (
                  <span
                    key={sign.icon}
                    aria-label={sign.label}
                    {...tooltip(sign.label)}
                    {...stylex.props(styles.sign, toneStyle(sign.tone))}
                  >
                    <Icon name={sign.icon} size={14} />
                  </span>
                ))}
                <span {...stylex.props(styles.size)}>
                  <span {...stylex.props(styles.good)}>+{row.additions}</span>
                  <span {...stylex.props(styles.bad)}>−{row.deletions}</span>
                </span>
              </span>
            </div>
          );
        })}
        {!entries.length && <p {...stylex.props(styles.empty)}>{empty}</p>}
      </div>
    </section>
  );
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.scroller)}>
        <div {...stylex.props(styles.column)}>
          <div {...stylex.props(styles.heading)}>
            <h1 {...stylex.props(styles.pageTitle)}>Pull requests</h1>
            <span role="status" {...stylex.props(styles.readAt)}>
              {reading ? "Reading…" : shown ? relativeTime(Date.parse(shown.readAt), now) : ""}
            </span>
            <ToolButton
              label="Read GitHub again"
              icon="refresh"
              busy={reading}
              disabled={reading}
              onClick={() => read(true)}
            />
            <ChoiceSelect
              trigger={settingStyles.select}
              label="Where to look"
              value={all ? "all" : "registered"}
              choices={[
                {
                  value: "registered",
                  label: repositories
                    ? `Your ${repositories} ${repositories === 1 ? "repository" : "repositories"}`
                    : "Your repositories",
                },
                { value: "all", label: "All of GitHub" },
              ]}
              onChange={(value) => {
                setAll(value === "all");
                setActive(0);
              }}
            />
          </div>
          <div
            ref={list}
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
            {...stylex.props(styles.list)}
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
                {section("Yours", shown.yours, shown.waiting.length, "None open.")}
              </>
            ) : (
              !error && <p {...stylex.props(styles.notice)}>Reading GitHub…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = stylex.create({
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  scroller: { flex: "1", minWidth: 0, overflowY: "auto" },
  // Settings' column, a little wider for a row's facts.
  column: {
    boxSizing: "content-box",
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: 44,
    paddingTop: 56,
    paddingBottom: 72,
  },
  heading: { display: "flex", alignItems: "center", gap: 8, minHeight: 32 },
  pageTitle: {
    flex: "1",
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  readAt: { color: tokens.faint, fontSize: 12.5, fontVariantNumeric: "tabular-nums" },
  list: { outline: "none" },
  section: { marginTop: 44 },
  sectionTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    marginBottom: 14,
    fontSize: 17,
    fontWeight: 550,
    letterSpacing: "-0.012em",
  },
  count: { color: tokens.faint, fontSize: 14, fontWeight: 400 },
  // Settings' card: 20 pixels past the column on each side.
  card: {
    marginInline: -20,
    overflow: "hidden",
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
  },
  // The rule between rows keeps to the text's edges, as in Settings.
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxSizing: "border-box",
    minHeight: 64,
    paddingBlock: 12,
    paddingInline: 20,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 20,
      right: 20,
      height: 1,
      backgroundColor: tokens.line,
    },
  },
  firstRow: { "::before": { content: "none" } },
  selected: { backgroundColor: { default: tokens.pick, ":hover": tokens.pick } },
  state: { display: "inline-flex", flexShrink: 0, color: tokens.muted },
  text: { display: "flex", flexDirection: "column", gap: 3, flex: "1", minWidth: 0 },
  title: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  facts: {
    display: "flex",
    columnGap: 12,
    overflow: "hidden",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 13,
  },
  fact: { flexShrink: 0 },
  why: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1 },
  end: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  actions: { display: "flex", alignItems: "center", gap: 2 },
  quiet: { visibility: "hidden" },
  sign: { display: "inline-flex" },
  size: {
    display: "flex",
    gap: 6,
    minWidth: 76,
    justifyContent: "flex-end",
    fontFamily: tokens.code,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  good: { color: tokens.green },
  ask: { color: tokens.accent },
  bad: { color: tokens.red },
  wait: { color: tokens.warning },
  empty: { margin: 0, paddingBlock: 22, paddingInline: 20, color: tokens.muted },
  notice: { margin: 0, marginTop: 44, color: tokens.muted, fontSize: 14 },
});
