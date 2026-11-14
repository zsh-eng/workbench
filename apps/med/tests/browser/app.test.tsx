import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
  AGENT_CAPABILITIES,
  type AgentPreset,
  type OwnedAction,
  type OwnedState,
} from "../../src/shared/owned-session";
import type { ThreadUsage } from "../../src/shared/model-usage";
import type { ReviewGuide } from "../../src/shared/review-guide";
import type { BlameLoader } from "../../src/web/data/blame";
import type { CommitApi } from "../../src/web/data/commit";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";

const firstCommit = "a".repeat(40);
const secondCommit = "b".repeat(40);
const patch = ["alpha.ts", "beta.ts"]
  .map(
    (path) =>
      `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1,2 +1,2 @@\n-export const before = 1;\n+export const after = 2;\n export const shared = true;\n`,
  )
  .join("");
const commits = [
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
let root: Root | undefined;
let mount: HTMLDivElement | undefined;
/** An answer to an agent message: nothing listens on Med's port. */
const NO_ANSWER = "no answer";

const storedPreferences = [
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
async function chooseLayout(layout: "Split" | "Unified") {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("radio", { name: layout }).click();
  await userEvent.keyboard("{Escape}");
}
/** Shows or hides the files sidebar from the review's ⋯ menu. */
/** The Files pane opens and closes from ⌘K. */
async function toggleFilesSidebar() {
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await page.getByRole("option", { name: /^(Show|Hide) files sidebar/ }).click();
}
/** Message drafts and outboxes that a test leaves in the browser. */
function forgetDrafts() {
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:draft:") || key.startsWith("med:outbox:")) localStorage.removeItem(key);
}
beforeEach(async () => {
  // A desktop window: the review and its side panes fit beside each other.
  await page.viewport(1280, 800);
  for (const key of storedPreferences) localStorage.removeItem(key);
  forgetDrafts();
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  for (const key of storedPreferences) localStorage.removeItem(key);
  forgetDrafts();
});

function response(comparison: Comparison): ReviewResponse {
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

async function mountApp(
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
  // The first diff in a page loads Pierre's highlighter on the main thread.
  await expect
    .poll(() => document.querySelectorAll("diffs-container").length, { timeout: 5_000 })
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

async function openBranch(name: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "G",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  await page.getByRole("combobox", { name: "Search branches" }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name} `) }).click();
}

describe("graphical review", () => {
  test("the Review tab and its version restore the Review after live file browsing", async () => {
    const { controller } = await mountApp({
      savedReview: true,
      branches: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
      .toBeVisible();
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "false");
    await reviewTab.click();
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    expect(controller.getSnapshot().savedView).toBe(true);

    // Retain an active file in both workspaces, then return to a version whose
    // stored file navigation would otherwise hide its saved comparison.
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await openBranch("feature");
    await page.getByRole("link", { name: "src/beta.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true }))
      .toBeVisible();
    await reviewTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // Two checkouts: a click switches to the other.
    const checkout = page.getByRole("button", { name: /^Review checkout: / });
    for (const [index, name] of [
      [0, /^Review checkout: repo · /],
      [1, /^Review checkout: feature · /],
    ] as const) {
      if (!name.test(checkout.element().getAttribute("aria-label") ?? "")) await checkout.click();
      await expect.element(checkout).toHaveAccessibleName(name);
      await expect.poll(() => controller.getSnapshot().review?.id).toBe(`target-${index}`);
      await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    }
  });
  test("hovering a full-file link shares the read with opening it", async () => {
    const { fileRequests } = await mountApp();
    const link = page.getByRole("link", { name: "src/alpha.ts", exact: true });
    await link.hover();
    await expect.poll(() => fileRequests.length).toBe(1);
    await link.click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
      .toBeVisible();
    expect(fileRequests).toHaveLength(1);
  });

  test("a saved review moves the workspace to its branch, and its files open from there", async () => {
    const { controller, fileRequests } = await mountApp({ savedReview: true, oneBranch: true });
    // The checkout has the first commit checked out: its files are the working files.
    const link = page.getByRole("link", { name: "src/alpha.ts", exact: true });
    await link.click();
    await expect
      .poll(() => fileRequests.at(-1)?.source)
      .toEqual({ kind: "worktree", repo: "/test/repo" });
    await page.getByRole("button", { name: "Close src/alpha.ts" }).click();
    // The second is the tip of tax-rates, which no checkout has, though the
    // review was captured on main: the workspace shows tax-rates.
    await controller.selectSavedTarget("target-1");
    await expect.poll(() => controller.getSnapshot().review?.head).toBe(secondCommit);
    expect(controller.getSnapshot()).toMatchObject({
      activeBranch: "tax-rates",
      historyRef: "refs/heads/tax-rates",
    });
    await link.click();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({
        source: { kind: "commit", repo: "/test/repo", oid: secondCommit },
        path: "src/alpha.ts",
      });
    await expect.element(page.getByRole("tab", { name: /alpha\.ts/ })).toBeVisible();
  });

  test("Find file says why it can't open files when the checkout did not load", async () => {
    await mountApp({ sessionFails: "Permission denied: /test/repo" });
    await userEvent.keyboard("{Meta>}{Shift>}K{/Shift}{/Meta}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Permission denied: /test/repo" }))
      .toBeVisible();
    expect(page.getByRole("dialog", { name: /Find file/ }).query()).toBeNull();
  });

  test("Command-click opens background tabs from diff filenames and the changes tree", async () => {
    const { controller } = await mountApp();
    await page
      .getByRole("link", { name: "src/alpha.ts", exact: true })
      .click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    const selected = controller.getSnapshot().selectedFileId;
    await page.getByRole("treeitem", { name: /beta.ts/ }).click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    expect(controller.getSnapshot().selectedFileId).toBe(selected);
    // The tabs are the Files page's: Changes has none.
    expect(page.getByRole("tab", { name: "alpha.ts", exact: true }).query()).toBeNull();
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    // The tabs are the same width, as in Chrome, whatever their names.
    const items = () =>
      [...document.querySelectorAll('[aria-label="Open files"] [role="tab"]')].map(
        (tab) => tab.parentElement!.getBoundingClientRect().width,
      );
    expect(items()).toHaveLength(2);
    expect(new Set(items()).size).toBe(1);
    // The pointer on a tab's × fills the tab, as on the tab itself.
    const alpha = page.getByRole("tab", { name: "alpha.ts", exact: true });
    const fill = () => getComputedStyle(alpha.element()).backgroundColor;
    const resting = fill();
    await userEvent.hover(page.getByRole("button", { name: "Close src/alpha.ts" }));
    await expect.poll(fill).not.toBe(resting);
    await alpha.click();
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
  });
  test("Git blame opens for the current file tab only and closes when another tab shows", async () => {
    await mountApp({
      loadBlame: async (file, start) => ({
        source: file.source,
        path: file.path,
        identity: file.identity,
        truncated: false,
        lines: [
          {
            line: start,
            commit: "a".repeat(40),
            author: "Mira",
            date: "",
            summary: "Add",
          },
        ],
      }),
    });
    for (const name of ["src/alpha.ts", "src/beta.ts"])
      await page.getByRole("link", { name, exact: true }).click({ modifiers: ["Meta"] });
    const blame = page.getByRole("button", { name: "Toggle Git blame" });
    // Files opened behind wait on the Files page.
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await page.getByRole("tab", { name: "alpha.ts", exact: true }).click();
    await blame.click();
    await expect.element(blame).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "beta.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true }))
      .toBeVisible();
    await expect.element(blame).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("tab", { name: "alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
      .toBeVisible();
    await expect.element(blame).toHaveAttribute("aria-pressed", "false");
  });
  test("the editor shows the resting cursor line's blame until the draft changes", async () => {
    await mountApp({
      loadBlame: async (file, start, end) => ({
        source: file.source,
        path: file.path,
        identity: file.identity,
        truncated: false,
        lines: Array.from({ length: end - start + 1 }, (_, index) => ({
          line: start + index,
          commit: "a".repeat(40),
          author: index ? "Sam" : "Mira",
          date: "2026-09-20T01:23:45.000Z",
          summary: `Change line ${start + index}`,
        })),
      }),
    });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    const label = () => document.querySelector<HTMLElement>(".cm-line [data-med-line-blame-label]");
    await expect.poll(() => label()?.dataset.who).toMatch(/^Mira, /);
    expect(label()!.closest(".cm-line")!.textContent).toBe(
      'export const workspace = "/test/repo";',
    );
    await userEvent.keyboard("j");
    await expect.poll(() => label()?.dataset.who).toMatch(/^Sam, /);
    expect(label()!.dataset.summary).toBe(" · Change line 2");
    await userEvent.keyboard("ix");
    await expect.poll(() => label()).toBeNull();
  });
  test("a fresh launch opens read-only files with a visible Vim cursor and keyboard focus", async () => {
    await mountApp({ readOnly: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", {
      name: "File navigation",
      exact: true,
    });
    await expect.poll(() => document.activeElement).toBe(pane.element());
    const caret = document.querySelector<HTMLElement>("[data-file-pane=main] [data-vim-caret]")!;
    await expect.element(caret).toBeVisible();
    expect(caret.getBoundingClientRect().width).toBeGreaterThan(5);
    await userEvent.keyboard("j");
    await expect.element(pane).toHaveAttribute("data-vim-line", "2");
    await expect.element(caret).toBeVisible();
    await expect.element(caret).toHaveAttribute("data-vim-line", "2");
  });

  test("an explicit Vim opt-out is preserved", async () => {
    localStorage.setItem("med:vim", "off");
    await mountApp({ readOnly: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "File content", exact: true }))
      .toBeVisible();
    await expect
      .element(document.querySelector<HTMLElement>("[data-file-pane=main] [data-vim-caret]")!)
      .not.toBeVisible();
    expect(localStorage.getItem("med:vim")).toBe("off");
  });

  test("symbol shortcuts open file and project palettes and project selection opens the indexed commit", async () => {
    const { fileRequests } = await mountApp({ branches: true });
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "File editor", exact: true }))
      .toBeVisible();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "File", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("worktree");
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).not.toBeInTheDocument();
    // With a file open, ⌘⇧O opens its symbols; the picker switches to the project's.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "o",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect
      .poll(() => fileRequests.at(-1)?.source)
      .toEqual({ kind: "commit", repo: "/test/repo", oid: firstCommit });
  });
  test("question mark shows the command guide with keycaps", async () => {
    await mountApp({ branches: true });
    await expect.element(page.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const input = document.querySelector('input[aria-label="Filter changed files"]')!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    await expect.element(page.getByRole("dialog", { name: "Shortcuts & commands" })).toBeVisible();
    expect(document.querySelectorAll('[role="dialog"] kbd').length).toBeGreaterThan(10);
    await page.getByRole("option", { name: /Open command palette/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search commands" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search commands" }).fill("Open branch");
    await page.getByRole("option", { name: /Open branch/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
  });

  test("a single branch needs no tab strip; Command Shift G opens another beside it", async () => {
    await mountApp({ branches: true });
    const strip = page.getByRole("tablist", { name: "Branches and worktrees" });
    const switcher = page.getByRole("button", {
      name: "Open branch",
      exact: true,
    });
    const branch = () => switcher.element().textContent?.split("/").at(-1);
    await expect.poll(branch).toBe("main");
    await expect.element(strip).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "G",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect.element(page.getByRole("dialog", { name: "Open branch" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(strip.getByRole("tab", { name: "feature", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(strip.getByRole("tab", { name: "main", exact: true })).toBeVisible();
    await expect.poll(branch).toBe("feature");
    await page.getByRole("button", { name: "Close feature", exact: true }).click();
    await expect.element(strip).not.toBeInTheDocument();
    await expect.poll(branch).toBe("main");
  });

  test("the shortcut guide opens on the current context and searches keys", async () => {
    await mountApp({ branches: true });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    const guide = page.getByRole("dialog", { name: "Shortcuts & commands" });
    await expect.element(guide.getByRole("tab", { name: /Review/, selected: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("zz");
    await expect
      .element(guide.getByRole("option", { name: /Center the cursor line/ }))
      .toBeVisible();
    expect(guide.getByRole("option").elements()).toHaveLength(2);
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("Open branch");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
    await expect.element(guide).not.toBeInTheDocument();
  });

  test("file close shortcuts preserve Changes and close only the requested tabs", async () => {
    await mountApp();
    // The changed files are the Changes page's sidebar, so each open starts there.
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await changes.click();
    await page.getByRole("treeitem", { name: /beta.ts/ }).dblClick();
    const altKey = (code: string, shiftKey = false) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "∑",
          code,
          altKey: true,
          shiftKey,
          bubbles: true,
        }),
      );
    altKey("KeyO", true);
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    // The tab that showed before comes back, not the closed tab's neighbor:
    // the list's first click showed alpha.ts in Changes.
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await changes.click();
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect.element(tab("alpha.ts")).toHaveAttribute("aria-selected", "true");
    altKey("KeyW");
    await expect.element(tab("alpha.ts")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await tab("beta.ts").click();
    await tab("alpha.ts").click();
    altKey("KeyW");
    await expect.element(tab("alpha.ts")).not.toBeInTheDocument();
    await expect.element(tab("beta.ts")).toHaveAttribute("aria-selected", "true");
    const editor = page.getByRole("textbox", {
      name: "Edit src/beta.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    altKey("KeyW", true);
    await expect.element(tab("beta.ts")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });
  test("each file that Find file opens keeps its tab, a second open shows that tab, and tab keys move along the row", async () => {
    await mountApp();
    const find = async (name: string, keys: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "K",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
      await page.getByRole("combobox", { name: "Find file", exact: true }).fill(name);
      await expect.element(page.getByRole("option", { name: new RegExp(name) })).toBeVisible();
      await userEvent.keyboard(keys);
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    };
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await find("beta.ts", "{Enter}");
    await find("alpha.ts", "{Enter}");
    await expect.element(tab("beta.ts")).toBeVisible();
    // A second open shows the file's tab; it adds none.
    await find("beta.ts", "{Enter}");
    await expect.element(tab("beta.ts")).toHaveAttribute("aria-selected", "true");
    expect(page.getByRole("tab", { name: "beta.ts", exact: true }).all()).toHaveLength(1);
    await find("alpha.ts", "{Enter}");
    // The order is Changes, Commit, beta.ts, alpha.ts.
    const key = (init: KeyboardEventInit, target: EventTarget = window) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    // The pages are a switch in the header; files are tabs.
    const selected = async (name: string) => {
      const isPage = name === "Changes" || name === "Commit";
      const shown = isPage ? page.getByRole("radio", { name, exact: true }) : tab(name);
      await expect
        .element(shown)
        .toHaveAttribute(isPage ? "aria-checked" : "aria-selected", "true");
    };
    // From alpha.ts's editor too, where Option+3 would otherwise type £.
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    // / starts Vim's search in the file, also from outside it.
    (document.activeElement as HTMLElement | null)?.blur();
    key({ key: "/", code: "Slash" });
    await expect.element(page.getByRole("textbox", { name: "Edit src/alpha.ts" })).toBeVisible();
    await expect.poll(() => document.activeElement?.closest(".med-find-panel")).not.toBeNull();
    key({ key: "Escape", code: "Escape" }, document.activeElement!);
    key({ key: "£", code: "Digit3", altKey: true }, editor.element());
    await selected("beta.ts");
    key({ key: "¡", code: "Digit1", altKey: true });
    await selected("Changes");
    key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    await selected("Commit");
    key({ key: "ª", code: "Digit9", altKey: true });
    await selected("alpha.ts");
    key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    await selected("Changes");
    key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true });
    await selected("alpha.ts");
  });
  test("opens working contents from a historical diff and keeps the diff mounted", async () => {
    await page.viewport(1400, 850);
    const { controller, fileRequests } = await mountApp({ branches: true });
    await controller.selectComparison({ kind: "commit", commit: secondCommit });
    const diffHost = document.querySelector("diffs-container");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "File editor", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({
        source: { kind: "worktree", repo: "/test/repo" },
        path: "src/alpha.ts",
      });
    expect(diffHost?.isConnected).toBe(true);
    // The file's header has no Open before; ⌘K does.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("option", { name: /^Open before version of current file/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("commit");
    // Commit snapshots stay read-only.
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .toBeVisible();
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
    expect(diffHost?.isConnected).toBe(true);
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .not.toBeInTheDocument();
  });

  test("Command Shift K opens a scoped file picker and binary files show metadata", async () => {
    const { fileRequests } = await mountApp({ branches: true });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .toBeVisible();
    await page.getByRole("combobox", { name: "Find file", exact: true }).fill("image.bin");
    await page.getByRole("option", { name: /image.bin/ }).click();
    await expect
      .poll(() => document.querySelector('[data-full-file-kind="binary"]'))
      .not.toBeNull();
    expect(document.querySelector('[aria-label="Full file"] diffs-container')).toBeNull();
    await openBranch("feature");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect.element(page.getByRole("option", { name: /feature-only.ts/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /alpha.ts/ })).not.toBeInTheDocument();
    await page.getByRole("option", { name: /feature-only.ts/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.repo).toBe("/test/feature");
  });
  test("Space stays unhandled and Command K still opens commands", async () => {
    await mountApp();
    for (let i = 0; i < 2; i++) {
      const space = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(space);
      expect(space.defaultPrevented).toBe(false);
    }
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .not.toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .not.toBeInTheDocument();
  });
  test("Show files sidebar opens the Files page with its tree; it has no shortcut", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    const tree = () =>
      document.querySelector('nav[aria-label="Workspace files"]')?.checkVisibility() ?? false;
    const filesPage = page.getByRole("radio", { name: "Files", exact: true });
    // Without an agent session, Command Shift B does nothing.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "B",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tree()).toBe(false);
    await expect.element(filesPage).not.toBeChecked();
    // The tree is the Files page's sidebar: showing it shows the page, and
    // hiding it leaves the page on screen.
    for (const visible of [true, false]) {
      await toggleFilesSidebar();
      await expect.poll(tree).toBe(visible);
      await expect.element(filesPage).toBeChecked();
    }
    // With no file open, the page says how to open one, and has no tabs.
    await expect.element(page.getByText("No file open", { exact: true })).toBeVisible();
    expect(page.getByRole("tab").elements()).toHaveLength(0);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .toBeVisible();
  });
  test("side panes tile beside the review: zoom, resize, balance, and close", async () => {
    await page.viewport(1280, 800);
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Renamed in [alpha.ts:1](src/alpha.ts:1)." },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const session = page.getByRole("region", { name: "Agent session", exact: true });
    const panes = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]:not([hidden])")]
        .map((pane) => [pane.dataset.pane!, pane.getBoundingClientRect()] as const)
        .sort((a, b) => a[1].left - b[1].left);
    // The session leads, at the left.
    await expect.poll(() => panes().map(([id]) => id)).toEqual(["session", "review"]);

    // Zoom gives one pane the whole tree; the others wait behind it, inert.
    // The review's row has Expand; ⌘E expands the pane in use.
    const tree = document.querySelector("[data-pane-tree]")!.getBoundingClientRect();
    const sessionPane = document.querySelector<HTMLElement>('[data-pane="session"]')!;
    const reviewPane = document.querySelector<HTMLElement>('[data-pane="review"]')!;
    await page.getByRole("button", { name: "Expand review" }).click();
    await expect.poll(() => reviewPane.getBoundingClientRect().width).toBe(tree.width);
    expect(sessionPane.inert).toBe(true);
    await page.getByRole("button", { name: "Restore the other panes" }).click();
    await expect.poll(() => sessionPane.inert).toBe(false);
    const expandSession = async () => {
      sessionPane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await userEvent.keyboard("{Meta>}e{/Meta}");
      await expect.poll(() => sessionPane.getBoundingClientRect().width).toBe(tree.width);
      expect(reviewPane.inert).toBe(true);
    };
    await expandSession();
    await userEvent.keyboard("{Meta>}e{/Meta}");
    await expect
      .poll(() => sessionPane.getBoundingClientRect().width)
      .toBeLessThan(tree.width * 0.75);

    // A gutter's arrow keys move the edge between two panes; ⌘⌃= gives each
    // pane the same width.
    const gutter = page.getByRole("separator", { name: /^Resize Session and .+$/ });
    const share = () => Number(gutter.element().getAttribute("aria-valuenow"));
    const start = share();
    (gutter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(share).toBeGreaterThan(start);
    await userEvent.keyboard("{Meta>}{Control>}={/Control}{/Meta}");
    await expect
      .poll(() => {
        const widths = panes().map(([, rect]) => rect.width);
        return Math.max(...widths) - Math.min(...widths);
      })
      .toBeLessThanOrEqual(2);

    // A window too small for both panes shows one, and both come back.
    const ids = () => panes().map(([id]) => id);
    await page.viewport(400, 800);
    await expect.poll(() => ids().length).toBe(1);
    await page.viewport(1280, 800);
    await expect.poll(ids).toEqual(["session", "review"]);

    // A file that opens from a zoomed pane shows: the review gets its room back.
    await expandSession();
    await session.getByRole("link", { name: "Open src/alpha.ts at L1" }).click();
    await expect
      .poll(() => sessionPane.getBoundingClientRect().width)
      .toBeLessThan(tree.width * 0.75);
    expect(reviewPane.inert).toBe(false);
  });
  test("a Markdown file reads rendered, and ⌘⇧V shows its source in its place", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    await toggleFilesSidebar();
    const files = page.getByRole("navigation", { name: "Workspace files", exact: true });
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Edit docs/GUIDE.md", exact: true });
    await expect.element(editor).not.toBeInTheDocument();
    // The page is the whole view: Copy and Edit source sit at its top corner.
    const tools = reading.getByRole("toolbar", { name: "Page" });
    await expect.element(tools.getByRole("button", { name: "Copy page" })).toBeVisible();
    await expect.element(tools.getByRole("button", { name: "Edit source" })).toBeVisible();
    expect(document.querySelector(".med-markdown-reader header")).toBeNull();

    // The source shows in place of the text, never beside it.
    await page.getByRole("button", { name: "Edit source" }).click();
    await expect.element(editor).toBeVisible();
    await expect.element(reading).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "V", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    await expect.element(editor).not.toBeInTheDocument();

    // The file keeps the view that it showed last.
    await page.getByRole("button", { name: "Edit source" }).click();
    await expect.element(editor).toBeVisible();
    await files.getByRole("treeitem", { name: "alpha.ts", exact: true }).click();
    await expect.element(editor).not.toBeInTheDocument();
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    await expect.element(editor).toBeVisible();
    await page.getByRole("button", { name: "Read" }).click();
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    expect(document.querySelector('[data-pane="preview"]')).toBeNull();
  });
  test("a Markdown file that shows again shows its page from the first frame while it reads, never its source", async () => {
    let holding = false;
    let release: (() => void) | undefined;
    await page.viewport(1280, 800);
    await mountApp({
      readGate: (path) =>
        holding && path.endsWith(".md")
          ? new Promise<void>((done) => (release = done))
          : Promise.resolve(),
    });
    await toggleFilesSidebar();
    const files = page.getByRole("navigation", { name: "Workspace files", exact: true });
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    await files.getByRole("treeitem", { name: "alpha.ts", exact: true }).click();
    await expect.element(reading).not.toBeInTheDocument();

    // Each frame from here says what it showed: the page with its text, the
    // page empty, or the note's source.
    const frames: string[] = [];
    let recording = true;
    const look = () => {
      const editor = [...document.querySelectorAll(".cm-editor")].some((node) =>
        node.textContent?.includes("# Guide"),
      );
      const prose = document.querySelector(".med-md-prose");
      const state = editor
        ? "source"
        : prose?.querySelector("h1")?.textContent === "Guide"
          ? "page"
          : document.querySelector(".med-markdown-reader")
            ? "empty page"
            : "other file";
      if (frames.at(-1) !== state) frames.push(state);
      if (recording) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    holding = true;
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    await expect.poll(() => release).toBeDefined();
    // The read is still out: the note's page shows, not its source.
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    release!();
    await new Promise((done) => setTimeout(done, 200));
    recording = false;
    expect(frames).toEqual(["other file", "page"]);
    await expect
      .element(page.getByRole("textbox", { name: "Edit docs/GUIDE.md", exact: true }))
      .not.toBeInTheDocument();
  });
  test("Find file opens a vault's note in the workspace's tabs; its links stay in the vault", async () => {
    await page.viewport(1280, 800);
    const { vaultWrites } = await mountApp({ vault: true });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
    );
    const find = page.getByRole("combobox", { name: "Find file", exact: true });
    await find.fill("notes");
    await expect.element(page.getByRole("option", { name: "Vault notes" })).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect
      .element(page.getByRole("button", { name: "Back to current repository" }))
      .toHaveTextContent("notes");
    // A space finds words that a hyphen or a slash separates.
    await find.fill("projects plan");
    await expect.element(page.getByRole("option", { name: /Plan.md/ })).toBeVisible();
    await userEvent.keyboard("{Enter}");

    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Plan" })).toBeVisible();
    // The page has no bar; its tab names the note and its vault.
    await expect
      .element(page.getByRole("tab", { name: /Plan\.md/ }))
      .toHaveAttribute("title", "Projects/Plan.md · notes");
    await reading.getByRole("link", { name: "Target" }).click();
    await expect.element(page.getByRole("tab", { name: /Target.md/ })).toBeVisible();
    await expect.element(reading.getByRole("heading", { name: "Target" })).toBeVisible();

    // Its source saves to the vault's file.
    await page.getByRole("button", { name: "Edit source" }).click();
    const editor = page.getByRole("textbox", { name: "Edit /test/notes/Target.md", exact: true });
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);
    await userEvent.keyboard("ggA again{Escape}:w{Enter}");
    await expect
      .poll(() => vaultWrites)
      .toEqual([
        { path: "/test/notes/Target.md", text: "# Target again\n\nLinked from the plan.\n" },
      ]);
    await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  });
  test("Find file shows a vault's notes without the Tab step, and the vault's chip searches only it", async () => {
    await page.viewport(1280, 800);
    await mountApp({ vault: true });
    const open = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
      );
    open();
    const find = page.getByRole("combobox", { name: "Find file", exact: true });
    await expect
      .element(find)
      .toHaveAttribute("placeholder", expect.stringMatching(/^Find a file or a note/));
    // A note whose name holds the words is an option, with its vault's name.
    await find.fill("plan");
    const note = page.getByRole("option", { name: /Plan\.md/ });
    await expect.poll(() => note.element().textContent).toBe("Plan.mdnotes · ProjectsNote");
    await expect.element(page.getByText("0 files · 1 note")).toBeVisible();
    await userEvent.keyboard("{Enter}");
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Plan" })).toBeVisible();
    // The page has no bar; its tab names the note and its vault.
    await expect
      .element(page.getByRole("tab", { name: /Plan\.md/ }))
      .toHaveAttribute("title", "Projects/Plan.md · notes");

    // The chip under the field scopes the search to the vault.
    open();
    await page.getByRole("button", { name: "notes", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Back to current repository" }))
      .toHaveTextContent("notes");
    await find.fill("target");
    await expect.element(page.getByRole("option", { name: /Target\.md/ })).toBeVisible();
  });
  test("a pane's header drags it beside another pane or swaps the two; Escape keeps it", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]:not([hidden])")]
        .map((pane) => [pane.dataset.pane!, pane.getBoundingClientRect()] as const)
        .sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left)
        .map(([id]) => id);
    await expect.poll(order).toEqual(["session", "review"]);
    const rect = (id: string) =>
      document.querySelector(`[data-pane="${id}"]`)!.getBoundingClientRect();
    const grip = () => document.querySelector('[data-pane="session"] [data-pane-handle]')!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    /** Drags the Session header to a point, then drops it or presses Escape. */
    const dragTo = async (x: number, y: number, end: "drop" | "escape" = "drop") => {
      const handle = grip();
      const start = handle.getBoundingClientRect();
      const at = (type: string, clientX: number, clientY: number) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 7,
            clientX,
            clientY,
          }),
        );
      at("pointerdown", start.x + 4, start.y + 4);
      at("pointermove", start.x + 40, start.y + 40);
      at("pointermove", x, y);
      await frame();
      await frame();
      if (end === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else at("pointerup", x, y);
    };

    // The lower edge of the review: the session goes below it.
    const review = rect("review");
    await dragTo(review.left + review.width / 2, review.bottom - 10);
    await expect.poll(order).toEqual(["review", "session"]);
    expect(Math.round(rect("session").top)).toBeGreaterThan(Math.round(review.top) + 100);
    // It settles in from a slight scale, as a new pane does.
    await expect.poll(() => Math.round(rect("session").left)).toBe(Math.round(rect("review").left));

    // The middle of the review swaps the two.
    const above = rect("review");
    await dragTo(above.left + above.width / 2, above.top + above.height / 2);
    await expect.poll(() => Math.round(rect("session").top)).toBe(Math.round(above.top));

    // Escape keeps the pane where it was.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const before = order();
    const target = rect("review");
    await dragTo(target.left + 8, target.top + target.height / 2, "escape");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order()).toEqual(before);
    expect(document.querySelector("[data-pane-tree] > [aria-hidden='true']")).toBeNull();

    // ⌘⌥⇧ and an arrow move the focused pane past its neighbor.
    document.querySelector<HTMLElement>('[data-pane="session"]')!.focus();
    const top = Math.round(rect("session").top);
    await userEvent.keyboard("{Meta>}{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}{/Meta}");
    await expect.poll(() => Math.round(rect("session").top)).toBeGreaterThan(top);
  });

  test("the Files page keeps its tree and collapsed folders across toggles and pages", async () => {
    await page.viewport(1280, 800);
    await mountApp({ branches: true });
    const selector = 'nav[aria-label="Workspace files"] file-tree-container';
    // The tree waits, prepared and hidden, before the Files page shows.
    await expect
      .poll(
        () =>
          document.querySelector(selector)?.shadowRoot?.querySelectorAll('[role="treeitem"]')
            .length ?? 0,
      )
      .toBeGreaterThan(0);
    const preparedHost = document.querySelector(selector);
    expect(preparedHost?.checkVisibility()).toBe(false);
    await toggleFilesSidebar();
    const sidebar = page.getByRole("navigation", { name: "Workspace files", exact: true });
    const folder = sidebar.getByRole("treeitem", { name: "src", exact: true });
    await expect.element(folder).toHaveAttribute("aria-expanded", "true");
    await folder.click();
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    const host = document.querySelector(selector);
    expect(host).toBe(preparedHost);
    await toggleFilesSidebar();
    await expect.poll(() => host?.checkVisibility()).toBe(false);
    await toggleFilesSidebar();
    await expect.poll(() => host?.checkVisibility()).toBe(true);
    expect(document.querySelector(selector)).toBe(host);
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    // Another page and back: the same tree, as the reader left it.
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
    await expect.poll(() => host?.checkVisibility()).toBe(false);
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect.poll(() => host?.checkVisibility()).toBe(true);
    expect(document.querySelector(selector)).toBe(host);
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    // Another branch has its own files. It opens on Changes.
    await openBranch("feature");
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect
      .element(sidebar.getByRole("treeitem", { name: "feature-only.ts", exact: true }))
      .toBeVisible();
    expect(document.querySelector(selector)).not.toBe(host);
    await expect
      .element(sidebar.getByRole("treeitem", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
  });
  test("switches branch tabs and toggles the sidebar with Command B", async () => {
    const { controller } = await mountApp({ branches: true });
    await openBranch("feature");
    await expect
      .poll(() => controller.getSnapshot().session?.repository.path)
      .toBe("/test/feature");
    // A new branch name rolls in; moving the switch with the sidebar does not replay it.
    const name = () =>
      page.getByRole("button", { name: "Open branch" }).getByText("release", { exact: true });
    await openBranch("release");
    await expect.poll(() => name().element().getAnimations().length).toBeGreaterThan(0);
    await expect.poll(() => controller.getSnapshot().historyRef).toBe("refs/heads/release");
    expect(controller.getSnapshot().comparison).toEqual({
      kind: "commit",
      commit: secondCommit,
    });
    await expect
      .element(page.getByRole("button", { name: "Working changes", exact: true }))
      .not.toBeInTheDocument();
    // Alone, ⌘B is the Changes page's sidebar.
    const sidebar = () =>
      document.querySelector('nav[aria-label="Files and commits"]')?.checkVisibility() ?? false;
    const panel = document.querySelector('nav[aria-label="Files and commits"]');
    expect(panel).not.toBeNull();
    await expect.poll(() => name().element().getAnimations()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(false);
    expect(name().element().getAnimations()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(true);
    expect(name().element().getAnimations()).toEqual([]);
    // The sidebar comes back as it was, without building its content again.
    expect(document.querySelector('nav[aria-label="Files and commits"]')).toBe(panel);
  });

  test("mounts real Pierre stream, changes theme and reviews commits without dropping other files", async () => {
    await page.viewport(1280, 800);
    const { controller, requests } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Change theme");
    await page.getByRole("option", { name: /Change theme/ }).click();
    await page.getByRole("combobox", { name: "Search themes" }).fill("Tokyo");
    await page.getByRole("option", { name: /Tokyo Night/ }).click();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
    await controller.selectComparison({ kind: "commit", commit: firstCommit });
    await expect
      .poll(() =>
        document.querySelector("[data-selected-commit]")?.getAttribute("data-selected-commit"),
      )
      .toBe(firstCommit);
    await expect
      .poll(() => document.querySelectorAll("diffs-container").length)
      .toBeGreaterThanOrEqual(2);
    await controller.selectComparison({ kind: "commit", commit: secondCommit });
    await expect
      .poll(() =>
        document.querySelector("[data-selected-commit]")?.getAttribute("data-selected-commit"),
      )
      .toBe(secondCommit);
    expect(requests).toEqual([
      { kind: "working" },
      { kind: "commit", commit: firstCommit },
      { kind: "commit", commit: secondCommit },
    ]);
  });

  test("filters the full file set, switches layout, and finds across both files", async () => {
    const { controller } = await mountApp();
    await page.getByRole("textbox", { name: "Filter changed files" }).fill("alpha");
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(1);
    expect(controller.getSnapshot().files).toHaveLength(2);
    await page.getByRole("button", { name: "Clear file filter" }).click();
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(2);
    await chooseLayout("Unified");
    expect(localStorage.getItem("med:mode")).toBe("unified");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    // Typing goes to the first matching line.
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    // Every match is marked; the current hit's matches are marked on top.
    await expect.poll(() => CSS.highlights.get("med-diff-find")?.size ?? 0).toBeGreaterThan(1);
    await expect
      .poll(() => [...(CSS.highlights.get("med-diff-find-current") ?? [])].map(String))
      .toContain("after");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(page.getByText("2 of 2", { exact: true })).toBeVisible();
    // Match case finds none; a regular expression finds them again.
    await page.getByRole("button", { name: "Match case" }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("AFTER");
    await expect.element(page.getByText("No results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Match case" }).click();
    await page.getByRole("button", { name: "Regular expression" }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("aft(er");
    await expect.element(page.getByText("Not a valid pattern", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("af+ter");
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => CSS.highlights.has("med-diff-find")).toBe(false);
  });

  test("a palette command that opens a field leaves the focus in it", async () => {
    await mountApp();
    // Focus starts on a control, which the palette would otherwise give it back to.
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    await changes.click();
    expect(document.activeElement).toBe(changes.element());
    const command = async (name: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      await page.getByRole("combobox", { name: "Search commands" }).fill(name);
      await userEvent.keyboard("{Enter}");
    };
    await command("Find in diff contents");
    const find = page.getByRole("textbox", { name: "Find in changes" });
    await expect.poll(() => document.activeElement).toBe(find.element());
    // Typing goes into the box.
    await userEvent.keyboard("after");
    await expect.element(find).toHaveValue("after");
    await userEvent.keyboard("{Escape}");
    await changes.click();
    await command("Filter changed files");
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toMatch(/filter/i);
  });

  test("the Changes page keeps its place while another page shows, each time", async () => {
    await page.viewport(1280, 800);
    const paths = [0, 1, 2].map((index) => `src/long${index}.ts`);
    const patch = paths
      .map(
        (path, index) =>
          `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,140 +1,140 @@\n` +
          Array.from(
            { length: 140 },
            (_, line) => `-const value${line} = -1;\n+const value${line} = ${index};\n`,
          ).join(""),
      )
      .join("");
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ review: { paths, patch }, commitApi: repository.api });
    const stream = page.getByRole("main", { name: "Continuous review" });
    const scroller = () =>
      [stream.element(), ...stream.element().querySelectorAll<HTMLElement>("*")].find(
        (node) => getComputedStyle(node).overflowY === "auto" && node.scrollHeight > 2000,
      );
    await expect.poll(() => scroller()?.scrollHeight ?? 0).toBeGreaterThan(2000);
    await stream.wheel({ delta: { y: 1500 } });
    await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(1000);
    // Settled: the place the page keeps is the last one it reported.
    await new Promise((done) => setTimeout(done, 200));
    const top = scroller()!.scrollTop;
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    const commit = page.getByRole("radio", { name: "Commit", exact: true });
    for (const _ of [1, 2, 3]) {
      await commit.click();
      await expect.element(commit).toHaveAttribute("aria-checked", "true");
      await changes.click();
      await expect.poll(() => scroller()?.scrollTop).toBeCloseTo(top, 0);
    }
  });

  test("find in diffs centers matches in other files, collapsed ones too", async () => {
    await page.viewport(1280, 800);
    // Long files, so a match starts far outside the viewport and the
    // virtualized list must measure rows it has not drawn yet.
    const paths = [0, 1, 2, 3, 4].map((index) => `src/long${index}.ts`);
    const body = (index: number) =>
      Array.from({ length: 140 }, (_, line) =>
        index === 3 && line === 100
          ? "const needleLater = 1;"
          : index === 0 && line === 120
            ? "const needleCollapsed = 1;"
            : `const value${line} = ${index};`,
      );
    const reviewPatch = paths
      .map(
        (path, index) =>
          `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,140 +1,140 @@\n` +
          body(index)
            .map((line) => `-${line.replace(/= \d+;$/, "= -1;")}\n+${line}\n`)
            .join(""),
      )
      .join("");
    await mountApp({ review: { paths, patch: reviewPatch } });
    await page.getByRole("button", { name: "Collapse src/long0.ts", exact: true }).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    // Each line counts, on both sides of a change: two lines are four matches.
    await page.getByRole("textbox", { name: "Find in changes" }).fill("needle");
    await expect.element(page.getByText("1 of 4", { exact: true })).toBeVisible();
    const stream = page.getByRole("main", { name: "Continuous review" }).element();
    const line = (text: string) => {
      for (const host of document.querySelectorAll("diffs-container")) {
        const walker = document.createTreeWalker(host.shadowRoot!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode())
          if (walker.currentNode.textContent?.includes(text))
            return walker.currentNode.parentElement!.getBoundingClientRect();
      }
      return null;
    };
    const centered = async (text: string) => {
      const near = () => {
        const rect = line(text);
        const view = stream.getBoundingClientRect();
        return (
          !!rect &&
          Math.abs((rect.top + rect.bottom) / 2 - (view.top + view.bottom) / 2) < view.height / 4
        );
      };
      await expect.poll(near).toBe(true);
      // It stays there once the rows around it have been measured.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(near()).toBe(true);
    };
    // The first match is in the collapsed file, which opens for it.
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 4", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("3 of 4", { exact: true })).toBeVisible();
    await centered("needleLater");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 of 4", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "Collapse src/long0.ts",
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await centered("needleCollapsed");
  });

  test("next hunk puts the whole hunk in the middle of the view", async () => {
    await page.viewport(1280, 800);
    // One file with 14 hunks of 8 lines each: a context line, 6 added lines, a context line.
    const path = "src/hunks.ts";
    const hunks = Array.from({ length: 14 }, (_, index) => {
      const start = 1 + index * 50;
      return (
        `@@ -${start},2 +${start + index * 6},8 @@\n const before${index} = 0;\n` +
        ["a", "b", "c", "d", "e", "f"].map((part) => `+const hunk${index}${part} = 1;\n`).join("") +
        ` const after${index} = 0;\n`
      );
    });
    await mountApp({
      review: {
        paths: [path],
        patch: `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`,
      },
    });
    const row = (text: string) => {
      for (const host of document.querySelectorAll("diffs-container")) {
        const walker = document.createTreeWalker(host.shadowRoot!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode())
          if (walker.currentNode.textContent?.includes(text))
            return walker.currentNode.parentElement!.getBoundingClientRect();
      }
      return null;
    };
    await expect.poll(() => row("hunk0a")).not.toBeNull();
    let scroller = document.querySelector("diffs-container")!.parentElement!;
    while (!/auto|scroll/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement!;
    for (let step = 0; step < 6; step++) await userEvent.keyboard("]");
    // The middle of the hunk, between its third and fourth added lines, is
    // the middle of the scrolling view, within a line. Before, the hunk's first
    // line was at the top.
    const offset = () => {
      const third = row("hunk6c");
      const view = scroller.getBoundingClientRect();
      return third ? Math.abs(third.bottom - (view.top + view.bottom) / 2) : Infinity;
    };
    await expect.poll(offset).toBeLessThan(20);
  });

  test("the full diff header toggles collapse while its filename opens the file", async () => {
    await mountApp();
    const toggle = page.getByRole("button", {
      name: "Collapse src/alpha.ts",
      exact: true,
    });
    await expect.element(toggle).toBeVisible();
    const bounds = toggle.element().getBoundingClientRect();
    // The far edge of the header is clickable, not just the chevron.
    await toggle.click({
      position: { x: bounds.width - 4, y: bounds.height / 2 },
    });
    const expand = page.getByRole("button", {
      name: "Expand src/alpha.ts",
      exact: true,
    });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    (expand.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Edit src/alpha.ts" })).toBeVisible();
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("gd uses ctags to jump to a declaration in the current file", async () => {
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    const cursorLine = () => document.querySelector(".med-editor .cm-activeLine")?.textContent;
    // Type a use on the last line, then jump to the fixture's ctags match at line 2, column 14.
    await userEvent.keyboard("Giuse(workingContents);{Escape}0wwgd");
    await expect.poll(cursorLine).toBe("export const workingContents = true;");
    // Insert at the cursor to prove the column.
    await userEvent.keyboard("i_{Escape}");
    await expect.poll(cursorLine).toBe("export const _workingContents = true;");
    await expect.poll(() => document.activeElement).toBe(editor.element());
  });

  test("dismisses selected lines with the draft and moves an open composer to a new range", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    await chooseLayout("Split");
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === document.querySelector("diffs-container")?.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await expect.poll(() => Boolean(number("2"))).toBe(true);
    await number("1").click();
    await number("2").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Old range draft");
    // Editing inside the card keeps the diff selection.
    await expect
      .element(
        page.getByRole("toolbar", { name: "Line selection" }).getByText("L1–2", { exact: true }),
      )
      .toBeVisible();
    await number("2").click();
    await expect.element(page.getByRole("textbox", { name: "Review note text" })).toHaveValue("");
    await expect
      .element(
        page.getByRole("form", {
          name: "Local comment on line R2",
          exact: true,
        }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-selected-line]").length,
      )
      .toBe(0);
    await number("1").click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Escape this draft");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
    await number("1").click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Click away");
    await chooseLayout("Split");
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
  });

  test("shift-selecting line numbers keeps the full range when adding a note", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    await chooseLayout("Split");
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-additions] [data-column-number]").length,
      )
      .toBeGreaterThanOrEqual(2);
    const host = document.querySelector("diffs-container")!;
    const numbers = host.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-additions] [data-column-number]",
    );
    // Pierre exposes each split side as a number column.
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === host.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await number("1").click();
    await number("2").click({ modifiers: ["Shift"] });
    await expect
      .element(
        page.getByRole("toolbar", { name: "Line selection" }).getByText("L1–2", { exact: true }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Add note to line", exact: true }).first().click();
    // The composer opens below the last selected line, as the saved note shows.
    const slot = (element: Element) => element.closest("[slot]")?.getAttribute("slot");
    const composer = page.getByRole("textbox", { name: "Review note text" });
    await expect.poll(() => slot(composer.element())).toBe("annotation-additions-2");
    await composer.fill("Both lines");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ line: 1, endLine: 2, side: "new", text: "Both lines" });
    await expect
      .poll(() => {
        const card = [...document.querySelectorAll("[slot] *")].find(
          (element) => element.textContent === "Both lines",
        );
        return card && slot(card);
      })
      .toBe("annotation-additions-2");
  });

  test("dragging the gutter plus opens a note for the full range", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    await chooseLayout("Split");
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-additions] [data-column-number]").length,
      )
      .toBeGreaterThanOrEqual(2);
    const host = document.querySelector("diffs-container")!;
    const numbers = host.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-additions] [data-column-number]",
    );
    // Pierre exposes each split side as a number column.
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === host.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await number("1").hover();
    await userEvent.dragAndDrop(
      page.getByRole("button", { name: "Add note to line", exact: true }).first(),
      number("2"),
    );
    await page.getByRole("textbox", { name: "Review note text" }).fill("Both lines");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ line: 1, endLine: 2, side: "new", text: "Both lines" });
  });

  test("creates and deletes an inline note without retaining an old annotation portal", async () => {
    const { controller } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Review note text" })
      .fill("Check inline reconciliation");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Check inline reconciliation", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Delete review note" }).click();
    await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(0);
    await expect
      .element(page.getByText("Check inline reconciliation", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Delete review note" }))
      .not.toBeInTheDocument();
  });

  test("replaces a saved draft before completion and preserves a newer draft", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    const mutateNote = controller.mutateNote;
    let completeSave!: () => void;
    const completion = new Promise<void>((resolve) => {
      completeSave = resolve;
    });
    controller.mutateNote = async (mutation) => {
      await mutateNote(mutation);
      await completion;
    };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("First saved comment");
    try {
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
      // The promise is still pending: the published note must replace its composer,
      // rather than add another card that briefly doubles the annotation height.
      await expect.element(page.getByText("First saved comment", { exact: true })).toBeVisible();
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .not.toBeInTheDocument();
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.getByRole("textbox", { name: "Review note text" }).fill("A newer draft");
      completeSave();
      await completion;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .toHaveValue("A newer draft");
    } finally {
      completeSave();
    }
  });

  test("restores draft text after an optimistic comment is rejected", async () => {
    await page.viewport(1280, 800);
    let rejectSave!: (response: Response) => void;
    const result = new Promise<Response>((resolve) => {
      rejectSave = resolve;
    });
    const { controller } = await mountApp({ noteMutation: () => result });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Recover this comment");
    try {
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Recover this comment", { exact: true })).toBeVisible();
      rejectSave(Response.json({ error: { message: "Storage is full" } }, { status: 500 }));
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .toHaveValue("Recover this comment");
      await expect
        .element(page.getByRole("button", { name: "Clear line selection" }))
        .toBeVisible();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(0);
      await expect.element(page.getByText("Storage is full", { exact: true })).toBeVisible();
    } finally {
      rejectSave(Response.json({ error: { message: "Storage is full" } }, { status: 500 }));
    }
  });

  test("keeps an unsaved draft when its save fails", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    controller.mutateNote = async () => {
      throw new Error("Cannot save this comment");
    };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Keep my draft");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Cannot save this comment");
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .toHaveValue("Keep my draft");
    expect(controller.getSnapshot().notes?.notes).toHaveLength(0);
  });

  test("opens a standalone patch without exposing Git controls", async () => {
    const { requests } = await mountApp({ inputOnly: true });
    expect(requests).toEqual([{ kind: "patch", path: "/test/change.patch" }]);
    await expect
      .element(page.getByRole("region", { name: "Commit history" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("combobox", { name: "Worktree" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Display" })).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
    // Display has a row for each choice: the layout and the theme are icons.
    const address = location.href;
    await page.getByRole("button", { name: "Display" }).click();
    const display = page.getByRole("dialog", { name: "Display" });
    await expect
      .element(
        display
          .getByRole("radiogroup", { name: "Diff layout" })
          .getByRole("radio", { name: "Unified" }),
      )
      .toBeVisible();
    const themes = display.getByRole("radiogroup", { name: "Theme" });
    await themes.getByRole("radio", { name: "Dark" }).click();
    await expect.poll(() => document.documentElement.dataset.appearance).toBe("dark");
    await themes.getByRole("radio", { name: "Light" }).click();
    await expect.poll(() => document.documentElement.dataset.appearance).toBe("light");
    await expect.element(themes.getByRole("radio", { name: "Light" })).toBeChecked();
    await themes.getByRole("radio", { name: "Auto" }).click();
    await expect.element(themes.getByRole("radio", { name: "Auto" })).toBeChecked();
    // Display ends with the way to every code setting.
    await page
      .getByRole("dialog", { name: "Display" })
      .getByRole("button", { name: "All code settings" })
      .click();
    expect(location.pathname).toBe("/settings/code");
    await expect.element(page.getByRole("dialog", { name: "Display" })).not.toBeInTheDocument();
    history.replaceState(null, "", address);
    // ⌘K opens Settings at each section.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("combobox", { name: "Search commands" }).fill("Settings: Open in");
    await page.getByRole("option", { name: /^Settings: Open in/ }).click();
    expect(location.pathname).toBe("/settings/open-in");
    history.replaceState(null, "", address);
  });

  test("reveals metadata-only files selected in the sidebar", async () => {
    await page.viewport(1280, 600);
    const { controller } = await mountApp({ metadataFile: true });
    await page.getByRole("treeitem", { name: /model.bin/ }).click();
    const target = page.getByText("Binary file", { exact: true });
    await expect.element(target).toBeVisible();
    const row = document.querySelector('[data-metadata-file="assets/model.bin"]');
    await expect
      .poll(() => {
        const rect = row?.getBoundingClientRect();
        return rect !== undefined && rect.top >= 0 && rect.bottom <= innerHeight;
      })
      .toBe(true);
    expect(
      controller
        .getSnapshot()
        .files.find((file) => file.id === controller.getSnapshot().selectedFileId)?.path,
    ).toBe("assets/model.bin");
  });

  test("edits a stale note outside current hunks and preserves an orphaned note", async () => {
    const { controller } = await mountApp({
      notes: [
        {
          id: "inline",
          path: "src/alpha.ts",
          side: "new",
          line: 900,
          text: "Check this value",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "stale",
        },
        {
          id: "orphan",
          path: "src/removed.ts",
          side: "old",
          line: 3,
          text: "Preserve this concern",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "orphaned",
        },
      ],
    });
    await page.getByText("2 preserved notes outside this diff", { exact: true }).click();
    await expect.element(page.getByText("Check this value", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText("Source changed since this note was written.", {
          exact: true,
        }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page
      .getByRole("textbox", { name: "Edit note text" })
      .fill("Checked against the current source");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.find((note) => note.id === "inline")?.text)
      .toBe("Checked against the current source");
    await expect.element(page.getByText("Preserve this concern", { exact: true })).toBeVisible();
  });
  test("q goes to the Commit tab from a file's Vim Normal and Visual modes, and types in Insert", async () => {
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    const fileTab = page.getByRole("tab", { name: "alpha.ts", exact: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await editor.click();
    // Insert mode types the letter; the file has none before.
    expect(editor.element().textContent).not.toContain("q");
    await userEvent.keyboard("iq{Escape}");
    await expect.poll(() => editor.element().textContent).toContain("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "false");
    // Normal mode: q goes to Commit, not into a macro.
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    // q goes back to the file, and from Visual mode to Commit again.
    await userEvent.keyboard("q");
    await expect.element(fileTab).toHaveAttribute("aria-selected", "true");
    await editor.click();
    await userEvent.keyboard("V");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
  });

  test("q goes to the Commit tab from the read-only file view, unless a motion waits for a letter", async () => {
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api, readOnly: true });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
    await expect.poll(() => document.activeElement).toBe(pane.element());
    // `f` takes the q as the letter to find.
    await userEvent.keyboard("fq");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    // In Visual mode too.
    await userEvent.keyboard("q");
    await expect.poll(() => document.activeElement).toBe(pane.element());
    await userEvent.keyboard("v");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
  });

  test("q opens the Commit tab, where keys stage, commit, and push a new branch", async () => {
    // An unsent message is kept per checkout; start without one.
    for (const key of Object.keys(localStorage))
      if (key.startsWith("med:commit-message:")) localStorage.removeItem(key);
    const repository = createFakeRepository({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("radio", { name: "Commit", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    const files = page.getByRole("listbox", { name: "Changed files" });
    await expect.element(files).toHaveFocus();
    const row = (path: string) => files.getByRole("option", { name: new RegExp(`^${path}, `) });
    const rows = () =>
      files
        .getByRole("option")
        .elements()
        .map((element) => element.getAttribute("aria-label"));
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");

    // / filters the list and the diff stream. Enter keeps the filter; Esc in
    // the list clears it, as in a search.
    const stream = page.getByRole("region", { name: "Changes to commit" });
    await userEvent.keyboard("/");
    await expect
      .element(page.getByRole("textbox", { name: "Filter files to commit" }))
      .toHaveFocus();
    await userEvent.keyboard("src/web");
    await expect
      .poll(rows)
      .toEqual([
        "src/web/App.tsx, partly staged, modified",
        "src/web/components/CommitView.tsx, not staged, untracked",
      ]);
    await expect
      .element(stream.getByRole("button", { name: /stage docs\/USAGE\.md$/i }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect.element(files).toHaveFocus();
    expect(rows()).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => rows().length).toBe(5);

    // Space stages the focused file at once, before Git answers; j moves on.
    repository.configure({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: true,
    });
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"), { timeout: 400 })
      .toHaveAccessibleName("docs/USAGE.md, staged, modified");
    await expect
      .element(stream.getByRole("button", { name: "Unstage docs/USAGE.md" }), {
        timeout: 400,
      })
      .toBeVisible();
    repository.configure({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: false,
    });
    await userEvent.keyboard("j");
    await expect
      .element(row("scripts/obsolete-check.mjs"))
      .toHaveAttribute("aria-selected", "true");

    // c opens the message in a dialog: a summary, and Enter goes on to the
    // description. A failed hook keeps the message and shows its output there.
    await expect
      .element(page.getByRole("textbox", { name: "Commit summary" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("c");
    const summary = page.getByRole("textbox", { name: "Commit summary" });
    const description = page.getByRole("textbox", { name: "Commit description" });
    await expect.element(summary).toHaveFocus();
    await userEvent.keyboard("docs: explain the Commit tab");
    await userEvent.keyboard("{Enter}");
    await expect.element(description).toHaveFocus();
    await userEvent.keyboard("It lists what each key does.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .element(page.getByRole("alert").filter({ hasText: "lint-staged" }))
      .toMatchTextContent("Missing semicolon");
    await expect.element(summary).toHaveValue("docs: explain the Commit tab");
    await expect.element(description).toHaveValue("It lists what each key does.");
    repository.configure({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Committed " }))
      .toMatchTextContent(/^Committed [0-9a-f]{7} docs: explain the Commit tab$/);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(files).toHaveFocus();
    // Staged files left the list; the unstaged half of App.tsx stayed.
    await expect
      .poll(rows)
      .toEqual([
        "src/web/App.tsx, not staged, modified",
        "src/web/components/CommitView.tsx, not staged, untracked",
      ]);

    // A branch without an upstream asks before it pushes and tracks.
    await userEvent.keyboard("{Shift>}P{/Shift}");
    const confirm = page.getByRole("group", { name: "Track a new upstream" });
    await expect
      .element(confirm)
      .toMatchTextContent("Push to origin/feature/commit-tab and track it?");
    await expect.element(confirm.getByRole("button", { name: "Push and track" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Pushed " }))
      .toMatchTextContent(/^Pushed [0-9a-f]{7} to origin\/feature\/commit-tab$/);

    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");

    // As in Changes, a file name in the stream opens the file (Command-click
    // behind this tab), and o opens the focused file.
    await userEvent.keyboard("q");
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    stream
      .getByRole("link", {
        name: "src/web/components/CommitView.tsx",
        exact: true,
      })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    // It opens behind this page: Commit stays, and the file waits on Files.
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    await row("src/web/App.tsx").click();
    await userEvent.keyboard("o");
    await expect.element(tab("App.tsx")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("CommitView.tsx")).toBeVisible();
    // Closing the file goes back to Commit, and q leaves Commit for the tab
    // that showed before it, by the same rule.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "∑", code: "KeyW", altKey: true, bubbles: true }),
    );
    await expect.element(tab("App.tsx")).not.toBeInTheDocument();
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });
  test("Enter goes into a file's hunks, where Space stages one, and d discards a hunk or a file after asking", async () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("med:commit-message:")) localStorage.removeItem(key);
    const repository = createFakeRepository({
      upstream: true,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    await userEvent.keyboard("q");
    const files = page.getByRole("listbox", { name: "Changed files" });
    await expect.element(files).toHaveFocus();
    const row = (path: string) => files.getByRole("option", { name: new RegExp(`^${path}, `) });
    const usage = { path: "docs/USAGE.md", staged: null, unstaged: "modified" } as const;
    const halves = () => repository.api.changes(usage);
    const place = (text: string) => page.getByText(text, { exact: true });
    // The confirmation's answer keys wait 400 ms after it opens.
    const read = () => new Promise((resolve) => setTimeout(resolve, 450));

    // docs/USAGE.md has two hunks, neither staged. Enter goes into them, and
    // the focused hunk's keys show under it.
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");
    await userEvent.keyboard("{Enter}");
    await expect.element(place("Hunk 1 of 2, not staged")).toBeVisible();
    const stream = page.getByRole("region", { name: "Changes to commit" });
    await expect.element(stream.getByRole("toolbar", { name: "Hunk" })).toBeVisible();

    // Space stages the first hunk alone, and the next one takes the focus.
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, partly staged, modified");
    await expect.element(place("Hunk 2 of 2, not staged")).toBeVisible();
    let { staged, unstaged } = await halves();
    expect(staged).toContain("+Med reads the working files. The Commit tab stages");
    expect(staged).not.toContain("+## Commit");
    expect(unstaged).toContain("+## Commit");
    // k goes back to the staged hunk, and Space unstages it.
    await userEvent.keyboard("k");
    await expect.element(place("Hunk 1 of 2, staged")).toBeVisible();
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");
    await expect.element(place("Hunk 1 of 2, not staged")).toBeVisible();

    // d asks first and names the hunk; Cancel has the focus, and Esc keeps it.
    await userEvent.keyboard("d");
    const ask = page.getByRole("dialog", { name: "Discard this hunk?" });
    await expect
      .element(ask)
      .toMatchTextContent(
        /docs\/USAGE\.md, the hunk at line 20 \(\+1 −1\): its lines go back to the last commit\.You cannot undo this\./,
      );
    await expect.element(ask.getByRole("button", { name: /^Cancel/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(ask).not.toBeInTheDocument();
    expect((await halves()).unstaged).toContain("+Med reads the working files.");
    // A quick "dd" only asks. d in the confirmation discards the hunk once
    // the confirmation has had a moment to be read; the other hunk stays.
    await userEvent.keyboard("dd");
    await expect.element(ask).toBeVisible();
    expect((await halves()).unstaged).toContain("+Med reads the working files.");
    await read();
    await userEvent.keyboard("d");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Discarded a hunk of docs/USAGE.md" }))
      .toBeVisible();
    ({ unstaged } = await halves());
    expect(unstaged).not.toContain("+Med reads the working files.");
    expect(unstaged).toContain("+## Commit");
    await expect.element(place("Hunk 1 of 1, not staged")).toBeVisible();
    await expect.element(ask).not.toBeInTheDocument();

    // Esc goes back to the files. A file that Git does not track: d asks to
    // delete it, and Enter on Cancel keeps it.
    await userEvent.keyboard("{Escape}");
    await expect.element(place("3 of 5 staged")).toBeVisible();
    await userEvent.keyboard("jjjj");
    await expect
      .element(row("src/web/components/CommitView.tsx"))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("d");
    const remove = page.getByRole("dialog", {
      name: "Delete src/web/components/CommitView.tsx?",
    });
    await expect
      .element(remove)
      .toMatchTextContent(
        /Git does not track this file, so Med deletes it\.You cannot undo this\./,
      );
    await userEvent.keyboard("{Enter}");
    await expect.element(remove).not.toBeInTheDocument();
    await expect.element(files).toHaveFocus();
    await expect.element(row("src/web/components/CommitView.tsx")).toBeVisible();
    // Tab goes to Delete file.
    await userEvent.keyboard("d");
    await expect.element(remove).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(remove.getByRole("button", { name: /^Delete file/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(row("src/web/components/CommitView.tsx")).not.toBeInTheDocument();
    await expect.element(remove).not.toBeInTheDocument();

    // The focus stays at the deleted file's place: the last file now. A partly
    // staged file offers to keep its staged changes, and says that the other
    // choice takes them.
    await expect.element(row("src/web/App.tsx")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("d");
    const partial = page.getByRole("dialog", { name: "Discard changes to src/web/App.tsx?" });
    await expect
      .element(partial)
      .toMatchTextContent(
        "It has staged and unstaged changes.Unstaged only: the file goes back to its staged version.Discard all: the staged changes go too, and the file goes back to the last commit.You cannot undo this.",
      );
    await read();
    await userEvent.keyboard("u");
    await expect.element(partial).not.toBeInTheDocument();
    await expect
      .element(row("src/web/App.tsx"))
      .toHaveAccessibleName("src/web/App.tsx, staged, modified");

    // ? shows the Commit tab's keys.
    await userEvent.keyboard("?");
    const guide = page.getByRole("dialog", { name: "Shortcuts & commands" });
    await expect.element(guide.getByRole("tab", { name: /Commit/, selected: true })).toBeVisible();
    await expect.element(guide.getByText("Go into the file's hunks")).toBeVisible();
  });
});

describe("review guide", () => {
  // The file headers in the diff stream, by their text.
  const streamFiles = () =>
    [...document.querySelectorAll("[data-stream-file]")].map((node) => node.textContent);

  test("shows a version's proof first, what changed since the last review, and its findings", async () => {
    await mountApp({
      savedReview: true,
      versions: 2,
      // The second version's guide: its summary has the proof and findings.
      guide: {
        summary: [
          "## Proof",
          "- `bun run test`: 42 passed",
          "- `bun run build` failed: 1 type error",
          "- Screenshot: /tmp/shots/rename.png",
          "",
          "### Not covered",
          "- Safari",
          "",
          "## Findings",
          "- Important `src/alpha.ts:1` Callers still import the old name.",
          "- Nit `src/beta.ts:2` Rename `shared`. Won't fix: it matches upstream.",
        ].join("\n"),
        segments: [{ title: "Rename", files: ["src/**"] }],
      },
      since: {
        from: 1,
        to: 2,
        basis: "previous",
        files: [
          { path: "src/alpha.ts", change: "changed", target: "saved-target" },
          { path: "src/old.ts", change: "gone", target: "saved-target" },
        ],
      },
    });
    // A second version opens on the Overview.
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof).toMatchTextContent(/^Proof1 of 2 failed/);
    await expect.element(proof.getByText("bun run test")).toBeVisible();
    await expect.element(proof.getByText("42 passed")).toBeVisible();
    await expect.element(proof.getByLabelText("failed")).toBeVisible();
    await expect.element(proof.getByText("/tmp/shots/rename.png")).toBeVisible();
    await expect
      .element(proof.getByRole("list", { name: "Not covered" }))
      .toMatchTextContent("Safari");
    const since = overview.getByRole("region", { name: "Since your last review" });
    await expect
      .element(since)
      .toMatchTextContent(/^New since you looked2 filesWhat changed since the hand-off before\./);
    await expect.element(since.getByRole("button", { name: /Gone src\/old\.ts/ })).toBeDisabled();
    const findings = overview.getByRole("region", { name: "Findings" });
    await expect.element(findings).toMatchTextContent(/^Findings1 open/);
    await expect
      .element(
        findings.getByRole("button", {
          name: /^Nit\s*Rename shared\.\s*src\/beta\.ts:2\s*Won't fix: it matches upstream\.$/,
        }),
      )
      .toBeVisible();
    await expect.element(overview.getByText(/1 open finding/)).toBeVisible();
    // The proof is first, under the title; no offer shows beside it.
    const order = [proof, since, findings].map((part) => part.element());
    expect(
      order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);

    // A finding opens its line in the Review's diff.
    await findings.getByRole("button", { name: /Callers still import the old name/ }).click();
    await expect.element(overview).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() =>
        [...document.querySelectorAll("diffs-container")].some(
          (node) => !!node.shadowRoot?.querySelector("[data-selected-line]"),
        ),
      )
      .toBe(true);
  });

  test("shows a proof table whose columns share the width, breaking long commands at their separators, and counts its checks", async () => {
    // As an agent wrote it: one row's command and result are long, and one
    // row's only code is in its result, so it is a note, not a check.
    const command =
      "./gradlew :telemetry:histogram-core-internal:test --tests 'ClassicBucketsTest'";
    await mountApp({
      savedReview: true,
      versions: 2,
      guide: {
        summary: [
          "## Proof",
          "",
          "| Check | Scope | Result |",
          "| --- | --- | --- |",
          `| \`${command}\` | for \`ClassicBuckets*\` and \`BucketBoundaryTest\` | 18 tests pass (2+9+7). CI on the branch is green across the three JVM targets after the rerun. |`,
          "| `bun run lint` | all of `src/` | 1 error in src/beta.ts |",
          "| Fixture | Generated | `histogram()` is `registry.timer(bucketName())`; the name has `platformVersion` and the bucket set |",
        ].join("\n"),
        segments: [{ title: "Rename", files: ["src/**"] }],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof).toMatchTextContent(/^Proof1 of 2 failed/);
    const table = proof.getByRole("table");
    await expect.element(table.getByRole("cell", { name: command })).toBeVisible();
    // The rows show once, in the table, not again as check rows.
    expect(proof.getByText(command).elements()).toHaveLength(1);
    const box = table.element() as HTMLElement;
    const code = table.getByRole("cell", { name: command }).element().querySelector("code")!;
    // The command can break at its separators, and nowhere in a word; its
    // text stays as written, for a copy.
    await expect
      .poll(() => code.innerHTML)
      .toBe(
        "./gradlew :telemetry<wbr>:histogram-<wbr>core-<wbr>internal<wbr>:test --tests 'ClassicBucketsTest'",
      );
    expect(code.textContent).toBe(command);
    // In the narrow column beside the Guide's rail, every column shows: the
    // table fits without scrolling, the command takes a few lines, none of
    // them a letter or two, and the result's prose wraps.
    await page.viewport(1100, 800);
    await expect.element(page.getByRole("navigation", { name: "Guide" })).toBeVisible();
    await expect.poll(() => box.scrollWidth - box.clientWidth).toBeLessThanOrEqual(0);
    const lines = [...code.getClientRects()];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const line of lines) expect(line.width).toBeGreaterThan(48);
    // At phone width a table that cannot fit with whole words scrolls in its
    // own box, and the page does not.
    await page.viewport(390, 800);
    await expect.poll(() => box.scrollWidth > box.clientWidth).toBe(true);
    for (const part of [proof.element(), overview.element()])
      await expect.poll(() => part.scrollWidth - part.clientWidth).toBeLessThanOrEqual(0);
  });

  test("a guide summary's proof shows once, in the Proof part, and the rest of the summary stays", async () => {
    await mountApp({
      savedReview: true,
      guide: {
        summary: [
          "Renames the export, so the CSV keeps its old column names.",
          "",
          "## Proof",
          "",
          "| Check | Result |",
          "| --- | --- |",
          "| `bun run test` | 3 passed |",
          "",
          "### Not covered",
          "",
          "- The import.",
          "",
          "## Read first",
          "",
          "The rename in alpha.ts; beta.ts follows it.",
        ].join("\n"),
        segments: [{ title: "Rename alpha", files: ["src/alpha.ts"] }],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof.getByRole("table")).toBeVisible();
    await expect.element(proof.getByText("The import.")).toBeVisible();
    await expect
      .element(overview.getByText("The rename in alpha.ts; beta.ts follows it."))
      .toBeVisible();
    await expect.element(overview.getByText(/^Renames the export/)).toBeVisible();
    // One table, one list of misses, and no Proof heading in the summary.
    expect(overview.getByRole("table").elements()).toHaveLength(1);
    expect(overview.getByText("The import.").elements()).toHaveLength(1);
    expect(overview.getByRole("heading", { name: "Proof", level: 2 }).elements()).toHaveLength(0);
  });

  test("offers a practice where it would help, and a dismissed one stays dismissed", async () => {
    const guide: ReviewGuide = { segments: [{ title: "Rename", files: ["src/**"] }] };
    const overview = page.getByRole("region", { name: "Guide overview" });
    const explainOffer = overview.getByRole("complementary", { name: "No explanation yet" });
    await mountApp({
      savedReview: true,
      guide,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    // Without an explanation, the agent can be asked for one. The request
    // waits in the message box; the reader sends it.
    await expect.element(explainOffer).toBeVisible();
    await explainOffer.getByRole("button", { name: "Ask the agent to explain" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await expect
      .element(panel.getByRole("button", { name: "Remove Explain this change" }))
      .toBeVisible();
    await explainOffer.getByRole("button", { name: "Dismiss" }).click();
    // A review without proof has no card for it: nothing takes its place.
    await expect.element(explainOffer).not.toBeInTheDocument();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);

    // Dismissed offers stay dismissed in the next review.
    root?.unmount();
    mount?.remove();
    await mountApp({ savedReview: true, guide });
    await expect.element(overview).toBeVisible();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);
  });

  test("opens on the overview and reads one segment at a time with its comments", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the **export** in two files.",
        segments: [
          {
            title: "Rename alpha",
            area: "core",
            critical: true,
            summary: "The constant becomes `after`.",
            files: ["src/alpha.ts"],
            comments: [
              {
                file: "src/alpha.ts",
                line: 1,
                side: "new",
                kind: "risk",
                body: "Callers still import the `old` name.",
              },
              {
                file: "src/alpha.ts",
                side: "new",
                kind: "note",
                body: "The module keeps one export.",
              },
            ],
          },
          {
            title: "Rename beta",
            summary: "The same rename.",
            files: ["src/beta.ts"],
          },
        ],
      },
    });
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    const overview = page.getByRole("region", { name: "Guide overview" });
    await expect.element(overview.getByText(/^Renames the/)).toBeVisible();
    // The Overview does not repeat the segments: the rail lists them.
    await expect.element(overview.getByText(/^2 segments · 2 comments/)).toBeVisible();
    expect(overview.getByRole("button", { name: /Rename alpha/ }).query()).toBeNull();
    const rail = page.getByRole("navigation", { name: "Guide" });
    await expect
      .element(rail.getByRole("button", { name: "1. Rename alpha, needs care" }))
      .toBeVisible();

    await userEvent.keyboard("j");
    await expect.element(page.getByRole("heading", { name: "Rename alpha" })).toBeVisible();
    // The agent's comment shows its Markdown.
    await expect.element(page.getByText("Callers still import the old name.")).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-guide-note] p code")?.textContent)
      .toBe("old");
    // A comment on the whole file follows the segment's summary.
    await expect.element(page.getByText("On whole files")).toBeVisible();
    await expect.element(page.getByText("The module keeps one export.")).toBeVisible();
    await expect.poll(streamFiles).toEqual([expect.stringContaining("alpha.ts")]);

    await userEvent.keyboard("j");
    await expect.element(page.getByRole("heading", { name: "Rename beta" })).toBeVisible();
    await expect.poll(streamFiles).toEqual([expect.stringContaining("beta.ts")]);
    await userEvent.keyboard("k");
    await expect.poll(streamFiles).toEqual([expect.stringContaining("alpha.ts")]);
  });
  test("where the Guide's rail hides, its parts step in the review's header", async () => {
    await page.viewport(1280, 800);
    localStorage.setItem("med:guide-rail", "closed");
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          { title: "Rename alpha", files: ["src/alpha.ts"] },
          { title: "Rename beta", files: ["src/beta.ts"] },
        ],
      },
    });
    await expect.element(page.getByRole("navigation", { name: "Guide" })).not.toBeInTheDocument();
    const stepper = page.getByRole("group", { name: "Guide parts" });
    await expect.element(stepper).toHaveTextContent("Overview");
    await expect.element(stepper.getByRole("button", { name: "Previous part" })).toBeDisabled();
    await stepper.getByRole("button", { name: "Next part" }).click();
    await expect.element(page.getByRole("heading", { name: "Rename alpha" })).toBeVisible();
    await expect.element(stepper).toHaveTextContent("01 Rename alpha");
    // The part's name is a menu of all the parts.
    await stepper.getByRole("button", { name: "Choose a part" }).click();
    await page.getByRole("menuitemcheckbox", { name: "02 Rename beta" }).click();
    await expect.element(page.getByRole("heading", { name: "Rename beta" })).toBeVisible();
    await expect.element(stepper.getByRole("button", { name: "Next part" })).toBeDisabled();
    // With the rail open again, the header has no stepper.
    localStorage.setItem("med:guide-rail", "open");
    window.dispatchEvent(new StorageEvent("storage", { key: "med:guide-rail" }));
    await expect.element(page.getByRole("navigation", { name: "Guide" })).toBeVisible();
    await expect.element(stepper).not.toBeInTheDocument();
  });

  test("each page keeps its own sidebar: the guide in Review, the changed files in Changes", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          { title: "Rename alpha", files: ["src/alpha.ts"] },
          { title: "Rename beta", files: ["src/beta.ts"] },
        ],
      },
    });
    const guide = page.getByRole("navigation", { name: "Guide" });
    await expect.element(guide).toBeVisible();
    // Its heading hides it, and a button at the start of the review's header
    // shows it again.
    await guide.getByRole("button", { name: "Hide the guide" }).click();
    await expect.element(guide).not.toBeInTheDocument();
    expect(localStorage.getItem("med:guide-rail")).toBe("closed");
    const showGuide = page.getByRole("button", { name: "Show the guide" });
    await expect.element(showGuide).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => document.activeElement).toBe(showGuide.element());
    // The overview takes the room.
    await expect.element(page.getByRole("region", { name: "Guide overview" })).toBeVisible();

    // Changes keeps its own choice: its sidebar still shows, until hidden.
    await page.getByRole("radio", { name: "Changes" }).click();
    const files = page.getByRole("navigation", { name: "Files and commits" });
    await expect.element(files).toBeVisible();
    await files.getByRole("button", { name: "Hide changed files" }).click();
    await expect.element(page.getByRole("button", { name: "Show changed files" })).toBeVisible();
    await expect.element(files).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(files).toBeVisible();
    expect(localStorage.getItem("med:changes-rail")).toBe("open");
    await page.getByRole("radio", { name: "Review" }).click();
    await expect.element(showGuide).toBeVisible();
    expect(guide.query()).toBeNull();

    // Open holds in a review too narrow for "auto", and the shortcut hides it again.
    await page.viewport(700, 800);
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(guide).toBeVisible();
    expect(localStorage.getItem("med:guide-rail")).toBe("open");
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(guide).not.toBeInTheDocument();
    expect(localStorage.getItem("med:guide-rail")).toBe("closed");
  });
});

