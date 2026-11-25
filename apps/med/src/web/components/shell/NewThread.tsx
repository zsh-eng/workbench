import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { threadSlug, threadTitle, type Thread, type ThreadList } from "../../../shared/threads";
import { createApi } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import type { AgentChoices, AgentOptions } from "../../../shared/owned-session";
import { useAgentOptions, useAgentPresets } from "../../data/owned-session";
import { tokens } from "../../theme.stylex";
import { ActionMenu, FlipChoice, type Choice as Option } from "../Controls";
import { ModelPicker } from "../ModelPicker";
import { Icon, type IconName } from "../Icon";
import { useMentions } from "../Mentions";
import { RichPromptEditor, type RichPromptEditorHandle } from "../RichPromptEditor";
import { createBrowseApi, useBrowseFiles, useVaults } from "../../data/browse";
import { useMentionSources } from "../../data/mentions";
import { findSources } from "../../data/setup";
import type { BrowseSource } from "../../../shared/browse";
import { readHistory } from "../../data/tabs";
import { AddImagesButton, PromptImageList, usePromptImages } from "../session/PromptImages";
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
 * A new thread, as Claude's new session page: the page asks where to work,
 * and the composer sits right under the list, with one line of choices under
 * it for the repository, where the agent works, and the agent's model and
 * effort. The list and the composer keep to the page's middle. Enter creates
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
  /** The new session's thread. */
  onStarted(thread: string): void;
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
  const [prompt, setPrompt] = useState("");
  const input = useRef<RichPromptEditorHandle | null>(null);
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
    editor: input,
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [error, setError] = useState<string | null>(null);
  // Images paste or drop into the task, as into a thread's message box.
  const pictures = usePromptImages(setError);
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
  const chooseAgent = (next: AgentChoices & { preset?: string }) =>
    remember(
      next.preset
        ? { preset: next.preset }
        : { agents: { ...choice.agents, [agent!.id]: { ...choice.agents?.[agent!.id], ...next } } },
    );

  const ready = !!prompt.trim() && !!repository && !!agent && !busy;
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createApi(fetcher, readBrowserToken()).json(
        "/api/threads",
        z.object({ thread: z.string() }),
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
            images: pictures.sent(),
          }),
        },
      );
      onStarted(result.thread);
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
  const addFolder = () => {
    onCancel();
    findSources();
  };
  const models = (options?.model?.options ?? []).map((option) => ({
    value: option.value,
    name: optionName(option),
    ...(option.group ? { group: option.group } : {}),
  }));
  return (
    <div ref={page} role="dialog" aria-label="New thread" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <WhereToWork
          repositories={ordered}
          chosen={repository?.id}
          onPick={(id) => {
            pick(id);
            input.current?.focus();
          }}
          onAdd={addFolder}
        />
        <div {...stylex.props(styles.composer)}>
          <div {...stylex.props(styles.card)}>
            {mentions.menu}
            {pictures.images.length > 0 && (
              <div {...stylex.props(styles.images)}>
                <PromptImageList images={pictures.images} onRemove={pictures.remove} />
              </div>
            )}
            <div {...stylex.props(styles.editor)}>
              <RichPromptEditor
                editorRef={input}
                value={prompt}
                mentions={mentions.mentioned}
                disabled={busy}
                minHeight={72}
                maxHeight={220}
                placeholder="Describe the task, and @ to name files, notes, or threads. Enter starts the agent."
                ariaLabel="Task"
                inputRole="combobox"
                ariaControls={mentions.ariaControls}
                ariaActiveDescendant={mentions.ariaActiveDescendant}
                ariaExpanded={mentions.open}
                ariaAutoComplete="list"
                onChange={(next, pos) => {
                  setPrompt(next);
                  mentions.changed(pos);
                }}
                onSelect={mentions.onSelect}
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
                {...pictures.field}
              />
            </div>
            <div {...stylex.props(styles.tray)}>
              <AddImagesButton onAdd={(files) => void pictures.add(files)} disabled={busy} />
            </div>
          </div>
          <div {...stylex.props(styles.menus)}>
            {ordered.length > 1 ? (
              <Picker
                label="Repository"
                align="start"
                value={repository?.id ?? ""}
                choices={ordered.map((entry) => ({ value: entry.id, label: entry.name }))}
                onChange={pick}
              >
                <MenuLabel icon="folder" text={repository?.name ?? "Repository"} />
              </Picker>
            ) : (
              repository && (
                <span {...stylex.props(styles.fact)}>
                  <MenuLabel icon="folder" text={repository.name} />
                </span>
              )
            )}
            <div {...stylex.props(styles.rightMenus)}>
              <FlipChoice
                label="Where the agent works"
                value={choice.worktree ? "worktree" : "checkout"}
                choices={[
                  { value: "worktree", label: `New worktree · ${branch}` },
                  {
                    value: "checkout",
                    label: repository?.branch ? `Checkout · ${repository.branch}` : "Checkout",
                  },
                ]}
                onChange={(value) => remember({ worktree: value === "worktree" })}
                trigger={styles.menu}
              >
                <MenuLabel icon="branch" text={choice.worktree ? "New worktree" : "Checkout"} />
              </FlipChoice>
              {agent && (
                <ModelPicker
                  models={models}
                  model={model ?? ""}
                  placeholder={agent.name}
                  onModel={(value) => chooseAgent({ model: value })}
                  {...(effort
                    ? {
                        levels: {
                          label: options?.effort?.name ?? "Effort",
                          value: effort,
                          options: efforts.map((option) => ({
                            value: option.value,
                            name: optionName(option),
                          })),
                          onChange: (value: string) => chooseAgent({ effort: value }),
                        },
                      }
                    : {})}
                  agents={{
                    value: agent.id,
                    options: (agents ?? []).map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                    })),
                    onChange: (preset) => chooseAgent({ preset }),
                  }}
                  icon={<AgentMark kind={agent.kind} />}
                  {...(agent.kind === "claude" || agent.kind === "codex"
                    ? {}
                    : { harness: agent.name })}
                  trigger={styles.menu}
                />
              )}
            </div>
          </div>
          <p {...stylex.props(styles.hint)} aria-live="polite">
            {error ? (
              <span {...stylex.props(styles.error)}>{error}</span>
            ) : busy ? (
              "Starting the agent…"
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A choice under the composer: a menu, or with two choices, a control that
 * switches between them.
 */
function Picker({
  label,
  value,
  choices,
  onChange,
  align,
  children,
}: {
  label: string;
  align?: "start" | "end";
  value: string;
  choices: Option[];
  onChange(value: string): void;
  children: ReactNode;
}) {
  if (choices.length === 2)
    return (
      <FlipChoice
        label={label}
        value={value}
        choices={choices}
        onChange={onChange}
        trigger={styles.menu}
      >
        {children}
      </FlipChoice>
    );
  return (
    <ActionMenu
      label={label}
      align={align}
      trigger={styles.menu}
      sections={[
        choices.map((option) => ({
          label: option.label,
          checked: option.value === value,
          choice: true,
          onClick: () => onChange(option.value),
        })),
      ]}
    >
      {children}
    </ActionMenu>
  );
}

/** A model's or an effort's name, with Claude Code's "Default (recommended)" as "Default";
 * the menu shows its mark as a badge. */
const optionName = (option: { value: string; name: string }) =>
  option.value === "default" ? "Default" : option.name.replace(/\s*\(recommended\)$/i, "");

/** A menu's trigger: its icon and the choice. */
function MenuLabel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <>
      <Icon name={icon} size={13} style={{ flexShrink: 0, opacity: 0.75 }} />
      <span {...stylex.props(styles.text)}>{text}</span>
    </>
  );
}

