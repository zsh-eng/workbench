import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PullInbox, PullInboxRow, PullInboxWant } from "../../shared/pull-inbox";
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
// The page opens with the host's last list, then asks for a fresh one; it
// asks again while it shows. Only the refresh button shows a read, after a
// first list. A row opens in a worktree with its review, as a pasted link
// does, or with an agent that reviews it.

/** While the page shows, it asks for a fresh list this often. A read is two
 * GitHub searches for each GitHub host, about a point each of the 5,000 an
 * hour that GitHub's GraphQL API allows. */
const EVERY_MS = 2 * 60_000;
/** A window that shows again asks for a fresh list when its list is this old. */
const AGAIN_MS = 60_000;

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
  want: PullInboxWant,
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
  /** The refresh button's read runs. */
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(0);
  const [now, setNow] = useState(Date.now);
  const list = useRef<HTMLDivElement>(null);
  const running = useRef<{ abort: AbortController; want: PullInboxWant }>(undefined);
  /** When the list on screen was read from GitHub, or failed to be. */
  const checked = useRef(0);
  /** Whether the host answered. One read runs at a time: the button's read
   * replaces another, and a read that the page asks for is dropped while
   * another runs. */
  const read = useCallback(
    async (want: PullInboxWant) => {
      const current = running.current;
      if (current && !current.abort.signal.aborted && (want !== "new" || current.want === "new"))
        return false;
      current?.abort.abort();
      const abort = new AbortController();
      running.current = { abort, want };
      setRefreshing(want === "new");
      try {
        const result = await load(all, want, abort.signal);
        if (abort.signal.aborted) return false;
        checked.current = Date.parse(result.failed?.at ?? result.readAt);
        setNow(Date.now());
        setInbox(result);
        setError("");
        return true;
      } catch (cause) {
        if (abort.signal.aborted) return false;
        setError(cause instanceof Error ? cause.message : "Med could not read GitHub.");
        return false;
      } finally {
        if (running.current?.abort === abort) {
          running.current = undefined;
          setRefreshing(false);
        }
      }
    },
    [all, load],
  );
  // The host's last list at once, then a fresh one when it is a minute old,
  // again every two minutes while the window shows, and when it shows again.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible" && Date.now() - checked.current >= AGAIN_MS)
        void read("fresh");
    };
    // oxlint-disable-next-line react/set-state-in-effect
    void read("kept").then((answered) => answered && again());
    const timer = setInterval(again, EVERY_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      running.current?.abort.abort();
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
  // A read that fails behind a list on screen says so quietly.
  const failure = shown && (error || shown.failed?.reason);
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
            {/* The list's time changes only when GitHub answers; the refresh
                button turns while its own read runs. */}
            <span role="status" {...stylex.props(styles.readAt)}>
              {shown ? `Updated ${relativeTime(Date.parse(shown.readAt), now)}` : ""}
            </span>
            <ToolButton
              label="Refresh pull requests"
              icon="refresh"
              busy={refreshing}
              aria-busy={refreshing}
              onClick={() => void read("new")}
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
                setError("");
              }}
            />
          </div>
          <div
            ref={list}
            role="listbox"
            aria-label="Pull requests"
            aria-busy={!shown && !error}
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
            {error && !shown && (
              <p role="alert" {...stylex.props(styles.notice, styles.bad)}>
                {error}
              </p>
            )}
            {failure && (
              <p role="note" {...stylex.props(styles.failed)}>
                Med could not refresh the list: {failure}
              </p>
            )}
            {shown?.unavailable ? (
              <p {...stylex.props(styles.notice)}>{shown.unavailable}</p>
            ) : shown ? (
              <>
                {/* A GitHub host that gh could not read, while the others listed. */}
                {!!shown.skipped?.length && (
                  <div role="note" {...stylex.props(styles.skipped)}>
                    {shown.skipped.map((entry) => (
                      <p key={entry.host} {...stylex.props(styles.skippedHost)}>
                        Med could not read {entry.host}: {entry.reason}
                      </p>
                    ))}
                  </div>
                )}
                {section("Waiting on you", shown.waiting, 0, "Nothing waits on you.")}
                {section("Yours", shown.yours, shown.waiting.length, "None open.")}
              </>
            ) : (
              !error && <PullSkeleton />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The page's shape while GitHub first answers, when Med has no list yet:
 * its sections, and rows as the real ones lie, with bars where their words
 * go. It fades in after 400 ms, so a brief read shows nothing. */
function PullSkeleton() {
  const sections: [string, [number, number][]][] = [
    [
      "Waiting on you",
      [
        [62, 34],
        [48, 28],
        [70, 38],
      ],
    ],
    [
      "Yours",
      [
        [54, 30],
        [40, 26],
      ],
    ],
  ];
  return (
    // The list says it is busy; its shape is for the eye only.
    <div aria-hidden="true" {...stylex.props(styles.skeleton)}>
      {sections.map(([title, rows]) => (
        <section key={title} {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
          <div {...stylex.props(styles.card)}>
            {rows.map(([line, facts], at) => (
              <div
                key={at}
                {...stylex.props(styles.row, styles.boneRow, at === 0 && styles.firstRow)}
              >
                <span {...stylex.props(styles.bone, styles.boneDot)} />
                <span {...stylex.props(styles.text)}>
                  <span {...stylex.props(styles.bone, styles.boneLine(line))} />
                  <span {...stylex.props(styles.bone, styles.boneFacts(facts))} />
                </span>
                <span {...stylex.props(styles.bone, styles.boneEnd)} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const pulse = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0.45 },
});
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

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
    // Room below the end, so the last section scrolls up out of the bottom third.
    paddingBottom: "max(72px, 33vh)",
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
  skipped: { marginTop: 24, color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  skippedHost: { margin: 0 },
  failed: { margin: 0, marginTop: 24, color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  // Only a read long enough to notice shows the skeleton.
  skeleton: {
    animationName: appear,
    animationDuration: "200ms",
    animationDelay: "400ms",
    animationFillMode: "both",
  },
  // The skeleton's rows: the real rows' box, without the pointer's fill.
  boneRow: {
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  bone: {
    display: "block",
    flexShrink: 0,
    borderRadius: 4,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 8%, transparent)`,
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.1s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  boneDot: { width: 16, height: 16, borderRadius: "50%" },
  boneLine: (width: number) => ({ width: `${width}%`, height: 12, marginBlock: 2 }),
  boneFacts: (width: number) => ({ width: `${width}%`, height: 10, marginBlock: 2 }),
  boneEnd: { width: 64, height: 10 },
});