describe("reading a version by commit and since the last review", () => {
  test("a later hand-off opens on what is new since you looked, which the Overview and the rail show again", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { controller, savedReads, readVersions } = await mountApp({
      savedReview: true,
      versions: 2,
      since: {
        from: 1,
        to: 2,
        basis: "viewed",
        files: [{ path: "src/alpha.ts", change: "changed", target: "target-1" }],
        moved: ["src/beta.ts"],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    // Opening version 2 marks it read: the next version's "since" starts here.
    await expect.poll(readVersions).toEqual([2]);
    await expect.poll(() => controller.getSnapshot().savedReview?.readVersions).toEqual([2]);
    // It opens on only what changed, and names no version.
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
    await expect.element(page.getByText("What changed since you last looked")).toBeVisible();
    await expect
      .element(page.getByText("Changed only with the base, as after a rebase: src/beta.ts"))
      .toBeVisible();
    // The same target, as only its changes: the diff, its texts, and its comments.
    expect(savedReads).toContain("/api/reviews/saved/targets/target-1/review?since=1");
    expect(savedReads).toContain("/api/reviews/saved/targets/target-1/notes?since=1");
    const rail = page.getByRole("navigation", { name: "Guide" });
    const row = rail.getByRole("button", { name: /^New since you looked, 1 file changed/ });
    await expect.element(row).toHaveAttribute("aria-current", "page");
    // Another row of the rail shows the whole version again, and it stays.
    await rail.getByRole("button", { name: "Overview" }).click();
    await expect.element(overview).toBeVisible();
    await expect.poll(() => controller.getSnapshot().savedSince).toBeNull();
    await overview.getByRole("button", { name: "Show only these changes" }).click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
    await rail.getByRole("button", { name: "Overview" }).click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBeNull();
    await row.click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
  });

  test("the Pull request page has no versions note: the review opens on what is new", async () => {
    await mountApp({
      savedReview: true,
      versions: 2,
      since: {
        from: 1,
        to: 2,
        basis: "commented",
        files: [{ path: "src/alpha.ts", change: "changed", target: "target-1" }],
      },
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [],
        conversation: [],
        reviews: [],
      },
    });
    await userEvent.click(page.getByRole("radio", { name: "Pull request" }));
    const live = page.getByRole("region", { name: "Pull request" });
    await expect.element(live.getByRole("heading", { level: 1 })).toBeVisible();
    expect(live.element().textContent).not.toContain("since your last review");
    expect(live.getByRole("button", { name: "Show only these changes" }).query()).toBeNull();
  });

  test("a commit of the range shows the version's comments on its lines, and says how many it cannot show", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { savedReads } = await mountApp({
      savedReview: true,
      rangeCommits: true,
      lens: {
        notes: [
          {
            id: "version-note",
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            text: "From the whole range.",
            createdAt: "2026-09-20T00:00:00Z",
            updatedAt: "2026-09-20T00:00:00Z",
          },
        ],
        hidden: 2,
      },
    });
    await page
      .getByRole("list", { name: "Commits" })
      .getByRole("button", { name: /Add the initial renderer/ })
      .click();
    await expect.element(page.getByText("From the whole range.")).toBeVisible();
    await expect
      .element(page.getByText(/^2 comments are on lines that this commit does not show\./))
      .toBeVisible();
    // The commit's comments come with the version's: the host places them.
    expect(savedReads).toContain(
      `/api/reviews/saved/browsing/${secondCommit}/notes?target=target-0`,
    );
  });

  test("the same commit in Changes shows only its own comments, not the version's", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { controller } = await mountApp({
      savedReview: true,
      rangeCommits: true,
      lens: {
        revision: 4,
        notes: [
          {
            id: "version-note",
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            text: "From the whole range.",
            createdAt: "2026-09-20T00:00:00Z",
            updatedAt: "2026-09-20T00:00:00Z",
          },
        ],
      },
    });
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    const commit = () =>
      page.getByRole("list", { name: "Commits" }).getByRole("button", {
        name: /Add the initial renderer/,
      });
    // Changes list the Review's commits: there, a commit is only itself.
    await changesTab.click();
    await commit().click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    // The same commit in the Review has the version's comments too.
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await page
      .getByRole("list", { name: "Commits" })
      .getByRole("button", { name: /Add the initial renderer/ })
      .click();
    await expect.element(page.getByText("From the whole range.")).toBeVisible();
    // Changes come back on that commit, with its own comments only.
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().inReview).toBe(false);
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect.poll(() => controller.getSnapshot().notes?.notes).toEqual([]);
    await expect.element(page.getByText("From the whole range.")).not.toBeInTheDocument();
  });

  test("a comment that meets a newer revision reads the comments again, and the next one saves", async () => {
    const { controller, savedNotes, savedReads } = await mountApp({
      savedReview: true,
      noteConflict: true,
    });
    await expect.poll(() => controller.getSnapshot().notes?.reviewId).toBe("target-0");
    await controller
      .mutateNote({
        type: "add",
        note: { path: "src/alpha.ts", side: "new", line: 1, text: "First try." },
      })
      .catch(() => {});
    await controller.mutateNote({
      type: "add",
      note: { path: "src/alpha.ts", side: "new", line: 1, text: "Second try." },
    });
    await expect.poll(() => savedNotes.map((note) => note.text)).toContain("Second try.");
    expect(savedReads.filter((read) => read.includes("/notes/notes"))).toEqual([]);
  });
});

