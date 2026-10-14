import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { savedReviewSchema, type SavedReview } from "../../../shared/saved-review";
import { threadSlug, threadTitle, type ThreadList } from "../../../shared/threads";
import { createApi } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import type { AgentChoices, AgentOptions } from "../../../shared/owned-session";
import { useAgentOptions, useAgentPresets } from "../../data/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { useMentions } from "../Mentions";
import { createBrowseApi, useBrowseFiles, useVaults } from "../../data/browse";
import { useMentionSources } from "../../data/mentions";
import type { BrowseSource } from "../../../shared/browse";
import { openAttempts } from "../../data/attempts";
import {
  AttemptRows,
  AttemptsCount,
  AttemptsHint,
  attemptStyles,
  useAttempts,
} from "../attempts/NewAttempts";

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
  // Escape leaves, as it closes other views over the workspaces.
  const leave = useRef(onCancel);
  useEffect(() => {
    leave.current = onCancel;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busyRef.current) return;
      event.preventDefault();
      leave.current();
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

  const ready = !!prompt.trim() && !!repository && !!agent && !busy && attempts.ready;
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (several) {
        const first = { agent, options, model, effort, efforts };
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

  const branch = prompt.trim() ? threadSlug(threadTitle(prompt)) : "a-new-branch";
  return (
    <div role="dialog" aria-label="New thread" {...stylex.props(styles.page)}>
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
              onKeyDown={(event) => {
                if (mentions.onKeyDown(event)) return;
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void start();
                }
              }}
              {...stylex.props(styles.input, mentions.over)}
            />,
          )}
          {mentions.menu && <div {...stylex.props(styles.mentions)}>{mentions.menu}</div>}
          {several && agents && (
            <AttemptRows
              attempts={attempts}
              agents={agents}
              first={{ agent, options, model, effort, efforts }}
              onFirst={(next) =>
                remember(
                  next.preset
                    ? { preset: next.preset }
                    : {
                        agents: {
                          ...choice.agents,
                          [agent!.id]: { ...choice.agents?.[agent!.id], ...next },
                        },
                      },
                )
              }
              branch={branch}
            />
          )}
          <div {...stylex.props(styles.controls)}>
            <Select
              label="Repository"
              icon="gitBranch"
              value={repository?.id ?? ""}
              options={repositories.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(value) => {
                setPicked(value);
                remember({ repositoryId: value });
              }}
            />
            <div
              role="radiogroup"
              aria-label="Where the agent works"
              {...stylex.props(styles.segments)}
            >
              {[
                { value: true, label: "New worktree", icon: "gitWorktree" as const },
                { value: false, label: "Checkout", icon: "folder" as const },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={(choice.worktree || several) === option.value}
                  disabled={several && !option.value}
                  onClick={() => remember({ worktree: option.value })}
                  {...stylex.props(
                    styles.segment,
                    (choice.worktree || several) === option.value && styles.segmentOn,
                    several && !option.value && attemptStyles.off,
                  )}
                >
                  <Icon name={option.icon} size={13} />
                  {option.label}
                </button>
              ))}
            </div>
            <div {...stylex.props(styles.agent)}>
              <AttemptsCount attempts={attempts} />
              {!several && (
                <Select
                  label="Agent"
                  icon={agent?.kind === "claude" ? "claude" : "agent"}
                  value={agent?.id ?? ""}
                  options={(agents ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
                  onChange={(value) => remember({ preset: value })}
                />
              )}
              {!several && options?.model && model && (
                <Select
                  label="Model"
                  value={model}
                  options={options.model.options.map((option) => ({
                    value: option.value,
                    label: option.name,
                  }))}
                  onChange={(value) =>
                    remember({
                      agents: {
                        ...choice.agents,
                        [agent!.id]: { ...choice.agents?.[agent!.id], model: value },
                      },
                    })
                  }
                />
              )}
              {!several && effort && (
                <Select
                  label="Effort"
                  value={effort}
                  options={efforts.map((option) => ({ value: option.value, label: option.name }))}
                  onChange={(value) =>
                    remember({
                      agents: {
                        ...choice.agents,
                        [agent!.id]: { ...choice.agents?.[agent!.id], effort: value },
                      },
                    })
                  }
                />
              )}
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
        </div>
        <p {...stylex.props(styles.hint)} aria-live="polite">
          {error ? (
            <span {...stylex.props(styles.error)}>{error}</span>
          ) : !repositories.length && list ? (
            "Add a repository to start a thread."
          ) : several ? (
            <AttemptsHint count={attempts.count} repository={repository?.name} />
          ) : choice.worktree ? (
            <>
              Med creates the branch <code {...stylex.props(styles.code)}>{branch}</code> in a new
              worktree of {repository?.name ?? "the repository"}, so this task stays apart from your
              checkout.
            </>
          ) : (
            <>
              The agent works in {repository?.name ?? "the repository"}'s checkout, on its current
              branch.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function Select({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon?: IconName;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <label {...stylex.props(styles.select)}>
      {icon && <Icon name={icon} size={13} />}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...stylex.props(styles.native)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="selector" size={12} />
    </label>
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
  controls: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    padding: 8,
  },
  // The agent and its choices, with Start; on a narrow card they wrap as one.
  agent: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 2,
    marginInlineStart: "auto",
  },
  select: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingInline: 8,
    borderRadius: tokens.buttonRound,
    color: { default: tokens.muted, ":hover": tokens.text },
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
  },
  // The native list opens from the whole control.
  native: {
    appearance: "none",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    outline: "none",
    paddingInlineEnd: 0,
    // As wide as the chosen option, not the longest one.
    fieldSizing: "content",
  },
  segments: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    borderRadius: `calc(${tokens.buttonRound} + 2px)`,
    backgroundColor: tokens.fill,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: "transparent",
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  segmentOn: {
    backgroundColor: tokens.segment,
    color: { default: tokens.text, ":hover": tokens.text },
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  start: { gap: 8, paddingInline: 12, marginInlineStart: 4 },
  hint: {
    marginTop: 12,
    marginInline: 4,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.6,
  },
  code: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.muted },
  error: { color: tokens.red },
});
