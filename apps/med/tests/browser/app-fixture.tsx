import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createReviewController } from "../../src/web/data/controller";
import type {
  Comparison,
  Note,
  PullRequestComments,
  ReviewResponse,
} from "../../src/shared/protocol";
import { initializeTheme, themeController } from "../../src/web/themes";
import { createBrowseApi } from "../../src/web/data/browse";
import { viewSettings } from "../../src/web/data/view-settings";
import type { BrowseSource } from "../../src/shared/browse";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import type { CodexReviewRun } from "../../src/shared/codex-review";
import type { AgentSession, Since } from "../../src/shared/saved-review";
import {
  type AgentPreset,
  type OwnedAction,
  type OwnedState,
} from "../../src/shared/owned-session";
import type { ThreadUsage } from "../../src/shared/model-usage";
import type { ReviewGuide } from "../../src/shared/review-guide";
import type { BlameLoader } from "../../src/web/data/blame";
import type { CommitApi } from "../../src/web/data/commit";

// The App with a fake host behind its APIs, for the app-*.test.tsx files:
// mountApp() renders a review, its files, and its agent session.

export const firstCommit = "a".repeat(40);
export const secondCommit = "b".repeat(40);
export const patch = ["alpha.ts", "beta.ts"]
  .map(
    (path) =>
      `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1,2 +1,2 @@\n-export const before = 1;\n+export const after = 2;\n export const shared = true;\n`,
  )
  .join("");
export const commits = [
  {
    id: firstCommit,
    parents: [secondCommit],
    subject: "Improve the review stream",
    author: "Alex",
    timestamp: 1789909685000,
    refs: ["main"],
  },
  {
    id: secondCommit,
    parents: [],
    subject: "Add the initial renderer",
    author: "Sam",
    timestamp: 1789909063000,
    refs: [],
  },
];
export let root: Root | undefined;
export let mount: HTMLDivElement | undefined;
/** An answer to an agent message: nothing listens on Med's port. */
export const NO_ANSWER = "no answer";

export const storedPreferences = [
  // Every view setting, at its default.
  ...Object.values(viewSettings).map((setting) => setting.key),
  "med:history",
  "med:session-panel-cards",
  "med:pane-layout",
  "med:pane-width",
  "med:work",
  "med:changes-rail",
  "med:guide-rail",
  "med:offer:proof-first",
  "med:offer:explain-first",
  "med:offer:round-limit",
];
/** Chooses Split or Unified in the review header's Display. */
export async function chooseLayout(layout: "Split" | "Unified") {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("radio", { name: layout }).click();
  await userEvent.keyboard("{Escape}");
}
/** Shows or hides the files sidebar from the review's ⋯ menu. */
/** The Files pane opens and closes from ⌘K. */
export async function toggleFilesSidebar() {
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await page.getByRole("option", { name: /^(Show|Hide) files sidebar/ }).click();
}
/** Message drafts and outboxes that a test leaves in the browser. */
export function forgetDrafts() {
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:draft:") || key.startsWith("med:outbox:")) localStorage.removeItem(key);
}
/** A desktop window, where the review and its side panes fit beside each
 * other, with no saved preferences or drafts. */
export async function prepareWindow() {
  await page.viewport(1280, 800);
  for (const key of storedPreferences) localStorage.removeItem(key);
  forgetDrafts();
}
/** Unmounts the App and forgets what it saved. */
export function unmountApp() {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  for (const key of storedPreferences) localStorage.removeItem(key);
  forgetDrafts();
}

export function response(comparison: Comparison): ReviewResponse {
  return {
    id: comparison.kind === "commit" ? comparison.commit : "c".repeat(64),
    repo: "/test/repo",
    comparison,
    base: secondCommit,
    head: comparison.kind === "commit" ? comparison.commit : "working",
    label: "Review changes",
    files: ["alpha.ts", "beta.ts"].map((path) => ({
      path: `src/${path}`,
      status: "M",
      additions: 1,
      deletions: 1,
      binary: false,
    })),
    patch,
    warnings: [],
    metrics: {
      gitMs: 1,
      totalMs: 2,
      patchBytes: patch.length,
      cacheHit: false,
    },
  };
}