describe("review guide comments", () => {
  const guide = {
    summary: "Renames the export.",
    segments: [
      {
        title: "Rename alpha",
        files: ["src/alpha.ts"],
        comments: [
          {
            file: "src/alpha.ts",
            line: 1,
            side: "new" as const,
            kind: "risk" as const,
            body: "Callers still import the old name.",
          },
        ],
      },
    ],
  };

  test("a summary shows a diagram and loads an image from the checkout, in the Overview and in a segment", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: ["Retries back off.", "", "```mermaid", "graph LR", "  A-->B", "```"].join("\n"),
        segments: [
          {
            title: "Rename alpha",
            summary: "The new states:\n\n![Retry states](shots/states.png)",
            files: ["src/alpha.ts"],
          },
        ],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    await expect.element(overview.getByText("Retries back off.")).toBeVisible();
    await expect
      .poll(() => overview.element().querySelector(".med-md-diagram svg"), { timeout: 5000 })
      .not.toBeNull();
    await userEvent.keyboard("j");
    const image = page.getByRole("img", { name: "Retry states" });
    await expect.element(image).toBeInTheDocument();
    await expect.element(image).toHaveAttribute("src");
    const url = new URL((image.element() as HTMLImageElement).src);
    expect(url.pathname).toBe("/api/markdown/image");
    expect(url.searchParams.get("href")).toBe("shots/states.png");
    expect(JSON.parse(url.searchParams.get("source")!)).toMatchObject({ kind: "worktree" });
  });

  test("Reply opens a box under the agent's comment, and Cancel closes it", async () => {
    await page.viewport(1280, 800);
    await mountApp({ savedReview: true, guide });
    await userEvent.keyboard("j");
    await expect.element(page.getByText("Callers still import the old name.")).toBeVisible();
    const card = page.getByRole("article", { name: /comment at R1, read-only/ });
    await userEvent.click(card.getByRole("button", { name: "Reply" }));
    const box = card.getByPlaceholder("Reply…");
    await expect.element(box).toBeVisible();
    await userEvent.click(card.getByRole("button", { name: "Cancel" }));
    await expect.element(box).not.toBeInTheDocument();
  });

  test("a reply shows under the agent's comment, in its card, and keeps what it answers", async () => {
    await page.viewport(1280, 800);
    const { savedNotes } = await mountApp({ savedReview: true, guide });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: /comment at R1, read-only/ });
    await userEvent.click(card.getByRole("button", { name: "Reply" }));
    await card.getByPlaceholder("Reply…").fill("The callers moved in this change.");
    await userEvent.click(card.getByRole("button", { name: "Reply", exact: true }).last());
    const reply = card.getByRole("article", { name: /^Your reply to/ });
    await expect.element(reply.getByText("The callers moved in this change.")).toBeVisible();
    // The agent's words first, then the reply, in one card.
    const words = card.element().textContent!;
    expect(words.indexOf("Callers still import")).toBeLessThan(words.indexOf("The callers moved"));
    expect(document.querySelectorAll("[data-comment-card]")).toHaveLength(2);
    expect(savedNotes).toMatchObject([
      { line: 1, guideComment: { id: "s1-1", text: "Callers still import the old name." } },
    ]);
  });

  test("a note on the agent's lines follows the agent's comment", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide,
      notes: [
        {
          id: "older",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "A note that names no comment.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    await userEvent.keyboard("j");
    await expect.element(page.getByText("A note that names no comment.")).toBeVisible();
    const cards = [...document.querySelectorAll("[data-comment-card]")];
    expect(cards[0]!.textContent).toContain("Callers still import");
    expect(cards[1]!.textContent).toContain("A note that names no comment.");
  });

  test("the agent's answer shows in the comment's thread, and a comment goes to the agent that Med runs from the comment", async () => {
    await page.viewport(1280, 800);
    const comment = {
      path: "src/alpha.ts",
      side: "new" as const,
      line: 2,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      resolution: "active" as const,
    };
    const { agentMessages } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        { ...comment, id: "ask", text: "Why rename it here?" },
        {
          ...comment,
          id: "answer",
          parentId: "ask",
          text: "The old name hid that it retries.",
          author: { agent: "claude", sessionId: "s1" },
        },
        { ...comment, id: "later", line: 1, text: "Keep the old name exported." },
      ],
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await expect.element(asked.getByText("The old name hid that it retries.")).toBeVisible();
    // The answer names its agent, and only the user's words can be edited.
    await expect.element(asked.getByText("Claude", { exact: true })).toBeVisible();
    expect(asked.getByRole("button", { name: "Edit reply" }).query()).toBeNull();
    await expect.element(asked.getByRole("button", { name: "Delete reply" })).toBeInTheDocument();

    const later = page.getByRole("article", { name: "Comment thread at line R1" });
    await later.getByText("Keep the old name exported.").hover();
    await userEvent.click(later.getByRole("button", { name: "Send to Claude" }));
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["later"] });
    await expect.element(later.getByText("· Sent to Claude")).toBeVisible();
    expect(later.getByRole("button", { name: "Send to Claude" }).query()).toBeNull();
    // The other comment waits for its own send.
    await expect.element(asked.getByRole("button", { name: "Send to Claude" })).toBeInTheDocument();
  });

  test("a reply to the agent's answer goes to the agent with its thread", async () => {
    await page.viewport(1280, 800);
    const comment = {
      path: "src/alpha.ts",
      side: "new" as const,
      line: 2,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      resolution: "active" as const,
    };
    const { agentMessages, controller } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        { ...comment, id: "ask", text: "Why rename it here?" },
        {
          ...comment,
          id: "answer",
          parentId: "ask",
          text: "The old name hid that it retries.",
          author: { agent: "claude", sessionId: "s1" },
        },
      ],
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await asked.getByText("The old name hid that it retries.").hover();
    // The answer takes a reply, and the box sends it as it saves.
    await userEvent.click(asked.getByRole("button", { name: "Reply", exact: true }).last());
    await expect.element(asked.getByRole("checkbox", { name: "Send to Claude now" })).toBeChecked();
    await asked.getByRole("textbox", { name: "Reply text" }).fill("Then name it fetchWithRetry.");
    await asked.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(() =>
        controller.getSnapshot().notes?.notes.find((note) => note.text.startsWith("Then name")),
      )
      .toMatchObject({ parentId: "ask" });
    // The thread goes by its first comment, with the reply in it.
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["ask"] });
    await expect.element(asked.getByText("· Sent to Claude")).toBeVisible();
    const text = asked.element().textContent!;
    expect(text.indexOf("Sent to Claude")).toBeGreaterThan(text.indexOf("Then name it"));
  });

  test("a new comment goes to Claude as it is saved while Send to Claude now is ticked", async () => {
    await page.viewport(1280, 800);
    const { agentMessages, controller } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    const write = async (text: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
      await page.getByRole("option", { name: /Find in diff contents/ }).click();
      await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
      await page.getByRole("button", { name: "Next match" }).click();
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.getByRole("textbox", { name: "Review note text" }).fill(text);
    };
    await write("Rename it.");
    const sendNow = page.getByRole("checkbox", { name: "Send to Claude now" });
    await expect.element(sendNow).toBeChecked();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.find((note) => note.text === "Rename it."))
      .toBeTruthy();
    const sent = controller.getSnapshot().notes!.notes.find((note) => note.text === "Rename it.")!;
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: [sent.id] });

    // Not ticked, it waits for Send in the message box.
    await write("Later.");
    await sendNow.click();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.some((note) => note.text === "Later."))
      .toBe(true);
    expect(agentMessages).toHaveLength(1);
    viewSettings.commentsSendNow.set("on");
  });

  test("a comment has no Send when Med does not run the agent", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        {
          id: "ask",
          path: "src/alpha.ts",
          side: "new",
          line: 2,
          text: "Why rename it here?",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
      inbox: { messages: [], elsewhere: { s1: "terminal" }, drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await expect.element(asked.getByText("Why rename it here?")).toBeVisible();
    expect(asked.getByRole("button", { name: /^Send to / }).query()).toBeNull();
  });

  test("a reply to a comment that a later guide replaced says what it answers", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide,
      notes: [
        {
          id: "reply",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "That was fixed.",
          guideComment: { id: "s1-1", author: "Claude", text: "An earlier comment." },
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: "Comment thread at line R1" });
    await expect.element(card.getByText("Claude: An earlier comment.")).toBeVisible();
  });
});

