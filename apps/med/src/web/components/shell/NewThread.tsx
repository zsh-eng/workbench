import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { savedReviewSchema, type SavedReview } from "../../../shared/saved-review";
import { threadSlug, threadTitle, type Thread, type ThreadList } from "../../../shared/threads";
import { createApi } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import type { AgentChoices, AgentOptions } from "../../../shared/owned-session";
import { useAgentOptions, useAgentPresets } from "../../data/owned-session";
import { tokens } from "../../theme.stylex";
import { ActionMenu } from "../Controls";
import { Icon, type IconName } from "../Icon";
import { useMentions } from "../Mentions";
import { createBrowseApi, useBrowseFiles, useVaults } from "../../data/browse";
import { useMentionSources } from "../../data/mentions";
import type { BrowseSource } from "../../../shared/browse";
import { openAttempts } from "../../data/attempts";
import { readHistory } from "../../data/tabs";
import { MAX_ATTEMPTS } from "../../../shared/attempts";
import { AttemptRows, AttemptsHint, useAttempts } from "../attempts/NewAttempts";
import { choiceStyles } from "./ChoiceRows";
import { WhereToWork } from "./WhereToWork";

const CLAUDE = "#d97757";

const PLACE_KEY = "med:new-thread";

interface Choice {
  repositoryId?: string;
  worktree: boolean;
  preset?: string;
  /** The model and effort chosen for each agent. */
  agents?: Record<string, AgentChoices>;
}
function readChoice(): Choice {
  try {
    const value = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "{}") as Partial<Choice>;
    return {
      repositoryId: typeof value.repositoryId === "string" ? value.repositoryId : undefined,
      worktree: value.worktree !== false,
      preset: typeof value.preset === "string" ? value.preset : undefined,
      agents: value.agents && typeof value.agents === "object" ? value.agents : undefined,
    };
  } catch {
    return { worktree: true };
  }
}

type Repository = ThreadList["repositories"][number];

/** The registered repositories of the newest threads, newest first, at most five. */
function recentRepositories(threads: readonly Thread[], repositories: readonly Repository[]) {
  const known = new Map(repositories.map((entry) => [entry.id, entry]));
  const recent = new Map<string, Repository>();
  const newest = threads.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const thread of newest) {
    const entry = thread.repository && known.get(thread.repository.id);
    if (entry) recent.set(entry.id, entry);
    if (recent.size === 5) break;
  }
  return [...recent.values()];
}

/** The recent repositories, then the others in the host's order. */
function repositoryOrder(threads: readonly Thread[], repositories: readonly Repository[]) {
  const recent = recentRepositories(threads, repositories);
  return [...recent, ...repositories.filter((entry) => !recent.includes(entry))];
}

/**
 * The model and effort for a new session: the last choice where the agent
 * still offers it, or Med's default. An effort shows only where the model has
 * efforts.
 */
export function sessionChoices(options: AgentOptions | undefined, last: AgentChoices = {}) {
  const pick = (options: { value: string }[], value: string | undefined, fallback: string) =>
    options.some((option) => option.value === value) ? value! : fallback;
  const model = options?.model && pick(options.model.options, last.model, options.model.value);
  const levels = model ? options?.efforts?.[model] : undefined;
  const efforts =
    options?.effort?.options.filter(
      (option) => !options.efforts || option.value === "default" || levels?.includes(option.value),
    ) ?? [];
  const effort = efforts.some((option) => option.value !== "default")
    ? pick(efforts, last.effort, pick(efforts, options!.effort!.value, efforts[0]!.value))
    : undefined;
  return { model, effort, efforts };
}

/**
 * A new thread, as Claude's new session page: the middle asks where to work;
 * the composer sits at the bottom, with one line of menus under it for the
 * repository, where the agent works, and the agent's model. Enter creates
 * the branch, the thread, and the agent's first turn in one step; the thread
 * then opens.
 */