/** The agent's mark, in Claude's colour for Claude Code. */
function AgentMark({ kind }: { kind: string }) {
  return (
    <span {...stylex.props(styles.mark, kind === "claude" && styles.claude)}>
      <Icon name={kind === "claude" || kind === "codex" ? kind : "agent"} size={13} />
    </span>
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
    paddingInline: { default: 24, "@media (max-width: 640px)": 16 },
    backgroundColor: tokens.canvas,
  },
  // The list, and the composer right under it, in the page's middle, a
  // little above it.
  column: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    boxSizing: "border-box",
    width: "min(680px, 100%)",
    height: "100%",
    gap: 16,
    paddingTop: 24,
    paddingBottom: "min(10vh, 80px)",
    animationName: { default: enter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  composer: { flexShrink: 0 },
  // The @ list opens over the page above it.
  card: {
    position: "relative",
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
  editor: {
    boxSizing: "border-box",
    width: "100%",
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  images: { paddingInline: 16, paddingTop: 14 },
  // The composer's own buttons, under the text.
  tray: {
    display: "flex",
    justifyContent: "flex-end",
    paddingInline: 10,
    paddingBottom: 10,
  },
  // One line of menus under the composer; wraps cleanly on narrow screens so
  // the model and worktree pickers never crush to a few pixels.
  menus: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 4,
    columnGap: 2,
    minWidth: 0,
    marginTop: 6,
  },
  rightMenus: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    rowGap: 4,
    columnGap: 2,
    marginInlineStart: "auto",
    minWidth: 0,
    maxWidth: "100%",
  },
  menu: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    maxWidth: "100%",
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
  // A line kept for a note, so that the composer stays put when one shows.
  hint: {
    minHeight: "1.6em",
    marginTop: 8,
    marginBottom: 0,
    marginInline: 8,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.6,
  },
  error: { color: tokens.red },
});