describe("file references in comments", () => {
  /** A comment's link to src/beta.ts:2 opens the file at that line; the
   * unknown src/gone.ts:4 stays text. */
  async function opensBeta(card: ReturnType<typeof page.getByRole>) {
    const link = card.getByRole("link", { name: "Open src/beta.ts at L2" });
    await expect.element(link).toHaveTextContent("beta.tsL2");
    await expect.element(card.getByText(/src\/gone\.ts:4/)).toBeVisible();
    expect(card.getByRole("link", { name: /gone/ }).query()).toBeNull();
    await link.click();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    const editor = page.getByRole("region", { name: "File editor" });
    await expect
      .poll(() =>
        [...editor.element().querySelectorAll(".med-cited-line")].map((line) => line.textContent),
      )
      .toEqual(["export const workingContents = true;"]);
  }

  test("a Med comment links a path in its text", async () => {
    await mountApp({
      notes: [
        {
          id: "mine",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "Compare with src/beta.ts:2; src/gone.ts:4 went away.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    const card = page.getByRole("article", { name: "Comment thread at line R1" });
    await expect.poll(() => card.element().textContent).toMatch(/Compare with beta\.tsL2/);
    await opensBeta(card);
  });

  test("the agent's comment links a path in code", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          {
            title: "Rename alpha",
            files: ["src/alpha.ts"],
            comments: [
              {
                file: "src/alpha.ts",
                line: 1,
                side: "new",
                kind: "risk",
                body: "Callers read `src/beta.ts:2`; `src/gone.ts:4` went away.",
              },
            ],
          },
        ],
      },
    });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: /comment at .*read-only/ });
    await expect.poll(() => card.element().textContent).toMatch(/Callers read beta\.tsL2/);
    await opensBeta(card);
  });

  test("a GitHub comment links a path, and a link to the head's file, but not one to another commit", async () => {
    const at = (id: number, body: string) => ({
      id,
      author: "mira",
      body,
      createdAt: "2026-09-20T00:00:00Z",
      url: `https://github.com/acme/med/pull/7#discussion_r${id}`,
    });
    await mountApp({
      savedReview: true,
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [
          {
            id: 11,
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            startLine: null,
            originalLine: 1,
            comments: [
              at(
                11,
                [
                  "Mirror src/beta.ts#L2; src/gone.ts:4 went away.",
                  `Same as https://github.com/acme/med/blob/${firstCommit}/src/beta.ts#L1-L2,`,
                  `not https://github.com/acme/med/blob/${"b".repeat(40)}/src/beta.ts#L1`,
                  `or https://github.com/other/med/blob/${firstCommit}/src/beta.ts#L2.`,
                  `The guide: https://github.com/acme/med/blob/${firstCommit}/docs/GUIDE.md?plain=1#L1`,
                  "",
                  "```",
                  "src/alpha.ts:1",
                  "```",
                ].join("\n"),
              ),
            ],
          },
        ],
        conversation: [],
        reviews: [],
      },
    });
    const thread = page.getByRole("article", { name: "GitHub thread by mira at R1" });
    await expect.element(thread).toBeVisible();
    await expect
      .element(thread.getByRole("link", { name: "Open src/beta.ts at L1–2" }))
      .toHaveTextContent("beta.tsL1–2");
    // A link to another commit stays a link to GitHub.
    await expect
      .element(thread.getByRole("link", { name: /blob\/b{40}\/src\/beta\.ts#L1$/ }))
      .toHaveAttribute("href", `https://github.com/acme/med/blob/${"b".repeat(40)}/src/beta.ts#L1`);
    // So does a link to another repository; a Markdown file's lines open.
    await expect
      .element(thread.getByRole("link", { name: /github\.com\/other\/med\// }))
      .toBeVisible();
    await expect
      .element(thread.getByRole("link", { name: "Open docs/GUIDE.md at L1" }))
      .toBeVisible();
    // A path in a code block stays code.
    expect(thread.getByRole("link", { name: /alpha/ }).query()).toBeNull();
    await opensBeta(thread);
  });
});

describe("saved reviews", () => {
  test("a thread's Review lists its files and commits, and Changes shows the live changes", async () => {
    await page.viewport(1400, 900);
    const { controller } = await mountApp({
      savedReview: true,
      rangeCommits: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // A Review without a guide opens on the whole diff.
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // Its sidebar lists the files and the range's commits.
    const rail = page.getByRole("navigation", { name: "Files and commits" });
    await expect.element(rail).toBeVisible();
    await expect.element(rail.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const list = rail.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "Whole range" }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: "Whole range" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // Changes are the checkout's live diff: on the base branch, its working
    // changes. Beside their files, they list the commits that the Review covers.
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    expect(controller.getSnapshot().comparison).toEqual({ kind: "working" });
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
    await expect.element(rail).toBeVisible();
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toBeVisible();
    // Its heading hides it, and the choice holds.
    await rail.getByRole("button", { name: "Hide changed files" }).click();
    await expect.element(rail).not.toBeInTheDocument();
    expect(localStorage.getItem("med:changes-rail")).toBe("closed");
    await reviewTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
  });

  test("a pull request's sidebar lists its commits, read ahead so each shows at once", async () => {
    await page.viewport(1400, 900);
    const { controller, requests } = await mountApp({
      savedReview: true,
      rangeCommits: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // The sidebar lists the range's commits at its top, then the files.
    await expect.element(page.getByRole("navigation", { name: "Files and commits" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const list = page.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "Whole range" }))
      .toHaveAttribute("aria-current", "page");
    // While the review is idle, the commits load ahead.
    const commitReads = () =>
      requests
        .filter((comparison) => comparison.kind === "commit")
        .map((c) => "commit" in c && c.commit);
    // They wait for idle time, after the open records the hand-off read.
    await expect.poll(commitReads, { timeout: 5_000 }).toEqual([firstCommit, secondCommit]);
    // A commit picked in the sidebar narrows the Review's diff to it, with no request.
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toHaveAttribute("aria-current", "page");
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    await list.getByRole("button", { name: /Improve the review stream/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: firstCommit });
    expect(commitReads()).toEqual([firstCommit, secondCommit]);
    await list.getByRole("button", { name: "Whole range" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // Changes list the same commits, the ones that the Review covers. A commit
    // picked there shows in Changes, from the read ahead, and All changes
    // comes back to the live diff.
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    expect(list.getByRole("button").elements()).toHaveLength(3);
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    expect(controller.getSnapshot().inReview).toBe(false);
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
    expect(commitReads()).toEqual([firstCommit, secondCommit]);
    await list.getByRole("button", { name: "All changes" }).click();
    await expect.poll(() => controller.getSnapshot().comparison).toEqual({ kind: "working" });
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
  });

  test("a branch's Changes list its own commits in the page's sidebar", async () => {
    await page.viewport(1400, 900);
    const { controller, requests } = await mountApp({ branchCommits: true });
    await controller.selectComparison({ kind: "working", base: "main" });
    const list = page.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: /Improve the review stream/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: firstCommit });
    await expect
      .element(list.getByRole("button", { name: /Improve the review stream/ }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: "All changes" }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "working", base: "main" });
    expect(requests.filter((comparison) => comparison.kind === "commit")).toHaveLength(2);
  });

  test("a Review whose checkout changed offers a refresh or the live Changes", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp({
      savedReview: true,
      versions: 1,
      drift: true,
    });
    // The thread opens on its Overview; the Review's diff has the notice.
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    const bar = page
      .getByRole("status")
      .filter({ hasText: "The checkout changed after this version of the Review" });
    await expect.element(bar).toBeVisible();
    await bar.getByRole("button", { name: "Show Changes" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    expect(controller.getSnapshot().comparison.kind).toBe("working");
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await expect.element(bar).toBeVisible();
    // A refresh captures the worktree again, as a new iteration that matches it.
    await bar.getByRole("button", { name: "Refresh review" }).click();
    await expect.poll(() => controller.getSnapshot().savedTargetId).toBe("target-2");
    await expect.element(bar).not.toBeInTheDocument();
  });

  test("shows GitHub pull request comments apart from local notes; replies and Med comments go into the reader's pending review, which they submit", async () => {
    const comment = (id: number, author: string, body: string) => ({
      id,
      author,
      body,
      createdAt: "2026-09-20T00:00:00Z",
      url: `https://github.com/acme/med/pull/7#discussion_r${id}`,
    });
    const { pullRequestReads, pullRequestWrites, controller } = await mountApp({
      savedReview: true,
      // GitHub as Med reads it after each change: a reply is a draft until
      // the reader submits their review.
      pullRequestWrite: (input, current) => {
        const change = input as { action: string; body?: string };
        if (change.action === "reply")
          return {
            ...current,
            threads: current.threads.map((thread) =>
              thread.id === 11
                ? {
                    ...thread,
                    comments: [
                      ...thread.comments,
                      { ...comment(13, "me", change.body!), draft: true },
                    ],
                  }
                : thread,
            ),
          };
        if (change.action === "submit")
          return {
            ...current,
            threads: current.threads.map((thread) => ({
              ...thread,
              comments: thread.comments.map(({ draft: _draft, ...entry }) => entry),
            })),
            reviews: [
              ...current.reviews,
              { ...comment(42, "me", change.body ?? ""), state: "COMMENTED" },
            ],
          };
        return current;
      },
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [
          {
            id: 11,
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            startLine: null,
            originalLine: 1,
            comments: [
              comment(11, "mira", "Rename `after` to `next`."),
              comment(12, "sam", "Done in the next push."),
            ],
          },
          {
            id: 21,
            path: "src/beta.ts",
            side: "old",
            line: null,
            startLine: null,
            originalLine: 2,
            comments: [comment(21, "mira", "Is this still needed?")],
          },
        ],
        conversation: [comment(31, "sam", "Ready for review.")],
        reviews: [{ ...comment(41, "jordan", ""), state: "APPROVED" }],
      },
    });
    // The title row names the review by its pull request; the browser tab
    // keeps the review's title.
    await expect
      .element(page.getByRole("link", { name: /^Open pull request #\d+: / }))
      .toBeVisible();
    expect(document.title).toBe("Agent review");
    // The thread on the pull request head shows on its line.
    const thread = page.getByRole("article", { name: "GitHub thread by mira at R1" });
    await expect.element(thread).toBeVisible();
    await expect
      .poll(() => thread.element().textContent, { timeout: 10_000 })
      .toMatch(/Rename after to next\..*sam.*Done in the next push/);
    expect(
      thread
        .getByRole("button")
        .elements()
        .map((button) => button.ariaLabel),
    ).toEqual(["Copy thread", "Reply on GitHub"]);
    await expect
      .element(thread.getByRole("link", { name: "Open on GitHub" }))
      .toHaveAttribute("href", "https://github.com/acme/med/pull/7#discussion_r11");
    // A reply goes into the reader's pending review, and shows as Pending.
    await thread.getByRole("button", { name: "Reply on GitHub" }).click();
    await thread.getByRole("textbox", { name: "Reply on GitHub" }).fill("Renamed.");
    await thread.getByRole("button", { name: "Add to review" }).click();
    await expect.poll(() => thread.element().textContent).toMatch(/me\s*Pending.*Renamed\./);
    expect(pullRequestWrites).toEqual([{ action: "reply", thread: 11, body: "Renamed." }]);

    // A Med comment on this version can go there too.
    await controller.mutateNote({
      type: "add",
      note: { path: "src/alpha.ts", side: "new", line: 1, text: "Name it next." },
    });
    const note = page.getByRole("article", { name: "Comment thread at line R1" });
    await note.getByRole("button", { name: "Add to your pending review on GitHub" }).click();
    await expect
      .element(note.getByRole("button", { name: "In your pending review on GitHub" }))
      .toBeVisible();
    expect(pullRequestWrites.at(-1)).toEqual({
      action: "note",
      targetId: "target-0",
      noteId: "saved-note-0",
    });

    // The panel holds the pending review, the conversation, and the thread
    // the diff cannot show.
    await page.getByRole("button", { name: "6 pull request comments" }).click();
    const panel = page.getByRole("dialog", { name: "Pull request comments" });
    await expect.element(panel).toBeVisible();
    const text = panel.element().textContent;
    expect(text).toMatch(/jordan\s*Approved/);
    expect(text).toContain("Ready for review.");
    expect(text).toContain("1 thread shows in the diff.");
    expect(text).toMatch(/src\/beta\.ts\s*L2\s*Outdated.*Is this still needed\?/);
    const pending = panel.getByRole("region", { name: "Your pending review" });
    await expect.element(pending).toMatchTextContent(/1 comment, only you see them/);
    await pending.getByRole("textbox", { name: "Review summary" }).fill("Looks right.");
    await pending.getByRole("button", { name: "Submit comments" }).click();
    await expect.element(pending).not.toBeInTheDocument();
    expect(pullRequestWrites.at(-1)).toEqual({
      action: "submit",
      event: "COMMENT",
      body: "Looks right.",
    });
    await expect.element(panel).toMatchTextContent(/me\s*Reviewed.*Looks right\./);
    await panel.getByRole("button", { name: "Read again from GitHub" }).click();
    await expect.poll(() => pullRequestReads.at(-1)).toBe("?refresh=1");
    expect(pullRequestReads.slice(0, -1).every((search) => search === "")).toBe(true);
  });

  test("⌘⇧B shows and hides the agent session", async () => {
    await mountApp({ savedReview: true });
    // While the pane hides, the review's Expand is Restore, which shows it.
    const session = page.getByRole("button", { name: "Show agent session" });
    const pane = page.getByRole("region", { name: "Agent session" });
    await expect.element(session).toBeVisible();
    await userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    await expect.element(pane).toBeVisible();
    await expect.element(session).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    await expect
      .poll(() => document.querySelector('[data-pane="session"]')?.checkVisibility() ?? false)
      .toBe(false);
    await expect.element(session).toBeVisible();

    // A session behind the expanded review shows at one press.
    await userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    await expect.element(pane).toBeVisible();
    await page.getByRole("button", { name: "Expand review" }).click();
    await expect
      .poll(() => document.querySelector('[data-pane="session"]')?.hasAttribute("inert"))
      .toBe(true);
    await userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    await expect
      .poll(() => document.querySelector('[data-pane="session"]')?.hasAttribute("inert"))
      .toBe(false);
    await expect.element(pane).toBeVisible();
    expect(document.querySelector('[data-pane="review"]')?.checkVisibility()).toBe(true);
  });

  test("shows Codex review findings read-only, at their lines or in the Codex panel", async () => {
    const finding = (id: string, path: string, line: number, priority: number, title: string) => ({
      id,
      title,
      body: `Because ${title.toLowerCase()}.`,
      priority,
      confidence: 0.9,
      path,
      startLine: line,
      endLine: line,
    });
    const run = (id: string, commit: string, findings: ReturnType<typeof finding>[]) => ({
      id,
      threadId: id.split(":")[0]!,
      repo: "/test/repo",
      commit,
      createdAt: "2026-09-20T00:00:00Z",
      target: "changes against 'main'",
      verdict: "patch is incorrect",
      explanation: "The exporter reads a field that trails do not have.",
      findings,
    });
    await mountApp({
      savedReview: true,
      codexReviews: [
        run("t1:0", firstCommit, [
          finding("t1:0:0", "src/alpha.ts", 1, 1, "Use the existing field"),
          finding("t1:0:1", "src/beta.ts", 40, 3, "Name the constant"),
        ]),
        run("t0:0", secondCommit, [finding("t0:0:0", "src/alpha.ts", 1, 2, "An older finding")]),
      ],
    });
    // The finding of the commit on screen shows on its line, with no way to write.
    const card = page.getByRole("article", {
      name: "Codex finding at R1, read-only",
    });
    await expect.element(card).toBeVisible();
    expect(card.element().textContent).toMatch(
      /Codex\s*P1.*Use the existing field.*Because use the existing field\./,
    );
    expect(card.element().querySelector("textarea, [contenteditable]")).toBeNull();
    expect(document.querySelectorAll("[data-codex-finding]")).toHaveLength(1);

    // The panel holds each verdict, and the findings the diff cannot show.
    await page.getByRole("button", { name: "3 Codex findings" }).click();
    const panel = page.getByRole("dialog", { name: "Codex reviews" });
    await expect.element(panel).toBeVisible();
    const text = panel.element().textContent;
    expect(text).toMatch(/Codex\s*Patch is incorrect.*The exporter reads a field/);
    expect(text).toContain("1 finding shows in the diff.");
    expect(text).toMatch(/src\/beta\.ts\s*R40.*P3.*Name the constant/);
    expect(text).toContain(
      `Lines refer to ${secondCommit.slice(0, 7)}, the commit that Codex reviewed. This comparison shows ${firstCommit.slice(0, 7)}, so they are listed here.`,
    );
    expect(text).toContain("An older finding");
  });
});

test("collapses every file from ⌘K, then expands them again", async () => {
  await mountApp();
  const header = (action: string, path: string) =>
    page.getByRole("button", { name: `${action} ${path}`, exact: true });
  const command = async (name: string) => {
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  };
  await expect.element(header("Collapse", "src/alpha.ts")).toBeVisible();
  await command("Collapse all files");
  await expect.element(header("Expand", "src/alpha.ts")).toBeVisible();
  await expect.element(header("Expand", "src/beta.ts")).toBeVisible();
  // One open file is enough to collapse all again.
  await header("Expand", "src/beta.ts").click();
  await command("Collapse all files");
  await command("Expand all files");
  await expect.element(header("Collapse", "src/alpha.ts")).toBeVisible();
  await expect.element(header("Collapse", "src/beta.ts")).toBeVisible();
});

describe("agent session", () => {
  test("a saved review shows its agent's session beside the review and opens files from it", async () => {
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Rename the export in /test/repo/src/beta.ts:2." },
        },
      },
      {
        at: 1000,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Run the tests",
          kind: "execute",
          status: "completed",
          rawInput: { command: "bun test" },
        },
      },
      {
        at: 2000,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Renamed in [alpha.ts:1](src/alpha.ts:1) and `/test/repo/src/beta.ts:1-2`; `src/gone.ts:3` and `bun test` are not files.",
          },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await expect.element(panel.getByText(/Rename the export in/)).toBeVisible();
    // The finished turn's work folds into one row, which opens it in place.
    // The pane has no menu or status of its own: the title band names the thread.
    const worked = panel.getByRole("button", { name: "Worked for 2s · 1 tool call" });
    await expect.element(worked).toBeVisible();
    expect(panel.getByRole("button", { name: /Run the tests/ }).query()).toBeNull();
    await worked.click();
    await expect.element(panel.getByRole("button", { name: /Run the tests/ })).toBeVisible();
    expect(panel.getByRole("button", { name: /session menu|sessions$/ }).query()).toBeNull();
    expect(panel.getByText("Idle", { exact: true }).query()).toBeNull();

    // Each reference to a file of the checkout is a link with the file's name
    // and lines: a Markdown link, inline code, an absolute path, and a path in
    // the prompt. Text that names no file stays as it is.
    const alpha = panel.getByRole("link", { name: "Open src/alpha.ts at L1" });
    await expect.element(alpha).toHaveTextContent("alpha.tsL1");
    const beta = panel.getByRole("link", { name: "Open src/beta.ts at L1–2" });
    await expect.element(beta).toHaveTextContent("beta.tsL1–2");
    await expect.element(beta).toHaveAttribute("data-tooltip", "src/beta.ts:1–2");
    const prompted = panel.getByRole("button", { name: "Open src/beta.ts at L2" });
    await expect.element(prompted).toHaveTextContent("beta.tsL2");
    await expect.element(panel.getByText("src/gone.ts:3", { exact: true })).toBeVisible();
    expect(panel.getByRole("link", { name: /gone|bun test/ }).query()).toBeNull();

    // A range opens its file at its first line with the range marked; a
    // second link to the open file goes to its own line.
    await beta.click();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    const editor = page.getByRole("region", { name: "File editor" });
    const cited = () =>
      [...editor.element().querySelectorAll(".med-cited-line")].map((line) => line.textContent);
    await expect
      .poll(cited)
      .toEqual(['export const workspace = "/test/repo";', "export const workingContents = true;"]);
    await prompted.click();
    await expect.poll(cited).toEqual(["export const workingContents = true;"]);
    await alpha.click();
    await expect.element(page.getByRole("tab", { name: "alpha.ts", exact: true })).toBeVisible();
    await expect.poll(() => editor.element().querySelectorAll(".med-cited-line").length).toBe(1);
    // A link's tab is a tab like any other: closing it shows the one before.
    await page.getByRole("button", { name: "Close src/alpha.ts" }).click();
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Close src/beta.ts" }).click();
    await expect
      .element(page.getByRole("radio", { name: "Review", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    // Hiding the pane (⌘⇧B) leaves the agent at work; the review's Restore shows it again.
    await userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show agent session" }).click();
    await expect.element(panel).toBeVisible();
  });

  test("a saved review prepares its session out of view, so the pane opens with its thread", async () => {
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Rename the export." },
        },
      },
      {
        at: 2000,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Renamed **alpha** in `src/alpha.ts`.",
          },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    const panel = page.getByRole("region", { name: "Agent session" });
    // Once the review is idle, the thread streams and renders in a hidden pane.
    await expect
      .poll(() => document.querySelector('[aria-label="Session"]')?.textContent ?? "")
      .toContain("Rename the export.");
    await expect.element(panel).not.toBeInTheDocument();
    await expect
      .poll(() => document.querySelector('[aria-label="Session"] [data-unit] strong')?.textContent)
      .toBe("alpha");

    await page.getByRole("button", { name: "Show agent session" }).click();
    expect(panel.getByText("Rename the export.").element()).toBeVisible();
    expect(panel.getByText("alpha", { exact: true }).element()).toBeVisible();
  });

  test("a long session loads its earlier work, and { and } step through its prompts", async () => {
    const chunk = (at: number, kind: string, text: string) => ({
      at,
      update: { sessionUpdate: kind, content: { type: "text", text } },
    });
    // The tail starts after the build call; its result is in the tail.
    const tail = [
      {
        at: 5000,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "early",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "built" } }],
        },
      },
      chunk(6000, "user_message_chunk", "Second prompt"),
      chunk(7000, "agent_message_chunk", "Both builds pass."),
    ];
    const earlier = [
      chunk(0, "user_message_chunk", "First prompt"),
      {
        at: 1000,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "early",
          title: "Build the app",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "bun run build" },
        },
      },
    ];
    const { pageReads } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: tail, idle: true, modifiedAt: 0, truncated: true, start: 4096 })}\n\n`,
      sessionPages: {
        page: { events: earlier, start: 0 },
        turns: [
          { offset: 0, at: 0, text: "First prompt" },
          { offset: 4200, at: 6000, text: "Second prompt" },
        ],
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    // A short thread reaches its top at once, so the earlier page loads.
    await expect.element(panel.getByText("First prompt")).toBeVisible();
    expect(pageReads).toEqual(["4096"]);
    // The result that came first now completes its call: one row, with its
    // title, in the first turn's folded work.
    await panel.getByRole("button", { name: /^Worked for/ }).click();
    const build = panel.getByRole("button", { name: /Build the app/ });
    await expect.element(build).toBeVisible();
    expect(document.querySelectorAll('[aria-label="Session"] [data-unit="early"]')).toHaveLength(1);
    await expect
      .element(panel.getByRole("button", { name: "Load earlier work" }))
      .not.toBeInTheDocument();

    await expect
      .element(panel.getByText("The session is long", { exact: false }))
      .not.toBeInTheDocument();

    // The thread has no list of its prompts: { and } step through them, as
    // [ and ] through every message.
    await expect
      .element(panel.getByRole("navigation", { name: "Prompts" }))
      .not.toBeInTheDocument();
    const current = () =>
      document.querySelector<HTMLElement>('[data-message="user"][data-current]')?.textContent;
    panel.element().querySelector<HTMLElement>("[data-message-keys]")!.focus();
    await userEvent.keyboard("{{");
    await expect.poll(current).toContain("Second prompt");
    await userEvent.keyboard("{{");
    await expect.poll(current).toContain("First prompt");
    await userEvent.keyboard("}");
    await expect.poll(current).toContain("Second prompt");
  });

  test("the header shows the thread's context and spend, and a click shows where they come from", async () => {
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      usage: {
        context: {
          sessionId: "s1",
          agent: "claude",
          model: "claude-opus-5-5",
          used: 312_932,
          window: 1_000_000,
          windowFrom: "model",
          compaction: {
            at: 500_000,
            from: "modelSettings in ~/.claude/settings.json",
            approximate: false,
          },
          compacted: false,
        },
        spend: {
          total: 230.62,
          subagents: { count: 4, cost: 40.44 },
          models: [
            {
              model: "claude-opus-5-5",
              requests: 812,
              input: 41_000,
              output: 690_000,
              cacheWrite5m: 0,
              cacheWrite1h: 3_100_000,
              cacheRead: 410_000_000,
              webSearches: 0,
              cost: 230.62,
            },
            {
              model: "gpt-test",
              requests: 1,
              input: 1000,
              output: 300,
              cacheWrite5m: 0,
              cacheWrite1h: 0,
              cacheRead: 4000,
              webSearches: 0,
              cost: null,
            },
          ],
          missing: [],
        },
        prices: {
          version: 1,
          source: "https://platform.claude.com/docs/en/about-claude/pricing",
          readAt: "2026-10-29",
          openai: {
            source: "https://developers.openai.com/api/docs/pricing",
            readAt: "2026-10-29",
          },
        },
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    // The chip is under the message box, at its end, as in Claude Desktop;
    // its name says its figures.
    const chip = panel.getByRole("button", { name: "Context 31% full, $230.62 spent" });
    await expect.element(chip).toMatchTextContent("$230.62");
    const form = panel.getByRole("form", { name: "Message Claude" }).element();
    expect(chip.element().getBoundingClientRect().top).toBeGreaterThan(
      form.getBoundingClientRect().bottom - 1,
    );
    expect(
      document.querySelector('[aria-label="Workspace"]')?.contains(chip.element()) ?? false,
    ).toBe(false);

    // Its popover is the gist: one bar and a line, then each model's cost.
    await userEvent.click(chip);
    const context = page.getByRole("region", { name: "Context" });
    await expect
      .element(context.getByRole("meter", { name: "Context in use" }))
      .toHaveAttribute("aria-valuenow", "312932");
    await expect.element(context).toMatchTextContent("31% · 313k of 1M");
    await expect
      .element(context.getByText("Compacts at 500k"))
      .toHaveAttribute("title", "modelSettings in ~/.claude/settings.json");
    const spend = page.getByRole("region", { name: "Spend" });
    await expect.element(spend.getByText("$40.44 by 4 subagents")).toBeVisible();
    await expect.element(spend.getByText("Opus 5.5", { exact: true })).toBeVisible();
    expect(spend.getByRole("table").query()).toBeNull();
    // A model without a price says so, and the total leaves it out.
    await expect.element(spend.getByText("No price", { exact: true })).toBeVisible();
    await expect.element(spend.getByText("No price for gpt-test: not in the total.")).toBeVisible();
    // The note is one line: the date of the prices, and their sources.
    await expect
      .element(spend.getByText("List prices of 2026-10-29: Anthropic, OpenAI."))
      .toBeVisible();
    await expect
      .element(spend.getByRole("link", { name: "Anthropic" }))
      .toHaveAttribute("href", "https://platform.claude.com/docs/en/about-claude/pricing");
    await expect
      .element(spend.getByRole("link", { name: "OpenAI" }))
      .toHaveAttribute("href", "https://developers.openai.com/api/docs/pricing");
  });

  test("a wide session pane shows the session rail, which the reader closes and opens again", async () => {
    // Room for the session rail, with the thread's column under its widest.
    await page.viewport(2200, 900);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [],
        conversation: [],
        reviews: [],
      },
      usage: {
        context: {
          sessionId: "s1",
          agent: "claude",
          model: "claude-opus-5-5",
          used: 312_932,
          window: 1_000_000,
          windowFrom: "model",
          compaction: {
            at: 500_000,
            from: "modelSettings in ~/.claude/settings.json",
            approximate: false,
          },
          compacted: false,
        },
        spend: {
          total: 230.62,
          subagents: { count: 4, cost: 40.44 },
          models: [
            {
              model: "claude-opus-5-5",
              requests: 812,
              input: 41_000,
              output: 690_000,
              cacheWrite5m: 0,
              cacheWrite1h: 3_100_000,
              cacheRead: 410_000_000,
              webSearches: 0,
              cost: 230.62,
            },
            {
              model: "gpt-test",
              requests: 1,
              input: 1000,
              output: 300,
              cacheWrite5m: 0,
              cacheWrite1h: 0,
              cacheRead: 4000,
              webSearches: 0,
              cost: null,
            },
          ],
          missing: [],
        },
        prices: {
          version: 1,
          source: "https://platform.claude.com/docs/en/about-claude/pricing",
          readAt: "2026-10-29",
        },
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const pane = page.getByRole("region", { name: "Agent session" });
    const side = pane.getByRole("complementary", { name: "Session rail" });
    await expect.element(side).toBeVisible();
    // Beside the panel, the thread's column takes the room that is left: the
    // message box is that room less its 12 pixel sides, and once it is over
    // the thread, less the thread's 12 pixel scroll bar, which it leaves in
    // view.
    const box = () =>
      pane.getByRole("form", { name: "Message Claude" }).element().getBoundingClientRect().width;
    const room = () =>
      pane.element().getBoundingClientRect().width - side.element().getBoundingClientRect().width;
    await expect
      .poll(() => [24, 36].some((less) => Math.abs(room() - less - box()) < 0.5))
      .toBe(true);
    const context = side.getByRole("region", { name: "Context" });
    // Context starts folded, with its share; its title unfolds it in place.
    await expect.element(context).toMatchTextContent(/^Context31%$/);
    await context.getByRole("button", { name: "Context" }).click();
    await expect.element(context).toMatchTextContent(/^Context31% used312\.9k \/ 1M/);
    await expect.element(context.getByText("Autocompact at 500k")).toBeVisible();
    await context.getByRole("button", { name: "Context" }).click();
    // Spend starts folded, with its total; its title unfolds it in place.
    const spend = side.getByRole("region", { name: "Spend" });
    await expect.element(spend).toMatchTextContent(/^Spend\$230\.62$/);
    await spend.getByRole("button", { name: "Spend" }).click();
    await expect.element(spend.getByText("$40.44 by 4 subagents")).toBeVisible();
    await expect.element(spend.getByText("Opus 5.5")).toBeVisible();
    await expect.element(spend.getByText("41k in · 690k out", { exact: false })).toBeVisible();
    await spend.getByRole("button", { name: "Spend" }).click();
    await expect.element(spend.getByText("Opus 5.5")).not.toBeInTheDocument();
    // The pull request has its own section; its row opens its page in Med,
    // which links to GitHub.
    const pulls = side.getByRole("region", { name: "Pull requests" });
    await pulls.getByRole("button", { name: /^Read pull request threads/ }).click();
    await expect
      .element(page.getByRole("radio", { name: "Pull request" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(side.getByRole("region", { name: "Agent" })).toMatchTextContent(/Claude/);
    // Context and spend stay under the message box beside the rail too.
    await expect.element(pane.getByRole("button", { name: /^Context \d+% full/ })).toBeVisible();

    await pane.getByRole("button", { name: "Hide session rail" }).click();
    await expect.element(side).not.toBeInTheDocument();
    expect(localStorage.getItem("med:session-panel")).toBe("closed");
    await expect.element(pane.getByRole("button", { name: /^Context \d+% full/ })).toBeVisible();
    // Without it, the column is Claude Desktop's 768 pixels of text and the
    // thread's 22 pixel sides.
    await expect.poll(box).toBeCloseTo(768 + 44 - 24, 0);
    await userEvent.keyboard("{Control>}{Alt>}{Shift>}b{/Shift}{/Alt}{/Control}");
    await expect.element(side).toBeVisible();
    expect(localStorage.getItem("med:session-panel")).toBe("auto");

    // A pane without room for the column and the panel has neither the panel nor its button.
    await page.viewport(1100, 900);
    await expect.element(side).not.toBeInTheDocument();
    await expect
      .element(pane.getByRole("button", { name: /session rail/ }))
      .not.toBeInTheDocument();
  });

  test("@ names a file or a vault's note, and the agent gets its absolute path", async () => {
    const { agentMessages } = await mountApp({
      savedReview: true,
      vault: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    const input = panel.getByRole("combobox", { name: "Message Claude" });
    await input.click();
    await userEvent.keyboard("Read @alp");
    const mentions = panel.getByRole("listbox", { name: "Mentions" });
    await expect
      .element(
        mentions.getByRole("group", { name: "Files" }).getByRole("option", { name: /alpha\.ts/ }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Enter}and @plan");
    await expect
      .element(
        mentions.getByRole("group", { name: "Notes" }).getByRole("option", { name: /Plan\.md/ }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(mentions).not.toBeInTheDocument();
    // The box keeps short tokens, marked as chips.
    await expect.element(input).toHaveValue("Read @alpha.ts and @Plan.md ");
    expect([...document.querySelectorAll("form mark")].map((mark) => mark.textContent)).toEqual([
      "@alpha.ts",
      "@Plan.md",
    ]);
    // Escape keeps a typed @ as text.
    await userEvent.keyboard("@be");
    await expect.element(mentions).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(mentions).not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages)
      .toMatchObject([
        { text: "Read /test/repo/src/alpha.ts and /test/notes/Projects/Plan.md @be" },
      ]);
  });
  test("comments go to the agent from the review, which Med resumes with them", async () => {
    const reply = (at: number, sessionUpdate: string, text: string) => ({
      at,
      update: { sessionUpdate, content: { type: "text", text } },
    });
    const { agentMessages, agentAnswers } = await mountApp({
      savedReview: true,
      answerAgentMessages: true,
      notes: [
        {
          id: "n1",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "Rename it.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
        },
      ],
      session: `event: reset\ndata: ${JSON.stringify({ events: [reply(1000, "user_message_chunk", "Check the durations."), reply(5000, "agent_message_chunk", "They read in seconds.")], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      // The saved comment n1 is a draft too, as the host makes it one.
      inbox: {
        messages: [],
        drafts: [
          {
            id: "n2",
            path: "src/beta.ts",
            line: 2,
            text: "Keep this one.",
            replies: 0,
          },
        ],
      },
    });
    // The comments go from the session's message box.
    expect(page.getByRole("button", { name: /^Send comments to/ }).query()).toBeNull();
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });

    // The comments wait above the message box as one line, to send on their own.
    await expect.element(panel.getByRole("button", { name: "Send 2 comments" })).toBeVisible();
    // Choose one of the two comments, then write and send.
    await panel.getByRole("button", { name: "2 comments" }).click();
    await panel.getByRole("checkbox", { name: /beta\.ts:2/ }).click();
    await expect.element(panel.getByRole("button", { name: "1 of 2 comments" })).toBeVisible();
    // A comment's file and text show it at its line in the diff, from Commit.
    await page.getByRole("radio", { name: "Commit" }).click();
    await panel.getByRole("button", { name: /^alpha\.ts:1\s*Rename it\./ }).click();
    // This review has no guide, so its diff is the Review page.
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(panel.getByRole("button", { name: "Send 1 comment" })).toBeVisible();
    await panel.getByRole("combobox", { name: "Message Claude" }).fill("Use minutes.");
    // With a message, the box's own Send takes both.
    await expect
      .element(panel.getByRole("button", { name: "Send 1 comment" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    // The message and its comment show at once, before the host answers, and
    // the composer is ready for the next one. The turn before keeps its time.
    await expect.element(panel.getByText("Use minutes.")).toBeVisible();
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    await expect.element(panel.getByText("Rename it.")).toBeVisible();
    await expect.element(panel.getByRole("combobox", { name: "Message Claude" })).toHaveValue("");
    await expect.element(panel.getByRole("button", { name: "1 comment" })).toBeVisible();
    expect(panel.element().textContent).not.toMatch(/Worked for -/);

    // A send that fails stays, and goes again with the same ID.
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => agentAnswers.length).toBe(1);
    // The message keeps its row as the host takes it.
    const row = () => panel.getByText("Use minutes.").element().closest<HTMLElement>("[data-unit]");
    const sending = row();
    let left = false;
    const watch = new MutationObserver(() => {
      if (!sending?.isConnected) left = true;
    });
    watch.observe(panel.element(), { childList: true, subtree: true });
    agentAnswers.shift()!();
    await expect
      .poll(() => agentMessages)
      .toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          thread: "claude-s1",
          text: "Use minutes.",
          noteIds: ["n1"],
          attachments: [],
          images: [],
        },
      ]);
    // Claude took it: the thread goes on below it, without a status.
    await expect.element(panel.getByText("Sending…")).not.toBeInTheDocument();
    await expect.element(panel.getByText("Not sent", { exact: false })).not.toBeInTheDocument();
    expect(panel.getByText("Use minutes.").elements()).toHaveLength(1);
    watch.disconnect();
    expect(left).toBe(false);
    expect(row()).toBe(sending);
    expect(sending!.dataset.rise).toBeUndefined();

    // The comment left over goes on its own, from its line.
    await panel.getByRole("button", { name: "Send 1 comment" }).click();
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!();
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["n2"] });
  });

  test("the message box clears its comments: one, or all, each after asking", async () => {
    const draft = (id: string, path: string, text: string) => ({
      id,
      path,
      line: 1,
      text,
      replies: 0,
    });
    const { deletedComments, agentMessages } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: {
        messages: [],
        drafts: [
          draft("c1", "src/alpha.ts", "Rename it."),
          draft("c2", "src/beta.ts", "Keep this one."),
          draft("c3", "src/gamma.ts", "Old note."),
        ],
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await panel.getByRole("button", { name: "3 comments" }).click();

    // A comment's Delete asks first; Escape keeps it.
    const remove = panel.getByRole("button", { name: "Delete the comment on alpha.ts:1" });
    await remove.click();
    const confirm = panel.getByRole("button", { name: "Confirm delete the comment on alpha.ts:1" });
    await expect.element(confirm).toHaveTextContent("Delete");
    await userEvent.keyboard("{Escape}");
    await expect.element(remove).toBeVisible();
    expect(deletedComments).toEqual([]);
    // The second click deletes it, from the review too.
    await remove.click();
    await confirm.click();
    await expect.element(panel.getByRole("button", { name: "2 comments" })).toBeVisible();
    await expect.element(panel.getByText("Rename it.")).not.toBeInTheDocument();
    expect(deletedComments).toEqual([["c1"]]);

    // Delete all says how many, then clears the box.
    const all = panel.getByRole("button", { name: "Delete all" });
    await all.click();
    await panel.getByRole("button", { name: "Delete 2 comments" }).click();
    expect(deletedComments.at(-1)).toEqual(["c2", "c3"]);
    await expect.element(panel.getByRole("button", { name: /comments?$/ })).not.toBeInTheDocument();
    await expect
      .element(panel.getByRole("list", { name: "Comments to send" }))
      .not.toBeInTheDocument();
    expect(agentMessages).toEqual([]);
  });

  test("a draft and the messages that Med did not take stay after a reload", async () => {
    const options = {
      savedReview: true,
      answerAgentMessages: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    };
    const panel = page.getByRole("region", { name: "Agent session" });
    const input = panel.getByRole("combobox", { name: "Message Claude" });
    const reload = async () => {
      root?.unmount();
      mount?.remove();
      const app = await mountApp(options);
      if (!panel.query()) await page.getByRole("button", { name: "Show agent session" }).click();
      await expect.element(input).toBeVisible();
      return app;
    };
    let app = await reload();
    await input.fill("Use minutes.");
    app = await reload();
    await expect.element(input).toHaveValue("Use minutes.");

    // A message on its way when the page closes goes again after the reload.
    await input.click();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => app.agentAnswers.length).toBe(1);
    const onTheWay = Object.entries(localStorage).filter(([key]) => key.startsWith("med:outbox:"));
    expect(onTheWay).toHaveLength(1);
    app.agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    for (const [key, value] of onTheWay) localStorage.setItem(key, value);
    app = await reload();
    await expect.element(input).toHaveValue("");
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    await expect.poll(() => app.agentAnswers.length).toBe(1);

    // One that failed comes back with its reason and Retry.
    app.agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    app = await reload();
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => app.agentAnswers.length).toBe(1);
    app.agentAnswers.shift()!();
    await expect
      .poll(() => app.agentMessages)
      .toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          thread: "claude-s1",
          text: "Use minutes.",
          noteIds: [],
          attachments: [],
          images: [],
        },
      ]);
    await expect.element(panel.getByText("Not sent", { exact: false })).not.toBeInTheDocument();
    expect(panel.getByText("Use minutes.").elements()).toHaveLength(1);
  });

  test("a message waits while Med does not answer, and goes when Med is back", async () => {
    const { agentMessages, agentAnswers } = await mountApp({
      savedReview: true,
      answerAgentMessages: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await panel.getByRole("combobox", { name: "Message Claude" }).fill("Use minutes.");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!(NO_ANSWER);
    // The page tries again by itself; the message stays Sending meanwhile.
    await expect.poll(() => agentAnswers.length).toBe(1);
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    expect(panel.getByText("Not sent", { exact: false }).query()).toBeNull();
    agentAnswers.shift()!();
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Use minutes." }]);
    await expect.element(panel.getByText("Sending…")).not.toBeInTheDocument();
  });

  test("a session open in a terminal says so in one line with no box, and Fork in Med forks it", async () => {
    await page.viewport(1280, 800);
    const reply = (at: number, sessionUpdate: string, text: string) => ({
      at,
      update: { sessionUpdate, content: { type: "text", text } },
    });
    const { agentMessages, ownedStarts } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [reply(1000, "user_message_chunk", "Check the durations."), reply(5000, "agent_message_chunk", "They read in seconds.")], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], elsewhere: { s1: "terminal" }, drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    // One line says where the session runs, with the sentence in its tooltip;
    // there is no box, and Med sends nothing there.
    const line = page.getByRole("group", { name: "Claude session in a terminal" });
    const where = line.getByText("In a terminal", { exact: true });
    await expect.element(where).toBeVisible();
    await expect
      .element(where.element().parentElement!)
      .toHaveAttribute(
        "data-tooltip",
        "Claude has this session open in a terminal. Med can't type there.",
      );
    await expect
      .element(page.getByRole("form", { name: "Message Claude" }))
      .not.toBeInTheDocument();
    expect(agentMessages).toEqual([]);

    // ⌘K offers Fork in Med for the thread.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Fork in Med");
    await expect.element(page.getByRole("option", { name: /^Fork in Med/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // Fork in Med forks the session; the thread follows the fork, and the
    // box opens on it.
    await userEvent.click(line.getByRole("button", { name: "Fork in Med" }));
    await expect.poll(() => ownedStarts).toEqual([{ preset: "claude", fork: "s1" }]);
    const composer = page.getByRole("form", { name: "Message Claude" });
    await expect.element(composer.getByText("Starting Claude…")).toBeVisible();
    await expect.element(line).not.toBeInTheDocument();
  });

  test.each([
    { place: "claude-app" as const, where: "in the Claude app" },
    { place: "other-app" as const, where: "in another app" },
  ])("a session open in $place says where, and offers Fork in Med", async ({ place, where }) => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], elsewhere: { s1: place }, drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const line = page.getByRole("group", { name: `Claude session ${where}` });
    const named = line.getByText(where.replace(/^in/, "In"), { exact: true });
    await expect.element(named).toBeVisible();
    expect(named.element().parentElement!.getAttribute("data-tooltip")).toBe(
      `Claude has this session open ${where}. Med can't type there.`,
    );
    await expect.element(line.getByRole("button", { name: "Fork in Med" })).toBeVisible();
    expect(page.getByRole("combobox", { name: "Message Claude" }).query()).toBeNull();
  });

  test("a saved review starts an agent in the Session pane, and the composer drives it", async () => {
    await page.viewport(1280, 800);
    const { setOwned, ownedActions, agentMessages } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [
        { id: "claude", name: "Claude Code", kind: "claude", available: true },
        { id: "opencode", name: "OpenCode", kind: "acp", available: false },
      ],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const start = page.getByRole("region", { name: "Start a session" });
    await expect.element(start.getByRole("button", { name: /OpenCode/ })).toBeDisabled();
    await userEvent.click(start.getByRole("button", { name: /Claude Code/ }));
    const composer = page.getByRole("form", { name: "Message Claude" });
    await expect.element(composer.getByText("Starting Claude…")).toBeVisible();

    setOwned({
      status: "idle",
      settings: [
        {
          id: "model",
          name: "Model",
          category: "model",
          value: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "haiku", name: "Haiku" },
          ],
        },
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          value: "default",
          options: [
            { value: "default", name: "Ask" },
            { value: "plan", name: "Plan" },
          ],
        },
      ],
      commands: [{ name: "review", description: "Review the current changes" }],
      context: { used: 40_000, total: 200_000 },
    });
    // Before the transcript has a request, the header shows what the runner reports.
    await expect.element(page.getByRole("button", { name: /^Context 20% full/ })).toBeVisible();
    // Model, effort, and mode are pickers, not commands. With two models, a
    // click switches to the other.
    // They are under the message box, as in Claude Desktop.
    const model = page.getByRole("button", { name: "Model: Default" });
    expect(composer.element().contains(model.element())).toBe(false);
    await userEvent.click(model);
    await expect.element(page.getByRole("button", { name: "Model: Haiku" })).toBeVisible();
    expect(ownedActions).toContainEqual({
      action: "setting",
      id: "model",
      value: "haiku",
    });

    // `/` lists the agent's own commands; Enter completes one.
    const input = composer.getByRole("combobox", { name: "Message Claude" });
    await userEvent.click(input);
    await userEvent.keyboard("/rev");
    await expect.element(composer.getByRole("option", { name: /\/review/ })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveValue("/review ");
    await userEvent.keyboard("the durations{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages).toMatchObject([{ text: "/review the durations" }]);

    // A pasted image goes with the next message to an agent that takes images.
    setOwned({ images: true });
    await expect.element(composer.getByRole("button", { name: "Add images" })).toBeVisible();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "shot.png", {
        type: "image/png",
      }),
    );
    input.element().dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
      }),
    );
    const images = composer.getByRole("list", { name: "Images to send" });
    // A click on the thumbnail shows the image at full size.
    await images.getByRole("button", { name: "Show attachment 1" }).click();
    const viewer = page.getByRole("dialog", { name: "Image" });
    await expect.element(viewer).toBeVisible();
    expect(viewer.element().querySelector("img")?.getAttribute("src")).toContain(png);
    await userEvent.keyboard("{Escape}");
    await expect.element(viewer).not.toBeInTheDocument();
    await userEvent.click(input);
    await userEvent.keyboard("Why?{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({
        text: "Why?",
        images: [{ mimeType: "image/png", data: png }],
      });
    await expect.element(images).not.toBeInTheDocument();

    // A tool call waits for an answer; while the agent works, Send becomes Stop.
    setOwned({
      status: "working",
      permission: {
        id: "ask-1",
        title: "Claude Code wants to use Edit",
        detail: "src/alpha.ts",
        options: [
          { id: "allow", name: "Allow", kind: "allow_once" },
          { id: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    const ask = page.getByRole("group", { name: "Permission request" });
    await expect.element(ask.getByText("src/alpha.ts")).toBeVisible();
    await userEvent.click(ask.getByRole("button", { name: "Allow", exact: true }));
    await expect.element(ask).not.toBeInTheDocument();
    expect(ownedActions).toContainEqual({
      action: "permission",
      id: "ask-1",
      option: "allow",
    });
    await userEvent.click(composer.getByRole("button", { name: "Stop" }));
    await expect.element(composer.getByRole("button", { name: "Send" })).toBeVisible();
    expect(ownedActions.at(-1)).toEqual({ action: "interrupt" });
  });

  test("while the agent works, a message goes at its next step; Edit brings it back, Remove drops it, and ↑ takes back the rest", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, goneOnTake } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /Claude Code/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Claude" });
    const field = composer.getByRole("combobox", { name: "Message Claude" });
    setOwned({ status: "working", settings: [], commands: [] });
    // Working, with an empty box: Stop. With a message: Send now, and Stop beside it.
    await expect.element(composer.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect
      .element(composer.getByRole("button", { name: "Send now" }))
      .not.toBeInTheDocument();
    await userEvent.click(field);
    await userEvent.keyboard("Round to minutes.");
    await expect.element(composer.getByRole("button", { name: "Stop" })).toBeVisible();
    await userEvent.click(composer.getByRole("button", { name: "Send now" }));
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Round to minutes." }]);
    const queued = panel.getByText("Queued for Claude's next step");
    await expect.element(queued).toBeVisible();
    // Claude Code takes it after its tools by itself, so no Send now.
    await expect.element(panel.getByRole("button", { name: "Send now" })).not.toBeInTheDocument();
    await expect.element(field).toHaveValue("");

    // Edit takes it back into the box, before what the box holds.
    await userEvent.click(field);
    await userEvent.keyboard("And hours.");
    await userEvent.click(panel.getByRole("button", { name: "Edit", exact: true }));
    await expect.element(field).toHaveValue("Round to minutes.\n\nAnd hours.");
    await expect.element(queued).not.toBeInTheDocument();

    // Remove drops one; ↑ in the empty box takes back the rest, in order.
    await userEvent.click(field);
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("Keep seconds.{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("Test the hour.{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.length).toBe(4);
    await expect.element(panel.getByText("Keep seconds.")).toBeVisible();
    const removes = panel.getByRole("button", { name: "Remove", exact: true });
    await expect.poll(() => removes.elements().length).toBe(3);
    await userEvent.click(removes.nth(1));
    await expect.element(panel.getByText("Keep seconds.")).not.toBeInTheDocument();
    // One that the agent takes meanwhile goes; the rest come back.
    goneOnTake.add("Test the hour.");
    await userEvent.click(field);
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(field).toHaveValue("Round to minutes.\n\nAnd hours.");
    await expect.element(queued).not.toBeInTheDocument();
    await expect.element(panel.getByText("1 of them went to Claude already.")).toBeVisible();

    // A queued image does not come back with its text, and the box says so.
    setOwned({ status: "working", images: true, settings: [], commands: [] });
    await userEvent.fill(field, "");
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "shot.png", {
        type: "image/png",
      }),
    );
    field
      .element()
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }));
    await expect.element(composer.getByRole("list", { name: "Images to send" })).toBeVisible();
    await userEvent.click(field);
    await userEvent.keyboard("See the chart.{Meta>}{Enter}{/Meta}");
    await expect.element(queued).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Edit", exact: true }));
    await expect.element(field).toHaveValue("See the chart.");
    await expect
      .element(panel.getByText("Its attachment did not come back; add it again."))
      .toBeVisible();
  });

  test("while the agent works, ⇧⌘↩ queues a message for the turn's end, Send now sends it at the next step, and ⌘↩ can queue instead", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, steered } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    localStorage.removeItem("med:follow-up");
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /Claude Code/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Claude" });
    const field = composer.getByRole("combobox", { name: "Message Claude" });
    setOwned({ status: "working", settings: [], commands: [] });
    await userEvent.click(field);
    await userEvent.keyboard("Rename it.{Meta>}{Shift>}{Enter}{/Shift}{/Meta}");
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Rename it.", afterTurn: true }]);
    const queued = panel.getByText("Queued until Claude's turn ends");
    await expect.element(queued).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Send now", exact: true }));
    await expect.poll(() => steered).toHaveLength(1);
    await expect.element(panel.getByText("Queued for Claude's next step")).toBeVisible();
    await expect.element(queued).not.toBeInTheDocument();

    // The palette's choice makes ⌘↩ queue, and the button says so.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(
      page.getByRole("option", { name: "While the agent works, ⌘↩ queues for the turn's end" }),
    );
    expect(localStorage.getItem("med:follow-up")).toBe("queue");
    await userEvent.click(field);
    await userEvent.keyboard("Then the docs.");
    await expect.element(composer.getByRole("button", { name: "Queue" })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ text: "Then the docs.", afterTurn: true });
    localStorage.removeItem("med:follow-up");
  });

  test("Codex takes a message sent now in the turn that runs, and a queued one at its end or on Send now", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, steered } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "codex", name: "Codex", kind: "codex", available: true }],
    });
    localStorage.removeItem("med:follow-up");
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page.getByRole("region", { name: "Start a session" }).getByRole("button", { name: /Codex/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Codex" });
    const field = composer.getByRole("combobox", { name: "Message Codex" });
    setOwned({
      status: "working",
      settings: [],
      commands: [],
      capabilities: AGENT_CAPABILITIES.codex,
    });
    await userEvent.click(field);
    await userEvent.keyboard("Check the hour.");
    await expect.element(composer.getByRole("button", { name: "Send now" })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.at(-1)).toMatchObject({ text: "Check the hour." });
    expect(agentMessages.at(-1)).not.toHaveProperty("afterTurn");
    await expect.element(panel.getByText("Queued for Codex's next step")).toBeVisible();
    await expect
      .element(panel.getByRole("button", { name: "Send now", exact: true }))
      .not.toBeInTheDocument();

    await userEvent.keyboard("Then the docs.{Meta>}{Shift>}{Enter}{/Shift}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ text: "Then the docs.", afterTurn: true });
    await expect.element(panel.getByText("Queued until Codex's turn ends")).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Send now", exact: true }));
    await expect.poll(() => steered).toHaveLength(1);
    await expect.element(panel.getByText("Queued until Codex's turn ends")).not.toBeInTheDocument();
  });

  test("an ACP agent takes messages only between turns: its button is Queue, and a queued message has no Send now", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "fake", name: "OpenCode", kind: "acp", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /OpenCode/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const field = panel.getByRole("combobox", { name: /^Message / });
    setOwned({
      status: "working",
      settings: [],
      commands: [],
      capabilities: AGENT_CAPABILITIES.acp,
    });
    await userEvent.click(field);
    await userEvent.keyboard("Wait for me.");
    await expect.element(panel.getByRole("button", { name: "Queue", exact: true })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.at(-1)).toMatchObject({ text: "Wait for me." });
    await expect.element(panel.getByText(/^Queued until .*'s turn ends$/)).toBeVisible();
    await expect
      .element(panel.getByRole("button", { name: "Send now", exact: true }))
      .not.toBeInTheDocument();
  });

  test("a turn that another process runs on a session that Med runs works until it ends, then shows its time", async () => {
    await page.viewport(1280, 800);
    const { setOwned, setOwnedTranscript } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const start = page.getByRole("region", { name: "Start a session" });
    await userEvent.click(start.getByRole("button", { name: /Claude Code/ }));
    const now = Date.now();
    // Med's runner waits after its last turn.
    setOwned({ status: "idle", updatedAt: now - 60_000 });
    const prompt = (at: number, text: string) => ({
      at,
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
    });
    // Claude Code in a terminal takes the session and thinks: the transcript
    // has only its prompt, newer than the runner's state.
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests.")],
      idle: false,
      modifiedAt: now - 2000,
    });
    const panel = page.getByRole("region", { name: "Agent session" });
    const thread = panel.getByRole("log", { name: "Session" });
    await expect.element(thread.getByText("Run the tests.")).toBeVisible();
    await expect.element(thread.getByText("Working")).toBeVisible();
    expect(thread.element().textContent).not.toContain("Worked for");
    // The header says so too.
    await expect.element(panel.getByText("Working", { exact: true }).first()).toBeVisible();
    expect(panel.getByText("Idle", { exact: true }).query()).toBeNull();

    // Its reply ends the turn, three seconds after the prompt.
    const reply = {
      at: now + 1000,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "The tests pass." },
        _meta: { med: { endsTurn: true } },
      },
    };
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests."), reply],
      idle: true,
      modifiedAt: now + 1000,
    });
    await expect.element(thread.getByText("Worked for 3s")).toBeVisible();
    expect(thread.element().textContent).not.toContain("Working");

    // A turn that Med runs ends when its runner says so, though the transcript
    // that it left behind does not say, as after an API error.
    setOwned({ status: "working", updatedAt: now + 2000 });
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests."), reply, prompt(now + 2000, "Check the hour.")],
      idle: false,
      modifiedAt: now + 2000,
    });
    await expect.element(thread.getByText("Working")).toBeVisible();
    setOwned({ status: "idle", updatedAt: now + 4000 });
    // The transcript ends at the prompt: under a second, the turn shows no time.
    await expect.element(thread.getByText("Worked", { exact: true })).toBeVisible();
    expect(thread.element().textContent).not.toContain("Working");
  });
});