export function NewThread({
  list,
  fetcher,
  repositoryId: suggested,
  onStarted,
  onCancel,
}: {
  list: ThreadList | null;
  fetcher: typeof fetch;
  /** The repository of the workspace on screen, if any. */
  repositoryId?: string;
  onStarted(review: SavedReview): void;
  onCancel(): void;
}) {
  const [choice, setChoice] = useState(readChoice);
  // The repository chosen here, which wins over the one on screen.
  const [picked, setPicked] = useState<string>();
  const agents = useAgentPresets(true, fetcher)?.filter((agent) => agent.available);
  const repositories = list?.repositories ?? [];
  const repository =
    [picked, suggested, choice.repositoryId, list?.threads[0]?.repository?.id]
      .map((id) => repositories.find((entry) => entry.id === id))
      .find(Boolean) ?? repositories[0];
  // The repositories of the newest threads, tabs and history, come first.
  const [past, setPast] = useState<readonly Thread[] | null>(null);
  useEffect(() => {
    let current = true;
    readHistory(fetcher).then(
      (threads) => current && setPast(threads),
      () => current && setPast([]),
    );
    return () => {
      current = false;
    };
  }, [fetcher]);
  const ordered = useMemo(
    () => (list ? repositoryOrder([...list.threads, ...(past ?? [])], list.repositories) : []),
    [list, past],
  );
  const agent = agents?.find((entry) => entry.id === choice.preset) ?? agents?.[0];
  const options = useAgentOptions(agent?.id, fetcher);
  const { model, effort, efforts } = sessionChoices(options, agent && choice.agents?.[agent.id]);
  // Two or three attempts: each agent does the task in its own worktree.
  const attempts = useAttempts(agents, agent, fetcher);
  const several = attempts.count > 1;
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  // @ names the repository's files, the vaults' notes, and other threads.
  const api = useMemo(() => createBrowseApi(fetcher, readBrowserToken()), [fetcher]);
  const [mentionRound, setMentionRound] = useState(0);
  const wantMentions = useCallback(() => setMentionRound((round) => round + 1), []);
  const root = repository?.path;
  const checkout = useMemo<BrowseSource | null>(
    () => (root ? { kind: "worktree", repo: root } : null),
    [root],
  );
  const listed = useBrowseFiles(checkout, mentionRound > 0, 0, { api });
  const files = useMemo(
    () => (root ? { root, entries: listed.entries } : undefined),
    [root, listed.entries],
  );
  const sorted = useMemo(
    () => [...(list?.threads ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [list],
  );
  const threads = useCallback(() => sorted, [sorted]);
  const vaults = useVaults(api, mentionRound > 0);
  const mentionSources = useMentionSources(api, files, threads, vaults, mentionRound);
  const mentions = useMentions({
    text: prompt,
    setText: setPrompt,
    sources: mentionSources,
    onWanted: wantMentions,
    input: styles.input,
    area: input,
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => input.current?.focus(), []);
  // Escape leaves, as it closes other views over the workspaces; a menu, or
  // the filter while it has text, takes its own Escape first. ⌘↵ starts from
  // anywhere on the page.
  const page = useRef<HTMLDivElement>(null);
  const leave = useRef(onCancel);
  const begin = useRef(() => {});
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        leave.current();
      } else if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey) &&
        (!target || target === document.body || page.current?.contains(target))
      ) {
        event.preventDefault();
        begin.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const remember = (next: Partial<Choice>) => {
    const value = { ...choice, ...next };
    setChoice(value);
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(value));
    } catch {
      /* The choice lasts for this view. */
    }
  };

  const pick = (repositoryId: string) => {
    setPicked(repositoryId);
    remember({ repositoryId });
  };
  // Attempt A, or the thread's only agent.
  const first = { agent, options, model, effort, efforts };
  const chooseFirst = (next: AgentChoices & { preset?: string }) =>
    remember(
      next.preset
        ? { preset: next.preset }
        : { agents: { ...choice.agents, [agent!.id]: { ...choice.agents?.[agent!.id], ...next } } },
    );

  const ready = !!prompt.trim() && !!repository && !!agent && !busy && attempts.ready;
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (several) {
        const started = await attempts.start(
          {
            repositoryId: repository.id,
            prompt: await mentions.expand(prompt),
            title: threadTitle(prompt),
            first,
          },
          fetcher,
        );
        onStarted(started.reviews[0]!);
        openAttempts(started.group, started.problem);
        return;
      }
      const result = await createApi(fetcher, readBrowserToken()).json(
        "/api/threads",
        z.object({ review: savedReviewSchema }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repositoryId: repository.id,
            // The agent gets each mention's absolute path; the title keeps its short name.
            prompt: await mentions.expand(prompt),
            title: threadTitle(prompt),
            preset: agent.id,
            worktree: choice.worktree,
            choices: { model, effort },
          }),
        },
      );
      onStarted(result.review);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Med could not start the thread.");
      setBusy(false);
    }
  };
  useEffect(() => {
    leave.current = onCancel;
    begin.current = () => void start();
  });

  const branch = prompt.trim() ? threadSlug(threadTitle(prompt)) : "a-new-branch";
  const branches = ["a", "b", "c"].slice(0, attempts.count).map((letter) => `${branch}-${letter}`);
  const addFolder = () => {
    onCancel();
    history.pushState(null, "", "/sources");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const modelName = options?.model?.options.find((option) => option.value === model);
  const effortName = efforts.find((option) => option.value === effort);
  return (
    <div ref={page} role="dialog" aria-label="New thread" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.middle)}>
          <WhereToWork
            repositories={ordered}
            chosen={repository?.id}
            onPick={(id) => {
              pick(id);
              input.current?.focus();
            }}
            onAdd={addFolder}
          />
        </div>
        <div {...stylex.props(styles.bottom)}>
          <div {...stylex.props(styles.card)}>
            {mentions.field(
              <textarea
                {...mentions.textarea}
                value={prompt}
                disabled={busy}
                rows={3}
                placeholder="Describe the task, and @ to name files, notes, or threads. Enter starts the agent."
                aria-label="Task"
                role="combobox"
                aria-controls={mentions.textarea["aria-controls"]}
                aria-expanded={mentions.open}
                aria-autocomplete="list"
                onChange={(event) => {
                  setPrompt(event.target.value);
                  mentions.changed(event.target.selectionStart);
                }}
                onKeyDown={(event) => {
                  if (mentions.onKeyDown(event)) return;
                  // Enter starts, ⇧Enter adds a line; ⌘↵ starts from anywhere.
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void start();
                  }
                }}
                {...stylex.props(styles.input, mentions.over)}
              />,
            )}
            {mentions.menu && <div {...stylex.props(styles.mentions)}>{mentions.menu}</div>}
          </div>
          <div {...stylex.props(styles.menus)}>
            {ordered.length > 1 ? (
              <ActionMenu
                label="Repository"
                align="start"
                trigger={styles.menu}
                sections={[
                  ordered.map((entry) => ({
                    label: entry.name,
                    checked: entry.id === repository?.id,
                    choice: true,
                    onClick: () => pick(entry.id),
                  })),
                ]}
              >
                <MenuLabel icon="folder" text={repository?.name ?? "Repository"} />
              </ActionMenu>
            ) : (
              repository && (
                <span {...stylex.props(styles.fact)}>
                  <MenuLabel icon="folder" text={repository.name} />
                </span>
              )
            )}
            <span {...stylex.props(styles.grow)} />
            <ActionMenu
              label="Where the agent works"
              trigger={styles.menu}
              sections={[
                // Each attempt needs a worktree of its own.
                several
                  ? [
                      {
                        label: `New worktrees · ${branches.join(", ")}`,
                        checked: true,
                        choice: true,
                        onClick: () => {},
                      },
                    ]
                  : [
                      {
                        label: `New worktree · ${branch}`,
                        checked: choice.worktree,
                        choice: true,
                        onClick: () => remember({ worktree: true }),
                      },
                      {
                        label: repository?.branch ? `Checkout · ${repository.branch}` : "Checkout",
                        checked: !choice.worktree,
                        choice: true,
                        onClick: () => remember({ worktree: false }),
                      },
                    ],
                Array.from({ length: MAX_ATTEMPTS }, (_, index) => ({
                  label: index ? `${index + 1} attempts` : "1 attempt",
                  checked: attempts.count === index + 1,
                  choice: true,
                  onClick: () => attempts.setCount(index + 1),
                })),
              ]}
            >
              <MenuLabel
                icon="branch"
                text={
                  several
                    ? `${attempts.count} worktrees`
                    : choice.worktree
                      ? "New worktree"
                      : "Checkout"
                }
              />
            </ActionMenu>
            {agent && !several && (
              <ActionMenu
                label="Agent and model"
                trigger={styles.menu}
                sections={[
                  agents && agents.length > 1
                    ? agents.map((entry) => ({
                        label: entry.name,
                        checked: entry.id === agent.id,
                        choice: true,
                        onClick: () => chooseFirst({ preset: entry.id }),
                      }))
                    : [],
                  (options?.model?.options ?? []).map((option) => ({
                    label: optionName(option),
                    checked: option.value === model,
                    choice: true,
                    onClick: () => chooseFirst({ model: option.value }),
                  })),
                  effort
                    ? efforts.map((option) => ({
                        label: optionName(option),
                        checked: option.value === effort,
                        choice: true,
                        onClick: () => chooseFirst({ effort: option.value }),
                      }))
                    : [],
                ]}
              >
                <AgentLabel
                  kind={agent.kind}
                  model={modelName ? optionName(modelName) : agent.name}
                  effort={effortName && optionName(effortName)}
                />
              </ActionMenu>
            )}
          </div>
          {agents && several && (
            <div {...stylex.props(choiceStyles.sheet, styles.attempts)}>
              <AttemptRows
                attempts={attempts}
                agents={agents}
                first={first}
                onFirst={chooseFirst}
              />
            </div>
          )}
          <p {...stylex.props(styles.hint)} aria-live="polite">
            {error ? (
              <span {...stylex.props(styles.error)}>{error}</span>
            ) : busy ? (
              "Starting the agent…"
            ) : several ? (
              <AttemptsHint count={attempts.count} repository={repository?.name} />
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

/** A model's or an effort's name, with Claude Code's "Default (recommended)" as "Default". */
const optionName = (option: { value: string; name: string }) =>
  option.value === "default" ? "Default" : option.name;

/** A menu's trigger: its icon and the choice. */
function MenuLabel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <>
      <Icon name={icon} size={13} style={{ flexShrink: 0, opacity: 0.75 }} />
      <span {...stylex.props(styles.text)}>{text}</span>
    </>
  );
}