export async function mountApp(
  options: {
    inputOnly?: boolean;
    notes?: Note[];
    metadataFile?: boolean;
    branches?: boolean;
    savedReview?: boolean;
    /** The agent's guide to the saved review. */
    guide?: ReviewGuide;
    readOnly?: boolean;
    noteMutation?: () => Promise<Response | undefined>;
    /** How many versions the agent handed off. The first and the last own the two saved targets. */
    versions?: number;
    /** The first target's worktree changed after its capture. */
    drift?: boolean;
    /** The first target is a range of the two fixture commits. */
    rangeCommits?: boolean;
    /** Both iterations are commits of one repository; the second is the tip
     * of tax-rates, which no checkout has. */
    oneBranch?: boolean;
    /** Branch changes since main have the two fixture commits. */
    branchCommits?: boolean;
    /** Replaces the two small files with these, as path and unified patch. */
    review?: { paths: string[]; patch: string };
    /** GitHub comments; the first saved target compares the pull request head. */
    pullRequest?: PullRequestComments;
    /** What GitHub has after a change to the reader's pending review. */
    pullRequestWrite?(input: unknown, current: PullRequestComments): PullRequestComments;
    /** Codex reviews; the first saved target compares the first run's commit. */
    codexReviews?: CodexReviewRun[];
    loadBlame?: BlameLoader;
    /** The Commit tab's repository. */
    commitApi?: CommitApi;
    /** A Claude Code session recorded with the saved review, as server events. */
    session?: string;
    /** The recorded session's agent; Claude Code by default. */
    sessionAgent?: "claude" | "codex";
    /** The saved review's messages to its agent: drafts, who waits, and
     * which sessions another process runs. */
    inbox?: Omit<AgentInboxState, "elsewhere" | "resumable" | "owned"> &
      Partial<Pick<AgentInboxState, "elsewhere" | "resumable" | "owned">>;
    /** Each message waits for its own call; a call with an error fails the send. */
    answerAgentMessages?: boolean;
    /** Agents that Med can start; a started one runs as session o1. */
    agents?: AgentPreset[];
    /** Session s1's earlier page and its prompts. The session stream stays open. */
    sessionPages?: {
      page: { events: unknown[]; start: number };
      turns: unknown[];
    };
    /** A registered vault, notes, with a plan that links to a target note. */
    vault?: boolean;
    /** The host's answer to "what changed since your last review". */
    since?: Since;
    /** The host's answer for a commit of the Review's range (SavedReviewStore.lens). */
    lens?: { notes: Note[]; hidden?: number; revision?: number };
    /** Another writer changes the saved comments just before the reader's first
     * one, and the host checks each write's expected revision. */
    noteConflict?: boolean;
    /** The thread's spend and context, as the host reads them from transcripts. */
    usage?: ThreadUsage;
    /** The host cannot read the checkout, so the session does not load. */
    sessionFails?: string;
    /** Waits before a file read answers, as a slow disk does. */
    readGate?(path: string): Promise<void>;
  } = {},
) {
  initializeTheme();
  themeController.commit("graphite-dark");
  const requests: Comparison[] = [];
  const fileRequests: { source: BrowseSource; path: string }[] = [];
  const vaultWrites: { path: string; text: string }[] = [];
  const vaultNote = (path: string, text?: string) => {
    text ??=
      path === "Target.md" ? "# Target\n\nLinked from the plan.\n" : "# Plan\n\nSee [[Target]].\n";
    return {
      source: { kind: "local", path: `/test/notes/${path}` },
      path: `/test/notes/${path}`,
      kind: "text",
      size: text.length,
      identity: text,
      text,
      vault: { id: "notes-0", path },
    };
  };
  let notes = options.notes ?? [];
  let revision = 0;
  const savedTargets = (
    options.oneBranch ? ["/test/repo", "/test/repo"] : ["/test/repo", "/test/feature"]
  ).map((repo, index) => {
    const reviewed = options.pullRequest?.head ?? options.codexReviews?.[0]?.commit;
    const commit =
      reviewed && !index
        ? reviewed
        : options.oneBranch
          ? [firstCommit, secondCommit][index]
          : undefined;
    return {
      id: `target-${index}`,
      repositoryId: options.oneBranch ? "repo-0" : `repo-${index}`,
      repo,
      branch: index && !options.oneBranch ? "feature" : "main",
      label: `Captured ${index}`,
      comparison: (commit ? { kind: "commit", commit } : { kind: "working" }) as Comparison,
      base: secondCommit,
      head: commit ?? "working",
      captured: !(reviewed && !index),
      ...(options.rangeCommits && !index
        ? {
            commits: commits.map(({ id, subject, author, timestamp }) => ({
              id,
              subject,
              author,
              timestamp,
            })),
          }
        : {}),
    };
  });
  const pullRequestReads: string[] = [];
  /** Saved targets' and browsed commits' reads, with their queries. */
  const savedReads: string[] = [];
  let conflicted = false;
  const pullRequestWrites: unknown[] = [];
  let pullRequest = options.pullRequest;
  let inbox = options.inbox;
  /** Queued messages that the agent gets just before the user takes them back. */
  const goneOnTake = new Set<string>();
  const steered: string[] = [];
  const deletedComments: string[][] = [];
  let ownedKind: "claude" | "codex" | "acp" = "claude";
  const agentMessages: unknown[] = [];
  // The host's answers to the messages that wait, in order: an error, or
  // NO_ANSWER for a host that is not there.
  const agentAnswers: ((error?: string) => void)[] = [];
  const savedRepositories = savedTargets.slice(0, options.oneBranch ? 1 : 2).map((target) => ({
    id: target.repositoryId,
    path: target.repo,
    name: target.repo.split("/").at(-1)!,
    branches: [
      {
        name: target.branch,
        head: firstCommit,
        worktreePath: target.repo,
        current: true,
      },
      ...(options.oneBranch ? [{ name: "tax-rates", head: secondCommit, current: false }] : []),
    ],
    worktrees: [{ path: target.repo, head: firstCommit, branch: target.branch }],
  }));
  /** The versions the reader opened, as the host records them. */
  let readVersions: number[] = [];
  /** The versions that a refresh captured. */
  const refreshed: { number: number; createdAt: string; targetIds: string[] }[] = [];
  // The session that handed off the review.
  let session: AgentSession | undefined = options.session
    ? { agent: options.sessionAgent ?? "claude", id: "s1", cwd: "/test/repo" }
    : undefined;
  // The session that Med runs: its state streams to the page until the test changes it.
  let owned: OwnedState | undefined;
  const ownedActions: OwnedAction[] = [];
  const ownedStarts: { preset: string; fork?: string }[] = [];
  const pageReads: string[] = [];
  const ownedListeners = new Set<() => void>();
  const setOwned = (change: Partial<OwnedState>) => {
    owned = { ...owned!, ...change };
    for (const listener of ownedListeners) listener();
  };
  // Session o1's transcript: each change sends the host's first view again.
  let ownedTranscript = { events: [] as unknown[], idle: true, modifiedAt: 0 };
  const transcriptListeners = new Set<() => void>();
  const setOwnedTranscript = (change: Partial<typeof ownedTranscript>) => {
    ownedTranscript = { ...ownedTranscript, ...change };
    for (const listener of transcriptListeners) listener();
  };
  const encoder = new TextEncoder();
  const eventStream = (first: () => string, subscribe?: (push: () => void) => () => void) => {
    let stop = () => {};
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const push = () => controller.enqueue(encoder.encode(first()));
          push();
          if (subscribe) stop = subscribe(push);
        },
        cancel: () => stop(),
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const savedNotes: Note[] = options.savedReview ? [...(options.notes ?? [])] : [];
  // As the host: the saved review's comments that no message sent are drafts too.
  const sentNotes = new Set<string>();
  const inboxState = (): AgentInboxState => ({
    ...inbox!,
    elsewhere: inbox!.elsewhere ?? {},
    owned: inbox!.owned ?? [],
    resumable: inbox!.resumable ?? [],
    drafts: [
      ...inbox!.drafts,
      ...savedNotes
        .filter((note) => !note.parentId && !sentNotes.has(note.id))
        .map(({ id, path, line, endLine, text }) => ({
          id,
          path,
          line,
          ...(endLine ? { endLine } : {}),
          text,
          replies: 0,
        })),
    ],
  });
  const savedBundle = () => ({
    id: "saved",
    title: "Agent review",
    createdAt: "2026-09-20T00:00:00Z",
    revision: 0,
    commentCount: 0,
    targets: savedTargets,
    ...(session ? { session } : {}),
    ...(options.pullRequest
      ? {
          pullRequestUrl: options.pullRequest.url,
          pullRequestTitle: "Read pull request threads",
        }
      : {}),
    ...(options.guide ? { guide: { ...options.guide, updatedAt: "2026-09-20T00:00:00Z" } } : {}),
    ...(readVersions.length ? { readVersions } : {}),
    ...(options.versions
      ? {
          key: "feat/agent",
          iterations: [
            ...Array.from({ length: options.versions }, (_, index) => ({
              number: index + 1,
              createdAt: new Date(Date.UTC(2026, 8, 20 + index)).toISOString(),
              targetIds:
                index === 0
                  ? [savedTargets[0]!.id]
                  : index === options.versions! - 1
                    ? [savedTargets[1]!.id]
                    : [],
              // The guide is the last version's.
              ...(options.guide && index === options.versions! - 1
                ? { guide: { ...options.guide, updatedAt: "2026-09-20T00:00:00Z" } }
                : {}),
            })),
            ...refreshed,
          ],
        }
      : {}),
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (options.savedReview) {
      if (url.pathname === "/api/reviews/saved") return Response.json(savedBundle());
      if (url.pathname === "/api/agents") return Response.json({ agents: options.agents ?? [] });
      if (url.pathname === "/api/reviews/saved/start" && init?.method === "POST") {
        const { preset } = JSON.parse(String(init.body)) as { preset: string };
        ownedStarts.push({ preset });
        // The session is of the preset's kind: Claude Code, Codex, or ACP.
        const kind = options.agents?.find((agent) => agent.id === preset)?.kind ?? "claude";
        ownedKind = kind === "codex" ? "codex" : kind === "claude" ? "claude" : "acp";
        // The host links the review to the new session.
        session = { agent: ownedKind, id: "o1", cwd: "/test/repo" };
        owned = {
          sessionId: "o1",
          preset,
          name: "Claude Code",
          status: "starting",
          settings: [],
          commands: [],
          turns: 0,
        };
        return Response.json({ thread: `${ownedKind}-o1`, state: owned });
      }
      if (url.pathname === "/api/thread-usage" && options.usage)
        return Response.json(options.usage);
      // A session's routes: the recorded session s1, or o1 that Med runs.
      const sessionRoute = /^\/api\/sessions\/([a-z]+)-(s1|o1)\/(.+)$/.exec(url.pathname);
      const sessionId = sessionRoute?.[2];
      const sessionPart = sessionRoute?.[3];
      if (sessionRoute && sessionId === "o1" && owned) {
        if (sessionPart === "owned/events")
          return eventStream(
            () => `event: state\ndata: ${JSON.stringify(owned)}\n\n`,
            (push) => {
              ownedListeners.add(push);
              return () => ownedListeners.delete(push);
            },
          );
        if (sessionPart === "owned" && init?.method === "POST") {
          const action = JSON.parse(String(init.body)) as OwnedAction;
          ownedActions.push(action);
          if (action.action === "setting")
            owned = {
              ...owned,
              settings: owned.settings.map((setting) =>
                setting.id === action.id ? { ...setting, value: action.value } : setting,
              ),
            };
          if (action.action === "permission") owned = { ...owned, permission: undefined };
          if (action.action === "interrupt") owned = { ...owned, status: "idle" };
          return Response.json(owned);
        }
        if (sessionPart === "events")
          return eventStream(
            () => `event: reset\ndata: ${JSON.stringify(ownedTranscript)}\n\n`,
            (push) => {
              transcriptListeners.add(push);
              return () => transcriptListeners.delete(push);
            },
          );
      }
      if (sessionRoute && sessionId === "s1" && options.session) {
        if (sessionPart === "events")
          return options.sessionPages
            ? eventStream(() => options.session!)
            : new Response(options.session, {
                headers: { "content-type": "text/event-stream" },
              });
        if (sessionPart === "page" && options.sessionPages) {
          pageReads.push(url.searchParams.get("before")!);
          return Response.json(options.sessionPages.page);
        }
        if (sessionPart === "turns" && options.sessionPages)
          return Response.json({ turns: options.sessionPages.turns });
        if (sessionPart === "owned" || sessionPart === "owned/events")
          return Response.json(
            { error: { code: "session-not-owned", message: "Med does not run this session." } },
            { status: 404 },
          );
        if (sessionPart === "continue" && init?.method === "POST") {
          // Fork in Med: a fork that Med runs takes the session's place,
          // with the messages that waited for the terminal.
          ownedStarts.push({ preset: "claude", fork: "s1" });
          ownedKind = "claude";
          session = { agent: "claude", id: "o1", cwd: "/test/repo" };
          if (inbox)
            inbox = {
              ...inbox,
              elsewhere: {},
              messages: inbox.messages.map((message) =>
                message.sessionId === "s1" && message.delivery === "pending"
                  ? { ...message, sessionId: "o1", delivery: "delivered" }
                  : message,
              ),
            };
          owned = {
            sessionId: "o1",
            preset: "claude",
            name: "Claude Code",
            status: "starting",
            settings: [],
            commands: [],
            turns: 0,
          };
          return Response.json({ thread: "claude-o1", state: owned });
        }
      }
      if (sessionRoute && sessionPart === "agent/events" && inbox)
        return new Response(`event: state\ndata: ${JSON.stringify(inboxState())}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      if (sessionRoute && sessionPart === "agent/messages" && inbox) {
        const input = JSON.parse(String(init?.body)) as {
          id?: string;
          text: string;
          noteIds: string[];
          images?: unknown[];
          afterTurn?: boolean;
        };
        if (options.answerAgentMessages) {
          const error = await new Promise<string | undefined>((answer) =>
            agentAnswers.push(answer),
          );
          if (error === NO_ANSWER) throw new TypeError("Failed to fetch");
          if (error)
            return Response.json({ error: { code: "busy", message: error } }, { status: 503 });
        }
        const thread = `${sessionRoute[1]}-${sessionId}`;
        agentMessages.push({ thread, ...input });
        const comments = inboxState()
          .drafts.filter((draft) => input.noteIds.includes(draft.id))
          .map(({ id: _id, replies: _replies, ...comment }) => comment);
        for (const id of input.noteIds) sentNotes.add(id);
        // A session that Med runs and that works takes the message at its next step.
        const queued = sessionId === "o1" && owned?.status === "working";
        const message: AgentInboxState["messages"][number] = {
          id: input.id ?? `m${agentMessages.length}`,
          sessionId: sessionId!,
          agent: sessionId === "o1" ? ownedKind : "claude",
          text: input.text,
          noteIds: input.noteIds,
          comments,
          attachmentCount: 0,
          ...(input.images?.length ? { imageCount: input.images.length } : {}),
          createdAt: new Date().toISOString(),
          // A session that a terminal or another app runs takes the message later.
          delivery: inbox.elsewhere?.s1 || queued ? "pending" : "delivered",
          ...(queued ? { queued: true } : {}),
          ...(queued && input.afterTurn ? { afterTurn: true } : {}),
        };
        inbox = {
          ...inbox,
          messages: [...inbox.messages, message],
          drafts: inbox.drafts.filter((draft) => !input.noteIds.includes(draft.id)),
        };
        return Response.json({ message, state: inboxState() });
      }
      if (sessionRoute && sessionPart === "agent/send-now" && inbox) {
        // The message goes at the agent's next step, not its turn's end.
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        steered.push(id);
        inbox = {
          ...inbox,
          messages: inbox.messages.map((entry) => {
            if (entry.id !== id) return entry;
            const { afterTurn: _afterTurn, ...next } = entry;
            return next;
          }),
        };
        return Response.json({ state: inboxState() });
      }
      if (sessionRoute && sessionPart === "agent/delete-comments" && inbox) {
        // As the host: the comments go from the review and the files.
        const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
        deletedComments.push(ids);
        inbox = { ...inbox, drafts: inbox.drafts.filter((draft) => !ids.includes(draft.id)) };
        for (let index = savedNotes.length - 1; index >= 0; index--)
          if (ids.includes(savedNotes[index]!.id)) savedNotes.splice(index, 1);
        return Response.json({ state: inboxState() });
      }
      if (sessionRoute && sessionPart === "agent/take" && inbox) {
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        const message = inbox.messages.find((entry) => entry.id === id && entry.queued);
        // The agent's next step took it just before.
        if (message && goneOnTake.has(message.text)) {
          inbox = {
            ...inbox,
            messages: inbox.messages.map((entry) =>
              entry === message ? { ...entry, queued: undefined, delivery: "delivered" } : entry,
            ),
          };
          return Response.json(
            { error: { code: "message-sent", message: "Sent" } },
            { status: 409 },
          );
        }
        if (!message)
          return Response.json(
            { error: { code: "message-sent", message: "Sent" } },
            { status: 409 },
          );
        inbox = { ...inbox, messages: inbox.messages.filter((entry) => entry !== message) };
        return Response.json({ message, state: inboxState() });
      }
      if (url.pathname === "/api/reviews/saved/since")
        return Response.json({ since: options.since ?? null });
      if (url.pathname === "/api/reviews/saved/read" && init?.method === "POST") {
        const { version } = JSON.parse(String(init.body)) as { version: number };
        readVersions = [...new Set([...readVersions, version])].sort((a, b) => a - b);
        return Response.json(savedBundle());
      }
      if (url.pathname === "/api/reviews/saved/codex-reviews")
        return Response.json({ runs: options.codexReviews ?? [] });
      if (url.pathname === "/api/reviews/saved/pull-request" && pullRequest) {
        if (init?.method === "POST") {
          const input = JSON.parse(String(init.body)) as unknown;
          pullRequestWrites.push(input);
          pullRequest = options.pullRequestWrite?.(input, pullRequest) ?? pullRequest;
        } else pullRequestReads.push(url.search);
        return Response.json(pullRequest);
      }
      if (url.pathname === "/api/reviews/saved/refresh" && init?.method === "POST") {
        // The checkout, captured again as a new version.
        const id = `target-${savedTargets.length}`;
        savedTargets.push({
          ...savedTargets.at(-1)!,
          id,
          label: `Captured ${savedTargets.length}`,
        });
        refreshed.push({
          number: (options.versions ?? 0) + refreshed.length + 1,
          createdAt: "2026-09-23T00:00:00Z",
          targetIds: [id],
        });
        return Response.json(savedBundle());
      }
      if (/^\/api\/reviews\/saved\/targets\/[^/]+\/drift$/.test(url.pathname))
        return Response.json({
          changed: !!options.drift && url.pathname.includes("/target-0/"),
        });
      if (url.pathname === "/api/reviews/saved/pull-request-live")
        return Response.json({
          url: "https://github.com/example/repo/pull/7",
          number: 7,
          title: "Pull request",
          author: "reader",
          state: "draft",
          body: "Calls failed once and gave up.",
          base: "main",
          head: "feat/retry",
          labels: [],
          checks: [],
          reviewers: [],
          merge: { mergeable: "UNKNOWN", status: "UNKNOWN", decision: null },
          fetchedAt: Date.now(),
        });
      if (url.pathname === "/api/repositories")
        return Response.json({ repositories: savedRepositories });
      if (url.pathname === "/api/branches")
        return Response.json(
          savedRepositories.find((entry) => entry.path === url.searchParams.get("repo"))
            ?.branches ?? [],
        );
      const savedRoute = /^\/api\/reviews\/saved\/targets\/target-(\d)\/(review|notes)$/.exec(
        url.pathname,
      );
      const browsing = /^\/api\/reviews\/saved\/browsing\/([^/]+)\/(notes|place)$/.exec(
        url.pathname,
      );
      if (browsing && options.lens) {
        savedReads.push(`${url.pathname}${url.search}`);
        if (browsing[2] === "place")
          return Response.json({
            lines: (JSON.parse(String(init?.body)).lines as unknown[]).map(() => null),
          });
        // Without ?target=, the commit has only its own comments: none here.
        const reviewId = decodeURIComponent(browsing[1]!);
        return Response.json(
          url.searchParams.has("target")
            ? { reviewId, revision: 0, ...options.lens }
            : { reviewId, revision: 0, notes: [] },
        );
      }
      if (savedRoute) {
        savedReads.push(`${url.pathname}${url.search}`);
        const target = savedTargets[Number(savedRoute[1])];
        if (savedRoute[2] === "notes" && init?.method === "POST") {
          const { mutation, expectedRevision } = JSON.parse(String(init.body));
          if (options.noteConflict) {
            if (!conflicted) {
              conflicted = true;
              revision++;
            }
            if (expectedRevision !== revision)
              return Response.json(
                { error: { code: "revision-conflict", message: "The comments changed." } },
                { status: 409 },
              );
          }
          if (mutation.type === "add")
            savedNotes.push({
              ...mutation.note,
              id: `saved-note-${savedNotes.length}`,
              resolution: "active",
              createdAt: "2026-09-20T00:00:00Z",
              updatedAt: "2026-09-20T00:00:00Z",
            });
          return Response.json({
            reviewId: target.id,
            revision: ++revision,
            notes: savedNotes,
          });
        }
        return Response.json(
          savedRoute[2] === "notes"
            ? { reviewId: target.id, revision, notes: savedNotes }
            : {
                ...response(target.comparison),
                id: target.id,
                repo: target.repo,
              },
        );
      }
    }
    if (url.pathname === "/api/browse/list") {
      const { source } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        entries: (source.repo === "/test/feature"
          ? ["src/feature-only.ts"]
          : ["src/alpha.ts", "src/beta.ts", "docs/GUIDE.md", "image.bin", "missing.ts"]
        ).map((path) => ({ path, kind: "file" })),
        truncated: false,
      });
    }
    if (url.pathname === "/api/browse/symbols") {
      const { source, path, identity, query } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        resultSource: path ? undefined : { kind: "commit", repo: source.repo, oid: firstCommit },
        path,
        identity,
        query,
        engine: path ? "ctags" : "zoekt",
        truncated: false,
        matches: [
          {
            name: "workingContents",
            kind: "constant",
            path: path ?? "src/alpha.ts",
            line: 2,
            column: 14,
          },
        ],
      });
    }
    if (url.pathname === "/api/browse/read") {
      const { source, path } = JSON.parse(String(init?.body));
      fileRequests.push({ source, path });
      await options.readGate?.(path);
      const kind = path === "image.bin" ? "binary" : path === "missing.ts" ? "missing" : "text";
      return Response.json({
        source,
        path,
        kind,
        size: 100,
        identity: `${JSON.stringify(source)}:${path}`,
        ...(kind === "text"
          ? {
              text: path.endsWith(".md")
                ? "# Guide\n\nRead the review in order.\n"
                : `export const workspace = "${source.repo}";\nexport const workingContents = true;\n`,
            }
          : {}),
      });
    }
    if (url.pathname === "/api/session" && options.sessionFails)
      return Response.json({ error: { message: options.sessionFails } }, { status: 500 });
    if (url.pathname === "/api/session")
      return Response.json({
        protocol: 1,
        ...(options.savedReview
          ? {
              repositories: savedRepositories,
              repositoryId: url.searchParams.get("repo") === "/test/feature" ? "repo-1" : "repo-0",
            }
          : {}),
        repository: {
          path: url.searchParams.get("repo") ?? "/test/repo",
          name: "review-fixture",
          head: firstCommit,
          branch: url.searchParams.get("repo") === "/test/feature" ? "feature" : "main",
          shallow: false,
          git: !options.inputOnly,
        },
        worktrees: options.inputOnly
          ? []
          : [{ path: "/test/repo", head: firstCommit, branch: "main" }],
        ...(options.inputOnly
          ? { initialComparison: { kind: "patch", path: "/test/change.patch" } }
          : {}),
      });
    if (url.pathname === "/api/branches")
      return Response.json(
        options.branches
          ? [
              {
                name: "main",
                head: firstCommit,
                worktreePath: "/test/repo",
                current: true,
              },
              {
                name: "feature",
                head: secondCommit,
                worktreePath: "/test/feature",
                current: false,
              },
              { name: "release", head: secondCommit, current: false },
            ]
          : [],
      );
    if (url.pathname === "/api/history")
      return Response.json({ commits, cursor: null, hasMore: false });
    if (options.branchCommits && url.pathname === "/api/commits")
      return Response.json({
        commits: commits.toReversed().map(({ id, subject, author, timestamp }) => ({
          id,
          subject,
          author,
          timestamp,
        })),
        more: false,
      });
    if (url.pathname === "/api/review") {
      const { comparison, repo } = JSON.parse(String(init?.body));
      requests.push(comparison);
      const review = {
        ...response(comparison),
        repo,
        ...(options.branchCommits &&
          comparison.kind === "working" &&
          comparison.base && { base: "d".repeat(40), headCommit: firstCommit }),
      };
      if (options.review) {
        review.patch = options.review.patch;
        review.files = options.review.paths.map((path) => ({
          path,
          status: "M",
          additions: 1,
          deletions: 1,
          binary: false,
        }));
      }
      if (options.metadataFile)
        review.files.push({
          path: "assets/model.bin",
          status: "M",
          additions: 0,
          deletions: 0,
          binary: true,
        });
      return Response.json(review);
    }
    if (url.pathname === "/api/notes") {
      if (init?.method === "POST") {
        const response = await options.noteMutation?.();
        if (response) return response;
        const body = JSON.parse(String(init.body));
        if (body.mutation.type === "add")
          notes = [
            ...notes,
            {
              ...body.mutation.note,
              id: `note-${revision}`,
              resolution: "active",
              createdAt: "2026-09-19T00:00:00Z",
              updatedAt: "2026-09-19T00:00:00Z",
            },
          ];
        if (body.mutation.type === "remove")
          notes = notes.filter((note) => note.id !== body.mutation.id);
        if (body.mutation.type === "edit")
          notes = notes.map((note) =>
            note.id === body.mutation.id ? { ...note, text: body.mutation.text } : note,
          );
        return Response.json({
          reviewId: body.reviewId,
          revision: ++revision,
          notes,
        });
      }
      return Response.json({
        reviewId: url.searchParams.get("reviewId"),
        revision,
        notes,
      });
    }
    if (url.pathname === "/api/service/status")
      return Response.json({
        sources: options.vault
          ? [{ id: "notes-0", name: "notes", path: "/test/notes", kind: "vault" }]
          : [],
      });
    if (options.vault && url.pathname === "/api/service/files")
      return Response.json({ files: [{ path: "Projects/Plan.md" }, { path: "Target.md" }] });
    if (options.vault && url.pathname === "/api/service/read")
      return Response.json(vaultNote(JSON.parse(String(init?.body)).path));
    if (options.vault && url.pathname === "/api/service/resolve")
      return Response.json({ path: "Target.md" });
    if (options.vault && url.pathname === "/api/local-files/write") {
      const { path, text } = JSON.parse(String(init?.body));
      vaultWrites.push({ path, text });
      const saved = vaultNote(path.slice("/test/notes/".length), text);
      return Response.json({ ...saved, vault: undefined });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const controller = createReviewController({
    fetch: fetcher,
    events: false,
    savedReviewId: options.savedReview ? "saved" : undefined,
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const browse = createBrowseApi(fetcher, "fixture");
  // Writable working files open in the Vim editor; without write they use the read-only viewer.
  root.render(
    <App
      controller={controller}
      browseApi={{
        ...browse,
        write: options.readOnly ? undefined : browse.write,
      }}
      loadBlame={options.loadBlame}
      commitApi={options.commitApi && (() => options.commitApi!)}
      sessionFetch={fetcher}
    />,
  );
  await expect
    .poll(() => document.querySelector("[data-review-status]")?.getAttribute("data-review-status"))
    .toBe(options.sessionFails ? "error" : "ready");
  // A saved review with a guide opens on its Overview. Its hidden diff views
  // have no box, so they render when Changes shows.
  const guideFirst =
    options.savedReview && (options.versions || options.guide || options.rangeCommits);
  // The first diff in a page loads Pierre's highlighter on the main thread,
  // which takes longest while every worker's page loads it at once.
  await expect
    .poll(() => document.querySelectorAll("diffs-container").length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(guideFirst || options.sessionFails ? 0 : options.review ? 1 : 2);
  return {
    controller,
    requests,
    fileRequests,
    vaultWrites,
    pullRequestReads,
    pullRequestWrites,
    savedReads,
    agentMessages,
    agentAnswers,
    setOwned,
    setOwnedTranscript,
    goneOnTake,
    steered,
    deletedComments,
    ownedActions,
    ownedStarts,
    pageReads,
    savedNotes,
    readVersions: () => readVersions,
  };
}

export async function openBranch(name: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "G",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  await page.getByRole("combobox", { name: "Search branches" }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}( |$)`) }).click();
}
