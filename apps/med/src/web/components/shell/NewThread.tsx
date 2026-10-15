import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { savedReviewSchema, type SavedReview } from "../../../shared/saved-review";
import { threadSlug, threadTitle, type Thread, type ThreadList } from "../../../shared/threads";
import { createApi } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import type { AgentChoices, AgentOptions } from "../../../shared/owned-session";
import { useAgentOptions, useAgentPresets } from "../../data/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { ShortcutKeys } from "../ShortcutKeys";
import { useMentions } from "../Mentions";
import { createBrowseApi, useBrowseFiles, useVaults } from "../../data/browse";
import { useMentionSources } from "../../data/mentions";
import type { BrowseSource } from "../../../shared/browse";
import { openAttempts } from "../../data/attempts";
import { readHistory } from "../../data/tabs";
import { AttemptRows, AttemptsCount, AttemptsHint, useAttempts } from "../attempts/NewAttempts";
import { AgentRows, ChoiceRow, choiceStyles } from "./ChoiceRows";

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
 * A new thread: the task, the repository, a new worktree or the checkout, and
 * the agent. Starting it creates the branch, the thread, and the agent's first
 * turn in one step; the thread then opens.
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
  // Escape leaves, as it closes other views over the workspaces; a list over
  // the page, such as More…'s, takes its own Escape first. ⌘↵ starts from
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
  return (
    <div ref={page} role="dialog" aria-label="New thread" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <h1 {...stylex.props(styles.heading)}>What should the agent do?</h1>
        <div {...stylex.props(styles.card)}>
          {mentions.field(
            <textarea
              {...mentions.textarea}
              value={prompt}
              disabled={busy}
              rows={5}
              placeholder="Describe the task, and @ to name files, notes, or threads. The agent starts on it at once."
              aria-label="Task"
              role="combobox"
              aria-controls={mentions.textarea["aria-controls"]}
              aria-expanded={mentions.open}
              aria-autocomplete="list"
              onChange={(event) => {
                setPrompt(event.target.value);
                mentions.changed(event.target.selectionStart);
              }}
              onKeyDown={(event) => void mentions.onKeyDown(event)}
              {...stylex.props(styles.input, mentions.over)}
            />,
          )}
          {mentions.menu && <div {...stylex.props(styles.mentions)}>{mentions.menu}</div>}
          <div {...stylex.props(styles.footer)}>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void start()}
              {...stylex.props(ui.button, ui.primary, ui.pressable, styles.start)}
            >
              {busy ? "Starting…" : "Start"}
              <ShortcutKeys value="Mod+Enter" />
            </button>
          </div>
        </div>
        <div {...stylex.props(choiceStyles.sheet)}>
          {ordered.length > 0 && (
            <ChoiceRow
              label="Repository"
              choices={ordered.map((entry) => ({
                value: entry.id,
                text: entry.name,
                title: entry.path,
              }))}
              value={repository?.id}
              onChange={pick}
              more="repositories"
            />
          )}
          <ChoiceRow
            label="Works in"
            name="Where the agent works"
            choices={
              // Each attempt needs a worktree of its own.
              several
                ? [
                    {
                      value: "worktree",
                      text: `New worktrees · ${branches.join(", ")}`,
                      label: <Named text="New worktrees" code={branches.join(", ")} />,
                    },
                  ]
                : [
                    {
                      value: "worktree",
                      text: `New worktree · ${branch}`,
                      label: <Named text="New worktree" code={branch} />,
                    },
                    {
                      value: "checkout",
                      text: repository?.branch ? `Checkout · ${repository.branch}` : "Checkout",
                      label: <Named text="Checkout" code={repository?.branch} />,
                    },
                  ]
            }
            value={several || choice.worktree ? "worktree" : "checkout"}
            onChange={(value) => remember({ worktree: value === "worktree" })}
          />
          <AttemptsCount attempts={attempts} />
          {agents &&
            (several ? (
              <AttemptRows
                attempts={attempts}
                agents={agents}
                first={first}
                onFirst={chooseFirst}
              />
            ) : (
              <AgentRows pick={first} agents={agents} onChoose={chooseFirst} />
            ))}
        </div>
        <p {...stylex.props(styles.hint)} aria-live="polite">
          {error ? (
            <span {...stylex.props(styles.error)}>{error}</span>
          ) : !repositories.length && list ? (
            "Add a repository to start a thread."
          ) : several ? (
            <AttemptsHint count={attempts.count} repository={repository?.name} />
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** "New worktree · show-week-tides": where the agent works, and its branch. */
function Named({ text, code }: { text: string; code?: string }) {
  if (!code) return text;
  return (
    <>
      {text} <span {...stylex.props(choiceStyles.dot)}>·</span>{" "}
      <span {...stylex.props(choiceStyles.code)}>{code}</span>
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
    overflowY: "auto",
    paddingInline: 24,
    backgroundColor: tokens.panel,
  },
  column: {
    width: "min(680px, 100%)",
    paddingTop: "min(22vh, 200px)",
    paddingBottom: 48,
    // The choices lay out by the column's width (ChoiceRows.tsx).
    containerType: "inline-size",
    animationName: { default: enter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  heading: {
    margin: 0,
    marginBottom: 14,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 20,
    fontWeight: 500,
    letterSpacing: "-0.01em",
  },
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
    minHeight: 120,
    resize: "none",
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
    lineHeight: 1.55,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  // Start at the box's bottom right, as the session composer sends.
  footer: { display: "flex", justifyContent: "flex-end", padding: 8, paddingTop: 0 },
  start: { gap: 8, paddingInline: 12 },
  hint: {
    marginTop: 12,
    marginInline: 16,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.6,
    display: { default: "block", ":empty": "none" },
  },
  error: { color: tokens.red },
});