/** The agent's mark in its colour, the model, then the effort in a quieter grey. */
function AgentLabel({ kind, model, effort }: { kind: string; model: string; effort?: string }) {
  return (
    <>
      <span {...stylex.props(styles.mark, kind === "claude" && styles.claude)}>
        <Icon name={kind === "claude" || kind === "codex" ? kind : "agent"} size={13} />
      </span>
      <span {...stylex.props(styles.text, styles.model)}>{model}</span>
      {effort && <span {...stylex.props(styles.effort)}>{effort}</span>}
    </>
  );
}

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const styles = stylex.create({
  page: {
    position: "absolute",
    inset: 0,
    zIndex: 30,
    display: "flex",
    justifyContent: "center",
    paddingInline: 24,
    backgroundColor: tokens.panel,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    width: "min(680px, 100%)",
    height: "100%",
    // The attempts' rows lay out by the column's width (ChoiceRows.tsx).
    containerType: "inline-size",
    animationName: { default: enter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  // The page's one question, in its middle.
  middle: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 0,
    paddingBlock: 24,
  },
  // The composer at the bottom, as in a chat.
  bottom: { flexShrink: 0, paddingBottom: 20 },
  card: {
    display: "flex",
    flexDirection: "column",
    borderRadius: 12,
    backgroundColor: tokens.canvas,
    boxShadow: {
      default: `0 0 0 1px ${tokens.line}, 0 8px 24px -12px #00000040`,
      ":focus-within": `0 0 0 1px ${tokens.lineStrong}, 0 8px 24px -12px #00000040`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: "150ms",
  },
  // Level with the task's text.
  mentions: { paddingInline: 16, paddingBottom: 4 },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 88,
    resize: "none",
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
    lineHeight: 1.55,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  // One line of menus under the composer.
  menus: { display: "flex", alignItems: "center", gap: 2, minWidth: 0, marginTop: 6 },
  grow: { flex: "1" },
  menu: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    height: 28,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${tokens.accentLine}` },
  },
  fact: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    height: 28,
    paddingInline: 8,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
  },
  text: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mark: { display: "flex", flexShrink: 0 },
  claude: { color: CLAUDE },
  model: { color: tokens.text },
  effort: { flexShrink: 0, color: tokens.faint },
  attempts: { marginTop: 8 },
  hint: {
    marginTop: 8,
    marginBottom: 0,
    marginInline: 8,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.6,
    display: { default: "block", ":empty": "none" },
  },
  error: { color: tokens.red },
});
