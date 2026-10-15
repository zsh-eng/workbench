import { serveMedia, mediaHeaders } from "./media";
import { imagesText, pruneImages, saveImages } from "./prompt-images";
import { mediaType } from "../shared/media";
import { fileChangesRequestSchema } from "../shared/file-changes";
import { fileChanges } from "./repository/file-changes";
import { markdownAsset } from "./markdown-assets";
import { browseSourceSchema } from "../shared/browse";
import { LocalFiles } from "./local-files";
import { ChannelResponse, channelRequest, LIVE_PATH, liveInputSchema } from "./live-streams";
import { PullJobs } from "./pull-workspace";
import { parsePullUrl, pullStartSchema } from "../shared/pull-workspace";
import { localPathSchema } from "../shared/local-file";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  apiErrorMessage,
  notesRequestSchema,
  noteMutationSchema,
  reviewRequestSchema,
  type ApiError,
  type ChangeEvent,
  type Comparison,
  type Repository,
  type ReviewResponse,
  type Session,
} from "../shared/protocol";
import { gitTargets, pushBranch } from "./repository/git-actions";
import {
  commitStaged,
  pushCurrentBranch,
  stagePaths,
  workingFileChanges,
  workingStatus,
} from "./repository/commit-flow";
import { commitRoutes, pushRequestSchema } from "../shared/git-actions";
import { route, routeTable } from "./routes";
import {
  endpointNames,
  loadCommitDetails,
  loadHistory,
  loadRangeCommits,
  resolveRepository,
} from "./repository/history";
import { loadPullRequestComments } from "./repository/pull-request";
import { ReviewService } from "./repository/review";
import { HostError } from "./runtime/errors";
import { ProcessFailure } from "./runtime/process";
import { watchRepository } from "./runtime/watch";
import { createCodeCheck, webEntry } from "./runtime/build";
import { NoteService } from "./notes";
import {
  browseListRequestSchema,
  browseReadRequestSchema,
  browseWriteRequestSchema,
} from "../shared/browse";
import { listBrowse, readBrowse, writeBrowse } from "./repository/browse";
import { browseBlameRequestSchema, browseSearchRequestSchema } from "../shared/inspect";
import { blameBrowse } from "./repository/inspect";
import { symbolSearchRequestSchema } from "../shared/symbols";
import { FileSymbolService } from "./search/symbols";
import { type SearchOptions } from "./search/service";
import { RepositoryRegistry } from "./repository/registry";
import { removeWorktree } from "./repository/worktrees";
import { AttemptGroups } from "./attempts";
import { runProcess } from "./runtime/process";
import { acceptWebSocket } from "./runtime/websocket";
import { CodexReviews } from "./codex-reviews";
import { SavedReviewStore } from "./saved-reviews";
import {
  createTranscriptFeeds,
  findTranscript,
  readTranscriptPage,
  transcriptTurns,
} from "./agent-transcripts";
import { AgentInbox } from "./agent-inbox";
import { findAgents, OwnedSessions, type RunnableAgent } from "./owned-sessions";
import { createAgentStatus } from "./agent-status";
import { createFoundSessions } from "./found-sessions";
import { createSessionSearch, sessionEntry, type SessionInfo } from "./session-search";
import { createCheckoutWork } from "./checkout-work";
import {
  foundUpdateSchema,
  sessionAdoptSchema,
  sessionFindSchema,
  type SessionAdopted,
} from "../shared/found-sessions";
import { ownedActionSchema, ownedStartSchema } from "../shared/owned-session";
import { attemptLetter } from "../shared/attempts";
import {
  threadSlug,
  threadStartSchema,
  threadTitle,
  type Thread,
  type ThreadList,
} from "../shared/threads";
import {
  agentMessageInputSchema,
  deliveredText,
  type AgentInboxState,
} from "../shared/agent-inbox";
import type { SessionEvent } from "../shared/agent-session";
import {
  pinMutationSchema,
  briefCommentMutationSchema,
  reviewKeySchema,
  savedReviewCreateSchema,
  type CapturedReviewTarget,
  type SavedReviewCreate,
} from "../shared/saved-review";
import { getPersistentToken, publishConnection } from "./runtime/connection";
import { ownedEnvironment, writeMedCommand } from "./thread-agents";

import type { ServiceManager } from "./service/manager";

export interface StartHostOptions {
  service?: ServiceManager;
  assets?: (path: string) => Promise<Uint8Array | undefined>;
  repo: string;
  fileMode?: boolean;
  repos?: readonly string[];
  port?: number;
  open?: boolean;
  webRoot?: string;
  initialComparison?: Comparison;
  allowedInputPaths?: readonly string[];
  onClose?: () => Promise<void>;
  search?: SearchOptions;
  stateDir?: string;
  /** Shows a file in the system file manager; tests replace it. */
  reveal?: (path: string) => void;
  /** Adds a message to a Codex thread's queue; tests replace `codex queue`. */
  queueCodex?: (threadId: string, text: string) => Promise<void>;
  /** How long a `med review wait` has to confirm a message (tests shorten it). */
  agentAckMs?: number;
  /** The agents Med can start; tests replace the installed ones. */
  agents?: () => Promise<RunnableAgent[]>;
  /** The GitHub CLI that opens pull requests; tests give a fake one. */
  gh?: { command: string; args: string[] };
  /** The command that runs this Med again; agents that Med starts get it as `med`. */
  cli?: readonly string[];
}
export interface RunningHost {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}
/** Shows a path in Finder, Explorer, or the Linux file manager. */
function revealInFileManager(path: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", ["-R", path]]
      : process.platform === "win32"
        ? ["explorer.exe", [`/select,${path}`]]
        : ["xdg-open", [dirname(path)]];
  const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => {
    /* The file manager is optional; the request already succeeded. */
  });
  child.unref();
}
const MAX_BODY = 128 * 1024;
// A brief holds up to 100,000 characters; UTF-8 can need four bytes for one.
const MAX_BRIEF_BODY = 512 * 1024;
// A guide holds up to 200,000 characters of JSON.
const MAX_GUIDE_BODY = 1024 * 1024;
// A message to an agent can hold ten images of 5 MB, in base64.
const MAX_AGENT_MESSAGE_BODY = 72 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function readBody(request: IncomingMessage, limit = MAX_BODY) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const data of request) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    bytes += chunk.byteLength;
    if (bytes > limit)
      throw new HostError("payload-too-large", "The request body exceeds its size limit.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HostError("invalid-json", "The request body must be JSON.");
  }
}

/**
 * Whether a checkout's working changes differ from their capture: another
 * HEAD, another patch, or another set of changed files, such as a new image.
 */
function captureChanged(saved: ReviewResponse, live: ReviewResponse) {
  const files = (review: ReviewResponse) =>
    review.files
      .map((file) => `${file.status} ${file.path}`)
      .sort()
      .join("\n");
  return saved.base !== live.base || saved.patch !== live.patch || files(saved) !== files(live);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** Serve one local review process; Git operations never change the checkout. */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  let repository: Repository;
  try {
    if (options.service) throw new Error("Managed sources use an explicit catalogue.");
    repository = { ...(await resolveRepository(resolve(options.repo))), git: true };
  } catch (error) {
    if (
      !options.fileMode &&
      options.initialComparison?.kind !== "patch" &&
      options.initialComparison?.kind !== "files"
    )
      throw error;
    const path = await realpath(resolve(options.repo));
    if (!(await stat(path)).isDirectory())
      throw new HostError("invalid-directory", "Choose an input directory.");
    repository = {
      path,
      name: basename(path),
      head: "",
      branch: "File comparison",
      shallow: false,
      git: false,
    };
  }
  const token = options.stateDir
    ? await getPersistentToken(options.stateDir)
    : randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(token).digest();
  // Names this server process, so a page can tell when a restart has finished.
  const instance = randomBytes(8).toString("hex");
  const reviews = new ReviewService(
    new Set((options.allowedInputPaths ?? []).map((path) => resolve(path))),
  );
  const notes = new NoteService(reviews);
  const symbols = new FileSymbolService();
  const localFiles = new LocalFiles();
  const temporaryState = options.stateDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "med-reviews-"));
  const savedReviews = new SavedReviewStore(join(options.stateDir ?? temporaryState!, "reviews"));
  const inbox = new AgentInbox(join(options.stateDir ?? temporaryState!, "agent-messages"), {
    ...(options.queueCodex ? { queueCodex: options.queueCodex } : {}),
    ...(options.agentAckMs ? { ackMs: options.agentAckMs } : {}),
  });
  const inboxStreams = new Set<ServerResponse>();
  const imageDirectory = join(options.stateDir ?? temporaryState!, "images");
  void pruneImages(imageDirectory);
  const bin = options.cli ? join(options.stateDir ?? temporaryState!, "bin") : undefined;
  if (bin) await writeMedCommand(bin, options.cli!);
  /** The environment of an agent that Med starts, in a thread when the review has a key. */
  const agentEnvironment = (key: string | undefined, repo: string) =>
    ownedEnvironment({
      port,
      ...(options.stateDir ? { stateDir: options.stateDir } : {}),
      ...(bin ? { bin } : {}),
      ...(key ? { thread: { key, repo } } : {}),
    });
  // Sessions that Med starts. ACP sessions keep their updates in the state
  // directory, and the sessions from before a restart come back first.
  const ownedSessions = new OwnedSessions({
    agents: options.agents ?? (() => findAgents(options.stateDir)),
    logDirectory: join(options.stateDir ?? temporaryState!, "sessions"),
    offersFile: join(options.stateDir ?? temporaryState!, "agent-offers.json"),
    recordsFile: join(options.stateDir ?? temporaryState!, "owned-sessions.json"),
    environment: agentEnvironment,
  });
  await ownedSessions.restore();
  const ownedStreams = new Set<ServerResponse>();
  const codexReviews = new CodexReviews();
  const reviewStatus = createAgentStatus({
    owned(sessionId) {
      const runner = ownedSessions.get(sessionId);
      return runner && { state: runner.state(), updatedAt: ownedSessions.updatedAt(sessionId) };
    },
    waiting: (reviewId) => inbox.waiting(reviewId),
    logPath: (sessionId) =>
      join(options.stateDir ?? temporaryState!, "sessions", `${sessionId}.jsonl`),
  });
  // The windows' thread lists.
  const threadStreams = new Set<ServerResponse>();
  // Claude Code and Codex sessions in the registered repositories that no
  // saved review names; the thread list shows them too.
  const found = createFoundSessions({
    repositories: () => registry.snapshot(),
    refreshRepositories: () => registry.list(),
    owned: () => ownedSessions.agentSessions(),
    settingsFile: join(options.stateDir ?? temporaryState!, "found-sessions.json"),
  });
  await found.restore();
  // Sessions of any age, for `med thread find` and `med thread adopt`.
  const sessionSearch = createSessionSearch({ codexNames: () => found.codexNames() });
  /** The saved thread that names a session: by its ID, or for a session
   * that Med runs through ACP, by the agent's own ID. */
  const sessionThreads = async () => {
    const reviews = await savedReviews.list();
    const threads = new Map<string, { id: string; archived?: boolean }>();
    for (const review of reviews)
      for (const session of review.sessions ?? [])
        threads.set(session.id, { id: review.id, ...(review.archivedAt && { archived: true }) });
    for (const [own, id] of ownedSessions.agentSessions()) {
      const thread = threads.get(id);
      if (thread && !threads.has(own)) threads.set(own, thread);
    }
    return threads;
  };
  /** Sessions for the API, with their threads and registered repositories. */
  const sessionEntries = async (sessions: readonly SessionInfo[]) => {
    const threads = await sessionThreads();
    return Promise.all(
      sessions.map(async (session) => {
        const place = session.cwd ? await found.locate(session.cwd, false) : undefined;
        const thread = threads.get(session.id);
        const repository = place?.checkout?.repository.name;
        return sessionEntry(session, {
          ...(thread && { thread }),
          ...(repository && { repository }),
        });
      }),
    );
  };
  // Each thread's work that its base branch does not have yet.
  const checkoutWork = createCheckoutWork();
  /** Every thread, newest first, with the repositories that threads start in. */
  const listThreads = async (): Promise<ThreadList> => {
    const repositories = registry.snapshot();
    const saved = await savedReviews.list();
    const reviews = saved.filter((review) => !review.archivedAt);
    const threads = await Promise.all(
      reviews.map(async (review): Promise<Thread> => {
        const target = review.targets.find((entry) => !entry.commentReviewId) ?? review.targets[0];
        const family = repositories.find((entry) => entry.id === target?.repositoryId);
        const status = review.sessions?.length
          ? await reviewStatus(review.id, review.sessions).catch(() => undefined)
          : undefined;
        const reply = review.sessions?.length
          ? await inbox.last(review.id).catch(() => undefined)
          : undefined;
        return {
          id: review.id,
          title: review.pullRequestTitle ?? review.title,
          createdAt: review.createdAt,
          updatedAt: Math.max(review.modifiedAt, status?.updatedAt ?? 0),
          ...(family && {
            repository: { id: family.id, name: family.name, path: family.path },
          }),
          ...(target && { checkout: target.repo }),
          ...(family?.worktrees.some((tree) => tree.path === target?.repo && tree.linked) && {
            linked: true,
          }),
          ...(target?.branch && { branch: target.branch }),
          ...(status && { agent: status.agent, state: status.state }),
          ...(status?.turn && { turn: status.turn }),
          ...(reply && {
            replied: {
              at: Date.parse(reply.createdAt),
              text: (reply.text || `${reply.noteIds.length} comments`).slice(0, 200),
              delivery: reply.delivery,
            },
          }),
          ...(review.sessions?.length && { sessions: review.sessions }),
          ...(review.totals && {
            changes: {
              files: review.totals.files,
              additions: review.totals.additions,
              deletions: review.totals.deletions,
            },
          }),
          ...(review.pullRequestUrl && { pullRequestUrl: review.pullRequestUrl }),
          ...(review.group && { group: review.group }),
        };
      }),
    );
    threads.push(...found.threads(saved));
    threads.sort((a, b) => b.updatedAt - a.updatedAt);
    const onWorking = new Set(
      reviews
        .filter((review) => review.targets.some((entry) => entry.comparison.kind === "working"))
        .map((review) => review.id),
    );
    return {
      threads: checkoutWork.annotate(
        threads,
        repositories,
        (thread) => !!thread.found || onWorking.has(thread.id),
      ),
      repositories: repositories.map(({ id, name, path }) => ({ id, name, path })),
      found: found.settings(),
    };
  };

  const watchers = new Map<string, Promise<() => Promise<void>>>();
  const watcherModes = new Map<string, boolean>();
  const browseLiveSources = new Set<string>();
  const retiringWatchers = new Set<Promise<void>>();
  const retireWatcher = (watcher: Promise<() => Promise<void>>) => {
    const stopped = watcher.then((stop) => stop()).catch(() => {});
    retiringWatchers.add(stopped);
    void stopped.finally(() => retiringWatchers.delete(stopped));
    return stopped;
  };
  const streams = new Map<ServerResponse, string>();
  // One stream per open Med window, for news that is not about a repository,
  // such as a review an agent just created.
  const windows = new Set<ServerResponse>();
  const sessionStreams = new Set<ServerResponse>();
  // Streams of one transcript share its follower.
  const { follow: followTranscript, close: closeTranscripts } = createTranscriptFeeds();
  // One stream per page that carries the streams above as channels.
  const lives = new Map<
    string,
    {
      response: { write(text: string): unknown; end(): void; readonly writableEnded: boolean };
      channels: Map<string, ChannelResponse>;
    }
  >();
  /** Session updates per server event; the browser reads events up to 4 MiB. */
  const SESSION_EVENT_BYTES = 1024 * 1024;
  // The workspace list's states update this often.
  const STATUS_MS = 1500;
  const activeRequests = new Map<AbortController, Set<string>>();
  let revision = 0;
  let closing = false;
  let port = 0;
  let expensiveRequests = 0;
  // The last request of each stream that a page names, such as a search as
  // the user types. A newer one stops it: Bun does not tell the host when the
  // browser cancels a request, and the old work would hold its slot.
  const latestRequests = new Map<string, () => void>();
  const embeddedAssets =
    options.assets ?? (globalThis as { __medAssets?: StartHostOptions["assets"] }).__medAssets;
  const webRoot =
    options.webRoot ??
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      fileURLToPath(import.meta.url).includes("/dist/assets/") ? "../web" : "web",
    );
  // A rebuild while the host runs leaves old server code serving new pages.
  const codeChanged = createCodeCheck();
  const currentWebEntry = async () => {
    try {
      const html =
        (await embeddedAssets?.("/index.html")) ?? (await readFile(join(webRoot, "index.html")));
      return webEntry(Buffer.from(html).toString("utf8"));
    } catch {
      return null;
    }
  };

  /** Ends the event streams and file watchers of checkouts that are gone. */
  const forgetCheckouts = async (paths: ReadonlySet<string>) => {
    for (const [stream, path] of streams)
      if (paths.has(path)) {
        stream.end();
        streams.delete(stream);
      }
    for (const path of paths) {
      const watcher = watchers.get(path);
      watchers.delete(path);
      watcherModes.delete(path);
      browseLiveSources.delete(path);
      if (watcher) await retireWatcher(watcher);
    }
  };
  const registry = new RepositoryRegistry(options.search, async (id, paths) => {
    for (const [abort, owners] of activeRequests) if (owners.has(id)) abort.abort();
    await forgetCheckouts(paths);
    reviews.removeRepositories(paths);
    notes.removeRepositories(paths);
  });
  /** Removes a linked worktree with `git worktree remove`. Git keeps one with
   * changes; an agent that works there keeps it too. */
  const removeLinkedWorktree = async (input: string, signal: AbortSignal) => {
    // Not requireRepo: the request ends after the path leaves the registry.
    const { path } = await registry.require(input, signal);
    const agents = ownedSessions.within(path);
    if (agents.some((runner) => runner.state().status !== "idle"))
      throw new HostError(
        "worktree-busy",
        "An agent is working in this worktree. Stop it, then try again.",
        409,
      );
    await removeWorktree(path, signal);
    for (const runner of agents) ownedSessions.end(runner);
    await forgetCheckouts(new Set([path]));
    await registry.refreshOwner(path, signal);
  };
  // GitHub pull requests that open as workspaces. A job saves its review and
  // starts its agent through this host's own API.
  const pullJobs = new PullJobs({
    repositories: () => registry.snapshot(),
    refresh: (path) => registry.refreshOwner(path),
    gh: options.gh ?? { command: "gh", args: [] },
    worktrees: join(options.stateDir ?? temporaryState!, "worktrees"),
    async api<T>(path: string, body?: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          apiErrorMessage(data) ?? `The host refused the request (${response.status}).`,
        );
      return data as T;
    },
  });
  const pullStreams = new Set<ServerResponse>();
  // Attempts: the threads of one task, compared, and one of them kept.
  const attempts = new AttemptGroups({
    reviews: () => savedReviews.list(),
    status: (review) =>
      review.sessions?.length
        ? reviewStatus(review.id, review.sessions)
        : Promise.resolve(undefined),
    ownedEvents: (id) => ownedSessions.events(id),
    ownedModel: (id) =>
      ownedSessions
        .get(id)
        ?.state()
        .settings.find((entry) => entry.category === "model")?.value,
    archive: (id, archived) => savedReviews.archive(id, archived),
    rename: (id, title) => savedReviews.details(id, { title }),
    repository: (path) => registry.owner(path),
    stopAgents(path) {
      const working = ownedSessions
        .within(path)
        .filter((runner) => runner.state().status !== "idle");
      for (const runner of working) ownedSessions.end(runner);
      return working.length;
    },
    removeWorktree: (path, signal) => removeLinkedWorktree(path, signal),
    refresh: (path) => registry.refreshOwner(path),
  });
  if (repository.git !== false) {
    await registry.register(repository.path);
    for (const path of options.repos ?? []) await registry.register(path);
  }
  await options.service?.attach(registry);
  const publish = (event: ChangeEvent) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [stream, path] of streams) {
      if (path !== event.repo) continue;
      if (stream.writableLength > 256 * 1024) {
        stream.destroy();
        streams.delete(stream);
      } else stream.write(frame);
    }
  };
  const observe = (repo: string, live = false) => {
    if (closing) return;
    if (watchers.has(repo) && watcherModes.get(repo) === live) {
      const current = watchers.get(repo)!;
      watchers.delete(repo);
      watchers.set(repo, current);
      return;
    }
    let evicted: Promise<void> | undefined;
    if (!watchers.has(repo) && watchers.size >= 8) {
      const pinned = new Set(streams.values());
      const oldest = [...watchers.keys()].find((path) => !pinned.has(path));
      if (!oldest)
        throw new HostError(
          "too-many-watchers",
          "Eight working folders are in use. Close another viewer before opening this source.",
          503,
        );
      const stop = watchers.get(oldest)!;
      watchers.delete(oldest);
      watcherModes.delete(oldest);
      browseLiveSources.delete(oldest);
      evicted = retireWatcher(stop);
    }
    const previous = watchers.get(repo);
    const promise = (async () => {
      await evicted;
      if (previous) {
        try {
          await (
            await previous
          )();
        } catch {
          /* Replace a failed watcher. */
        }
      }
      return watchRepository(
        repo,
        () => {
          if (!registry.owner(repo)) return;
          registry.refreshSearch(repo);
          publish({ type: "changed", repo, revision: ++revision });
        },
        live,
      );
    })();
    watchers.set(repo, promise);
    watcherModes.set(repo, live);
    promise.catch(() => {
      if (watchers.get(repo) === promise) {
        watchers.delete(repo);
        watcherModes.delete(repo);
      }
    });
  };
  const session = async (repo: string, signal?: AbortSignal): Promise<Session> => {
    if (repository.git === false && !options.service)
      return {
        protocol: 1,
        repository,
        worktrees: [],
        repositories: [],
        ...(options.initialComparison ? { initialComparison: options.initialComparison } : {}),
      };
    // The checkout's own Git state reads while its repository refreshes; a
    // refresh that fails still gives its error first.
    const checkout = resolveRepository(repo, signal);
    checkout.catch(() => {});
    await registry.refreshOwner(repo, signal);
    const repositories = registry.snapshot();
    const owner = await registry.require(repo, signal);
    const info = await checkout;
    observe(info.path, watcherModes.get(info.path) ?? false);
    return {
      protocol: 1,
      repository: { ...info, git: true },
      repositoryId: owner.repository.id,
      repositories,
      worktrees: owner.repository.worktrees,
      ...(options.initialComparison && repo === repository.path
        ? { initialComparison: options.initialComparison }
        : {}),
    };
  };

  // Routes with a shared contract: the browser's client reads the same one.
  const routes = routeTable([
    route(commitRoutes.status, async ({ repo }, { requireRepo, signal }) =>
      workingStatus(await requireRepo(repo ?? null), signal),
    ),
    route(commitRoutes.changes, async (input, { requireRepo, signal }) => {
      const repo = await requireRepo(input.repo ?? null);
      if (!input.path) throw new HostError("invalid-path", "Choose a changed file.");
      return workingFileChanges(
        repo,
        { path: input.path, previousPath: input.previousPath },
        signal,
      );
    }),
    route(commitRoutes.stage, async (input, { requireRepo, signal }) => {
      const repo = await requireRepo(input.repo);
      await stagePaths({ ...input, repo }, signal);
      return workingStatus(repo, signal);
    }),
    route(commitRoutes.commit, async (input, { requireRepo, signal }) =>
      commitStaged({ ...input, repo: await requireRepo(input.repo) }, signal),
    ),
    route(commitRoutes.pushBranch, async (input, { requireRepo, signal }) =>
      pushCurrentBranch({ ...input, repo: await requireRepo(input.repo) }, signal),
    ),
    ...attempts.routes(),
  ]);
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const abort = new AbortController();
    const owners = new Set<string>();
    const ownershipChecks = new Set<() => boolean>();
    activeRequests.set(abort, owners);
    const requireRepo = async (input: string | null) => {
      if (repository.git === false && !options.service) {
        const path = resolve(input ?? repository.path);
        if (path !== repository.path && path !== resolve(options.repo))
          throw new HostError("repository-not-allowed", "Choose the input directory.", 403);
        return repository.path;
      }
      const fallback = registry.owner(repository.path)?.path ?? registry.snapshot()[0]?.path;
      if (!input && !fallback)
        throw new HostError("repository-not-allowed", "Add a repository to continue.", 403);
      const owned = await registry.require(input ?? fallback!, abort.signal);
      owners.add(owned.repository.id);
      ownershipChecks.add(owned.valid);
      return owned.path;
    };
    const requireReview = async (id: string) => {
      await requireRepo(reviews.get(id).response.repo);
      return id;
    };
    const assertRequestAccess = () => {
      abort.signal.throwIfAborted();
      if ([...ownershipChecks].some((valid) => !valid()))
        throw new HostError(
          "repository-not-allowed",
          "This repository was removed during the request.",
          403,
        );
    };
    const captureImages = async (review: Awaited<ReturnType<typeof reviews.load>>) => {
      const images: { path: string; side: "old" | "new"; mime: string; data: string }[] = [];
      let bytes = Buffer.byteLength(review.patch);
      for (const file of review.files) {
        if (mediaType(file.path)?.kind !== "image") continue;
        for (const side of ["old", "new"] as const) {
          if ((side === "old" && file.status === "A") || (side === "new" && file.status === "D"))
            continue;
          try {
            const image = await reviews.image(review.id, file.path, side, abort.signal);
            bytes += image.bytes.length;
            if (bytes > 24 * 1024 * 1024)
              throw new HostError(
                "saved-review-too-large",
                "Captured media exceeds 24 MiB. Narrow this review.",
                413,
              );
            images.push({
              path: file.path,
              side,
              mime: image.mime,
              data: image.bytes.toString("base64"),
            });
          } catch (error) {
            if (
              error instanceof HostError &&
              ["image-unavailable", "unsupported-media"].includes(error.code)
            )
              continue;
            throw error;
          }
        }
      }
      return images;
    };
    const send = (body: unknown) => {
      assertRequestAccess();
      json(response, 200, body);
    };
    request.once("aborted", () => abort.abort());
    response.once("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    void (async () => {
      const host = request.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        throw new HostError("forbidden-host", "The local host header is not valid.", 403);
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.origin && request.headers.origin !== `http://${host}`)
          throw new HostError(
            "forbidden-origin",
            "Use the same local origin for API requests.",
            403,
          );
        const bearer = request.headers.authorization?.replace(/^Bearer /, "");
        const cookie = request.headers.cookie
          ?.split(";")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith(`med_session_${port}=`))
          ?.slice(`med_session_${port}=`.length);
        const provided = bearer ?? (url.pathname === "/api/auth" ? "" : cookie) ?? "";
        if (!timingSafeEqual(tokenDigest, createHash("sha256").update(provided).digest()))
          throw new HostError("unauthorized", "Open the launch URL with its access token.", 401);
        if (url.pathname === "/api/auth" && request.method === "POST") {
          response.setHeader(
            "Set-Cookie",
            `med_session_${port}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
          );
          send({ authenticated: true });
          return;
        }
        if (url.pathname === "/api/live" && request.method === "GET") {
          if (lives.size >= 32)
            throw new HostError("too-many-streams", "Too many live streams are open.", 503);
          const id = randomUUID();
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          const channels = new Map<string, ChannelResponse>();
          lives.set(id, { response, channels });
          response.write(`event: live\ndata: ${JSON.stringify({ id })}\n\n`);
          response.once("close", () => {
            lives.delete(id);
            for (const channel of channels.values()) channel.destroy();
          });
          return;
        }
        const liveRoute = /^\/api\/live\/([A-Za-z0-9-]{1,80})$/.exec(url.pathname);
        if (liveRoute && request.method === "POST") {
          const live = lives.get(liveRoute[1]!);
          if (!live) throw new HostError("live-not-found", "The live stream has closed.", 404);
          const input = liveInputSchema.parse(await readBody(request));
          for (const key of input.close) live.channels.get(key)?.destroy();
          const refuse = (key: string, status: number, code: string, message: string) => ({
            key,
            status,
            body: { error: { code, message } } satisfies ApiError,
          });
          const channels = await Promise.all(
            input.open.map(async ({ key, path }) => {
              if (!LIVE_PATH.test(path))
                return refuse(key, 400, "invalid-channel", "This stream cannot be a channel.");
              if (live.channels.has(key) || live.channels.size >= 32)
                return refuse(key, 409, "channel-unavailable", "Choose another channel key.");
              const channel = new ChannelResponse(key, (text) => {
                if (!live.response.writableEnded) live.response.write(text);
              });
              live.channels.set(key, channel);
              channel.once("close", () => {
                if (live.channels.get(key) === channel) live.channels.delete(key);
              });
              handle(channelRequest(request, path), channel as unknown as ServerResponse);
              await channel.head;
              if (channel.statusCode === 200) return { key, status: 200 };
              live.channels.delete(key);
              let body: unknown = null;
              try {
                body = JSON.parse(channel.body);
              } catch {
                /* The handler sent no JSON body. */
              }
              return { key, status: channel.statusCode, body };
            }),
          );
          send({ channels });
          return;
        }
        if (url.pathname === "/api/events" && request.method === "GET") {
          const eventRepo = await requireRepo(url.searchParams.get("repo"));
          if (streams.size >= 8)
            throw new HostError("too-many-streams", "Too many review event streams are open.", 503);
          if (registry.owner(eventRepo)) observe(eventRepo, watcherModes.get(eventRepo) ?? false);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write(
            `event: ready\ndata: ${JSON.stringify({ type: "ready", repo: eventRepo, revision })}\n\n`,
          );
          streams.set(response, eventRepo);
          response.once("close", () => streams.delete(response));
          return;
        }
        // Earlier work of a long session: a page before a byte offset, and the
        // index of its prompts. Its transcript's path names it to another agent.
        const sessionPage =
          /^\/api\/reviews\/([A-Za-z0-9_-]+)\/sessions\/([A-Za-z0-9_-]+)\/(page|turns|transcript)$/.exec(
            url.pathname,
          );
        if (sessionPage && request.method === "GET") {
          const sessions =
            (await found.session(sessionPage[1]!)) ??
            (await savedReviews.get(sessionPage[1]!)).sessions;
          const session = sessions?.find((entry) => entry.id === sessionPage[2]);
          const path = session && session.agent !== "acp" && (await findTranscript(session));
          if (!session || !path)
            throw new HostError(
              "transcript-not-found",
              "The session's transcript is not on this computer.",
              404,
            );
          if (sessionPage[3] === "turns") {
            send({ turns: await transcriptTurns(session, path) });
            return;
          }
          if (sessionPage[3] === "transcript") {
            send({ path });
            return;
          }
          const before = Number(url.searchParams.get("before"));
          if (!Number.isSafeInteger(before) || before < 0)
            throw new HostError("invalid-offset", "Give the byte offset where the page ends.", 400);
          send(await readTranscriptPage(session, path, before));
          return;
        }
        // An agent session of a saved review: its transcript's updates, then
        // new ones as the agent writes them.
        const sessionRoute =
          /^\/api\/reviews\/([A-Za-z0-9_-]+)\/sessions\/([A-Za-z0-9_-]+)\/events$/.exec(
            url.pathname,
          );
        if (sessionRoute && request.method === "GET") {
          // A found thread's ID names its one session (found-sessions.ts).
          const sessions =
            (await found.session(sessionRoute[1]!)) ??
            (await savedReviews.get(sessionRoute[1]!)).sessions;
          const session = sessions?.find((entry) => entry.id === sessionRoute[2]);
          if (!session)
            throw new HostError("session-not-found", "This review has no such agent session.", 404);
          const runner = ownedSessions.get(session.id);
          let path = session.agent === "acp" ? undefined : await findTranscript(session);
          if (!path && session.agent !== "acp" && !runner)
            throw new HostError(
              "transcript-not-found",
              "The session's transcript is not on this computer.",
              404,
            );
          if (sessionStreams.size >= 8)
            throw new HostError("too-many-streams", "Too many session streams are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          sessionStreams.add(response);
          response.once("close", () => sessionStreams.delete(response));
          const write = (event: string, data: unknown) =>
            response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (session.agent === "acp") {
            // Med keeps an ACP session's updates itself.
            const idle = () => runner?.state().status !== "working";
            write("reset", {
              events: await ownedSessions.events(session.id),
              idle: idle(),
              modifiedAt: Date.now(),
              truncated: false,
            });
            const unsubscribe = [
              runner?.log?.subscribe((events) =>
                write("updates", { events, idle: idle(), modifiedAt: Date.now() }),
              ),
              runner?.subscribe(() =>
                write("updates", { events: [], idle: idle(), modifiedAt: Date.now() }),
              ),
            ];
            response.once("close", () => unsubscribe.forEach((stop) => stop?.()));
            return;
          }
          // A session that Med started writes its transcript with the first turn.
          if (!path)
            write("reset", { events: [], idle: true, modifiedAt: Date.now(), truncated: false });
          while (!path && !abort.signal.aborted && !closing) {
            await new Promise((done) => setTimeout(done, 400));
            path = await findTranscript(session);
          }
          if (!path) return;
          // The first view goes in parts, so no event is larger than the client
          // reads. The reset says how many there are, so the thread takes them
          // in one step.
          const parts = (events: SessionEvent[]) => {
            const result: SessionEvent[][] = [[]];
            let size = 0;
            for (const event of events) {
              const bytes = JSON.stringify(event).length;
              if (size + bytes > SESSION_EVENT_BYTES && result.at(-1)!.length) {
                result.push([]);
                size = 0;
              }
              result.at(-1)!.push(event);
              size += bytes;
            }
            return result;
          };
          // A thread kept in the browser names the updates it has.
          const feed = url.searchParams.get("feed") ?? "";
          const count = Number(url.searchParams.get("count"));
          const has =
            /^[\w-]{1,64}$/.test(feed) && Number.isSafeInteger(count) && count >= 0
              ? { feed, count }
              : undefined;
          void followTranscript(
            session as Parameters<typeof followTranscript>[0],
            path,
            {
              onFeed: ({ events, ...state }) => {
                const all = parts(events);
                all.forEach((part, index) =>
                  write(
                    index ? "updates" : "reset",
                    index
                      ? { ...state, events: part }
                      : { ...state, events: part, parts: all.length },
                  ),
                );
              },
              onEvents: (events, state) =>
                parts(events).forEach((part) => write("updates", { ...state, events: part })),
            },
            abort.signal,
            has,
          ).catch(() => response.end());
          return;
        }
        // A pull request that opens as a workspace, and its progress.
        if (url.pathname === "/api/pulls" && request.method === "POST") {
          const input = pullStartSchema.parse(await readBody(request));
          const address = parsePullUrl(input.url);
          if (!address)
            throw new HostError("invalid-pull-request", "Paste a GitHub pull request link.", 400);
          const agent = input.agent
            ? (await ownedSessions.agents()).find((entry) => entry.id === input.agent)
            : undefined;
          if (input.agent && !agent?.available)
            throw new HostError("agent-not-found", "Med cannot start this agent.", 404);
          send(pullJobs.start(address, agent && { id: agent.id, name: agent.name }));
          return;
        }
        const pullRoute = /^\/api\/pulls\/([A-Za-z0-9-]{1,80})(\/events)?$/.exec(url.pathname);
        if (pullRoute && request.method === "GET") {
          const id = pullRoute[1]!;
          if (!pullJobs.get(id))
            throw new HostError("pull-job-not-found", "Med restarted before this job ended.", 404);
          if (!pullRoute[2]) {
            send(pullJobs.get(id));
            return;
          }
          if (pullStreams.size >= 32)
            throw new HostError("too-many-streams", "Too many pull request streams are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          pullStreams.add(response);
          const push = () =>
            response.write(`event: state\ndata: ${JSON.stringify(pullJobs.get(id))}\n\n`);
          const unsubscribe = pullJobs.subscribe(id, push);
          response.once("close", () => {
            pullStreams.delete(response);
            unsubscribe();
          });
          push();
          return;
        }
        // Every thread the host keeps, with its lead session's state, sent
        // again when one changes; and the registered repositories.
        if (url.pathname === "/api/threads/events" && request.method === "GET") {
          if (threadStreams.size >= 8)
            throw new HostError("too-many-streams", "Too many thread streams are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          threadStreams.add(response);
          response.once("close", () => threadStreams.delete(response));
          void (async () => {
            let last = "";
            while (!abort.signal.aborted && !closing) {
              const text = JSON.stringify(await listThreads());
              if (text !== last && !abort.signal.aborted) {
                last = text;
                response.write(`event: state\ndata: ${text}\n\n`);
              }
              await new Promise((done) => setTimeout(done, STATUS_MS));
            }
          })();
          return;
        }
        // Shows or hides the sessions that Med finds, or one of them.
        if (url.pathname === "/api/found" && request.method === "POST") {
          send(await found.update(foundUpdateSchema.parse(await readBody(request))));
          return;
        }
        // Claude Code and Codex sessions of any age: by words, or the ones
        // that an ID or a transcript path names (`med thread find`).
        if (url.pathname === "/api/sessions/find" && request.method === "POST") {
          const input = sessionFindSchema.parse(await readBody(request));
          const sessions =
            input.session === undefined
              ? await sessionSearch.find(input.text ?? "", input.limit ?? 20)
              : (await sessionSearch.lookup(input.session)).slice(0, input.limit ?? 20);
          send({ sessions: await sessionEntries(sessions) });
          return;
        }
        if (url.pathname === "/api/agents" && request.method === "GET") {
          send({ agents: await ownedSessions.agents() });
          return;
        }
        // The models and efforts for a new session of an agent.
        const agentChoices = /^\/api\/agents\/([a-z0-9-]{1,40})\/choices$/.exec(url.pathname);
        if (agentChoices && request.method === "GET") {
          send(await ownedSessions.choices(agentChoices[1]!));
          return;
        }
        // Sessions that Med starts in a review's repository and runs itself.
        const ownedRoute =
          /^\/api\/reviews\/([A-Za-z0-9_-]+)\/owned(?:\/([A-Za-z0-9_-]+)(\/events)?)?$/.exec(
            url.pathname,
          );
        if (ownedRoute) {
          const [, reviewId, sessionId, events] = ownedRoute;
          const bundle = await savedReviews.get(reviewId!);
          if (!sessionId && request.method === "POST") {
            const input = ownedStartSchema.parse(await readBody(request));
            const target =
              bundle.targets.find((entry) => entry.id === input.targetId) ??
              bundle.targets.find((entry) => !entry.commentReviewId) ??
              bundle.targets[0]!;
            const entry = registry.snapshot().find((item) => item.id === target.repositoryId);
            if (!entry)
              throw new HostError(
                "repository-unavailable",
                `Register the repository for ${target.repo} to start an agent there.`,
                409,
              );
            // The agent works in the reviewed checkout, such as a pull request's
            // worktree, while that checkout stays.
            const cwd = await requireRepo(target.repo).catch(() => requireRepo(entry.path));
            assertRequestAccess();
            const runner = await ownedSessions.start(input.preset, cwd, {
              ...(bundle.key ? { key: bundle.key } : {}),
              ...(input.choices ? { choices: input.choices } : {}),
            });
            const review = await savedReviews.details(
              reviewId!,
              { sessions: [runner.session] },
              assertRequestAccess,
            );
            send({ review, state: runner.state() });
            return;
          }
          const runner = sessionId ? ownedSessions.get(sessionId) : undefined;
          if (!runner || !bundle.sessions?.some((entry) => entry.id === sessionId))
            throw new HostError("session-not-owned", "Med does not run this session.", 404);
          if (events && request.method === "GET") {
            if (ownedStreams.size >= 16)
              throw new HostError("too-many-streams", "Too many session streams are open.", 503);
            response.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-store",
              connection: "keep-alive",
              "x-accel-buffering": "no",
            });
            ownedStreams.add(response);
            const push = () =>
              response.write(`event: state\ndata: ${JSON.stringify(runner.state())}\n\n`);
            const unsubscribe = runner.subscribe(push);
            response.once("close", () => {
              ownedStreams.delete(response);
              unsubscribe();
            });
            push();
            return;
          }
          if (!events && request.method === "GET") {
            send(runner.state());
            return;
          }
          if (!events && request.method === "POST") {
            const action = ownedActionSchema.parse(await readBody(request, MAX_BRIEF_BODY));
            assertRequestAccess();
            if (action.action === "prompt") await runner.prompt(action.text);
            else if (action.action === "permission") runner.answer(action.id, action.option);
            else if (action.action === "interrupt") runner.interrupt();
            else if (action.action === "setting") await runner.set(action.id, action.value);
            else ownedSessions.end(runner);
            send(runner.state());
            return;
          }
          throw new HostError("method-not-allowed", "This session action is not supported.", 405);
        }
        // Messages from the review to its agent sessions. `wait` is the long
        // poll behind `med review wait`, so it stays outside the request limit.
        const agentRoute =
          /^\/api\/reviews\/([A-Za-z0-9_-]+)\/agent(?:\/(wait|ack|messages|events))?$/.exec(
            url.pathname,
          );
        if (agentRoute) {
          const reviewId = agentRoute[1]!;
          const action = agentRoute[2];
          const bundle = await savedReviews.get(reviewId);
          const inboxState = async (): Promise<AgentInboxState> => {
            const messages = await inbox.messages(reviewId);
            const sent = new Map<string, string>();
            for (const message of messages)
              for (const id of message.noteIds)
                if ((sent.get(id) ?? "") < message.createdAt) sent.set(id, message.createdAt);
            const comments = await savedReviews.comments(reviewId);
            // The events stream asks again on each change; read the review again.
            const { briefComments } = await savedReviews.get(reviewId);
            const unsent = (comment: { id: string; updatedAt: string }) =>
              (sent.get(comment.id) ?? "") < comment.updatedAt;
            return {
              messages,
              waiting: inbox.waiting(reviewId),
              drafts: [
                ...comments.filter(unsent).map((comment) => ({
                  id: comment.id,
                  path: comment.path,
                  line: comment.line,
                  ...(comment.endLine ? { endLine: comment.endLine } : {}),
                  text: comment.text,
                  replies: comment.replies,
                })),
                ...(briefComments ?? []).filter(unsent).map((comment) => ({
                  id: comment.id,
                  path: "Notes",
                  quote: comment.quote,
                  text: comment.text,
                  replies: 0,
                })),
              ],
            };
          };
          if (!action && request.method === "GET") {
            send(await inboxState());
            return;
          }
          if (action === "events" && request.method === "GET") {
            if (inboxStreams.size >= 16)
              throw new HostError(
                "too-many-streams",
                "Too many agent inbox streams are open.",
                503,
              );
            response.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-store",
              connection: "keep-alive",
              "x-accel-buffering": "no",
            });
            inboxStreams.add(response);
            let queued = false;
            const push = () => {
              if (queued) return;
              queued = true;
              setTimeout(() => {
                queued = false;
                void inboxState()
                  .then((state) =>
                    response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`),
                  )
                  .catch(() => {});
              }, 50);
            };
            const unsubscribe = inbox.subscribe(reviewId, push);
            response.once("close", () => {
              inboxStreams.delete(response);
              unsubscribe();
            });
            push();
            return;
          }
          if (action === "messages" && request.method === "POST") {
            const input = agentMessageInputSchema.parse(
              await readBody(request, MAX_AGENT_MESSAGE_BODY),
            );
            const session = bundle.sessions?.find((entry) => entry.id === input.sessionId);
            if (!session)
              throw new HostError(
                "session-not-found",
                "This review has no such agent session.",
                404,
              );
            const parts: string[] = [];
            if (input.text.trim()) parts.push(input.text.trim());
            // The thread shows the comments as they read now.
            const drafts = input.noteIds.length ? (await inboxState()).drafts : [];
            const comments = input.noteIds.flatMap((id) =>
              drafts
                .filter((draft) => draft.id === id)
                .map(({ id: _id, replies: _replies, ...comment }) => comment),
            );
            if (input.noteIds.length) {
              const feedback = await savedReviews.feedback(reviewId, new Set(input.noteIds));
              if (feedback.count) parts.push(feedback.text);
            }
            for (const attachment of input.attachments)
              parts.push(`## ${attachment.label}\n\n${attachment.text}`);
            // An agent that Med runs and that takes images gets them in the
            // prompt. Any other agent gets the paths of saved copies.
            const runner = ownedSessions.get(session.id);
            const running = runner && runner.state().status !== "exited" ? runner : undefined;
            const native = running?.state().images ? input.images : [];
            if (input.images.length && !native.length)
              parts.push(imagesText(await saveImages(imageDirectory, input.images)));
            if (!parts.length && !native.length)
              throw new HostError(
                "empty-message",
                "Write a message or choose comments to send.",
                400,
              );
            // A session that Med runs takes the message as its next prompt.
            const message = await inbox.send(
              reviewId,
              session,
              {
                ...(input.id ? { id: input.id } : {}),
                text: input.text.trim(),
                noteIds: input.noteIds,
                comments,
                attachmentCount: input.attachments.length,
              },
              parts.join("\n\n"),
              running ? (body) => running.prompt(body, native) : undefined,
            );
            send({ message, state: await inboxState() });
            return;
          }
          if (action === "wait" && request.method === "POST") {
            const input = z
              .object({
                session: z
                  .string()
                  .regex(/^[A-Za-z0-9_-]{1,128}$/)
                  .optional(),
                timeout: z.number().int().min(1).max(25_000).default(25_000),
                // The wait confirms what it prints (ack), so a message that
                // reaches no one goes to the next wait.
                confirm: z.boolean().default(false),
              })
              .parse(await readBody(request));
            const result = await inbox.wait(
              reviewId,
              input.session,
              input.timeout,
              abort.signal,
              input.confirm,
            );
            send(
              result && "body" in result
                ? {
                    message: deliveredText(bundle.title, [{ body: result.body }]),
                    ...(input.confirm ? { ids: result.ids } : {}),
                  }
                : { message: null, ...(result ? { superseded: true } : {}) },
            );
            return;
          }
          if (action === "ack" && request.method === "POST") {
            const input = z
              .object({ ids: z.array(z.string().min(1).max(128)).min(1).max(100) })
              .parse(await readBody(request));
            await inbox.ack(reviewId, input.ids);
            send({ ok: true });
            return;
          }
          throw new HostError("method-not-allowed", "This agent action is not supported.", 405);
        }
        if (url.pathname === "/api/windows" && request.method === "GET") {
          if (windows.size >= 16)
            throw new HostError("too-many-windows", "Too many Med windows are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write(`event: ready\ndata: ${JSON.stringify({ type: "ready" })}\n\n`);
          windows.add(response);
          response.once("close", () => windows.delete(response));
          return;
        }
        const stream = request.headers["x-med-latest"];
        const latest = typeof stream === "string" && /^[\w:-]{1,100}$/.test(stream) ? stream : "";
        if (latest) latestRequests.get(latest)?.();
        if (expensiveRequests >= 8)
          throw new HostError("busy", "The host is processing other requests. Retry shortly.", 503);
        expensiveRequests++;
        let held = true;
        const release = () => {
          if (held) expensiveRequests--;
          held = false;
        };
        const replace = () => {
          abort.abort();
          release();
        };
        if (latest) latestRequests.set(latest, replace);
        try {
          const routed = routes.find(request.method, url.pathname);
          if (routed) {
            send(await routed(url, () => readBody(request), { signal: abort.signal, requireRepo }));
            return;
          }
          if (
            options.service &&
            url.pathname.startsWith("/api/service/") &&
            request.method === "POST"
          ) {
            const action = url.pathname.slice("/api/service/".length);
            const result = await options.service.request(action, await readBody(request));
            if (action === "read") {
              const file = result as { path: string; vault: { id: string; path: string } };
              send({ ...(await localFiles.open(file.path, abort.signal)), vault: file.vault });
            } else send(result);
            return;
          }
          if (options.service && url.pathname === "/api/vault/image" && request.method === "GET") {
            const image = await options.service.image(
              z.string().min(1).parse(url.searchParams.get("document")),
              z.string().min(1).parse(url.searchParams.get("href")),
              url.searchParams.get("syntax") === "markdown" ? "markdown" : "wiki",
            );
            response.writeHead(200, {
              "Content-Type": image.mime,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            });
            response.end(image.bytes);
            return;
          }
          // Tells open windows about a saved review: added to their workspace
          // list, and shown in the window used last when `open` is set.
          if (url.pathname === "/api/windows/review" && request.method === "POST") {
            const input = z
              .object({
                id: z.string().regex(/^[A-Za-z0-9_-]+$/),
                open: z.boolean().default(false),
                // A new iteration of a review the windows may already have.
                updated: z.boolean().default(false),
              })
              .parse(await readBody(request));
            const bundle = await savedReviews.get(input.id);
            const event = {
              type: "review",
              id: bundle.id,
              title: bundle.title,
              open: input.open,
              updated: input.updated,
              sessions: bundle.sessions ?? [],
            };
            for (const window of windows)
              window.write(`event: review\ndata: ${JSON.stringify(event)}\n\n`);
            send({ windows: windows.size });
            return;
          }
          // A comparison of a saved review, with its sources and images.
          const captureTarget = async (
            target: SavedReviewCreate["targets"][number],
          ): Promise<CapturedReviewTarget> => {
            const repo = await requireRepo(target.repo);
            const owner = await registry.require(repo, abort.signal);
            const info = await resolveRepository(repo, abort.signal);
            const review = await reviews.load(
              { repo, comparison: target.comparison },
              abort.signal,
            );
            if (review.files.length > 500)
              throw new HostError(
                "saved-review-too-large",
                "Narrow this review to at most 500 changed files per target.",
                413,
              );
            const sources = [];
            const images = await captureImages(review);
            let sourceBytes =
              Buffer.byteLength(review.patch) +
              images.reduce((sum, image) => sum + Buffer.byteLength(image.data, "base64"), 0);
            for (const file of review.files) {
              if (mediaType(file.path)?.kind === "image") continue;
              if (file.binary || file.tooLarge) continue;
              try {
                const source = await reviews.sources(review.id, file.path, abort.signal);
                sourceBytes += Buffer.byteLength(source.old) + Buffer.byteLength(source.new);
                if (sourceBytes > 24 * 1024 * 1024)
                  throw new HostError(
                    "saved-review-too-large",
                    "Narrow this review; captured source exceeds 24 MiB per target.",
                    413,
                  );
                sources.push(source);
              } catch (error) {
                if (
                  error instanceof HostError &&
                  ["unsupported-source", "source-unavailable", "binary-source"].includes(error.code)
                )
                  continue;
                throw error;
              }
            }
            const branch = info.branch === "Detached HEAD" ? null : info.branch;
            // A range keeps its commits, so the Guide can show them one by one,
            // and its endpoints' names, so the review's row can say them.
            const [commits, names] =
              review.comparison.kind === "range"
                ? await Promise.all([
                    loadRangeCommits(repo, review.base, review.head, abort.signal),
                    endpointNames(repo, review.comparison, review, branch, abort.signal),
                  ])
                : [];
            abort.signal.throwIfAborted();
            if (!owner.valid())
              throw new HostError(
                "repository-not-allowed",
                "The repository was removed during capture.",
                403,
              );
            return {
              repositoryId: owner.repository.id,
              repo,
              branch,
              review,
              sources,
              images,
              ...(commits ? { commits } : {}),
              ...(names ? { names } : {}),
            };
          };
          if (url.pathname === "/api/reviews" && request.method === "POST") {
            if (repository.git === false && !options.service)
              throw new HostError(
                "git-required",
                "Start med with Git repositories to create a review.",
                422,
              );
            // The brief and the guide arrive in one body.
            const input = savedReviewCreateSchema.parse(
              await readBody(request, MAX_BRIEF_BODY + MAX_GUIDE_BODY),
            );
            send(await savedReviews.create(input, captureTarget, assertRequestAccess));
            return;
          }
          // `med thread adopt`: a Claude Code or Codex session of any age
          // becomes a saved thread, as Keep in Med makes one. A session that
          // a thread names already gives that thread, back from the archive.
          if (url.pathname === "/api/sessions/adopt" && request.method === "POST") {
            const input = sessionAdoptSchema.parse(await readBody(request));
            const matches = await sessionSearch.lookup(input.session);
            if (matches.length !== 1)
              throw new HostError(
                matches.length ? "session-ambiguous" : "session-not-found",
                matches.length
                  ? `${JSON.stringify(input.session)} names ${matches.length} sessions. Give a full session ID or a transcript path.`
                  : `No Claude Code or Codex session matches ${JSON.stringify(input.session)}.`,
                matches.length ? 409 : 404,
              );
            const info = matches[0]!;
            const [entry] = await sessionEntries([info]);
            const named = (await sessionThreads()).get(info.id);
            if (named) {
              const review = named.archived
                ? await savedReviews.archive(named.id, false, assertRequestAccess)
                : await savedReviews.get(named.id);
              send({
                id: review.id,
                title: review.title,
                created: false,
                session: entry!,
              } satisfies SessionAdopted);
              return;
            }
            let repo = input.repo;
            if (!repo) {
              const place = info.cwd ? await found.locate(info.cwd) : undefined;
              if (!place?.checkout)
                throw new HostError(
                  "session-checkout",
                  !info.cwd
                    ? "The transcript does not name the session's folder. Choose a checkout with --repo <path>."
                    : place?.state === "gone" || !existsSync(info.cwd)
                      ? `The session's folder ${info.cwd} no longer exists. Choose a checkout with --repo <path>.`
                      : `The session's folder ${info.cwd} is not in a registered repository. Run med add <repository>, or choose a checkout with --repo <path>.`,
                  409,
                );
              repo = place.checkout.path;
            }
            const title = input.title ?? info.title.slice(0, 200);
            const review = await savedReviews.create(
              {
                title,
                key: `${threadSlug(title)}-${info.id.slice(0, 8)}`,
                sessions: [{ agent: info.agent, id: info.id, cwd: info.cwd ?? repo }],
                targets: [{ repo, comparison: { kind: "working" } }],
              },
              captureTarget,
              assertRequestAccess,
            );
            send({
              id: review.id,
              title: review.title,
              created: true,
              session: entry!,
            } satisfies SessionAdopted);
            return;
          }
          // A new thread: a branch in a new worktree (or the checkout itself),
          // its review, and an agent that starts on the task there.
          if (url.pathname === "/api/threads" && request.method === "POST") {
            const input = threadStartSchema.parse(await readBody(request));
            if (input.group && !input.worktree)
              throw new HostError("attempt-worktree", "Each attempt needs its own worktree.", 400);
            const entry = registry.snapshot().find((item) => item.id === input.repositoryId);
            if (!entry)
              throw new HostError("repository-not-found", "Add this repository to Med first.", 404);
            const title = input.title ?? threadTitle(input.prompt);
            const slug = threadSlug(title);
            let cwd = await requireRepo(entry.path);
            let key = `${slug}-${randomUUID().slice(0, 4)}`;
            if (input.worktree) {
              const git = (args: string[]) =>
                runProcess("git", args, { cwd: entry.path, timeoutMs: 120_000 });
              const folder = join(
                options.stateDir ?? temporaryState!,
                "worktrees",
                `${entry.name}-${entry.id.slice(0, 8)}`,
              );
              await mkdir(folder, { recursive: true });
              const base = await realpath(folder);
              const branches = new Set(
                (await git(["branch", "--format=%(refname:short)"])).stdout.toString().split("\n"),
              );
              // An attempt's branch ends in its letter, such as week-view-b.
              const stem = input.group
                ? `${slug}-${attemptLetter(input.group.attempt).toLowerCase()}`
                : slug;
              let name = stem;
              for (let n = 2; branches.has(name) || existsSync(join(base, name)); n++)
                name = `${stem}-${n}`;
              assertRequestAccess();
              await git(["worktree", "add", "-b", name, join(base, name)]);
              await registry.refreshOwner(entry.path);
              cwd = await requireRepo(join(base, name));
              key = name;
            }
            assertRequestAccess();
            const runner = await ownedSessions.start(input.preset, cwd, {
              key,
              ...(input.choices ? { choices: input.choices } : {}),
            });
            const review = await savedReviews.create(
              {
                title,
                key,
                sessions: [runner.session],
                ...(input.group ? { group: input.group } : {}),
                targets: [{ repo: cwd, comparison: { kind: "working" } }],
              },
              captureTarget,
              assertRequestAccess,
            );
            await runner.prompt(input.prompt);
            send({ review });
            return;
          }
          const browsingNotes = /^\/api\/reviews\/([^/]+)\/browsing\/([a-f0-9]{64})\/notes$/.exec(
            url.pathname,
          );
          if (browsingNotes) {
            const [, id, reviewId] = browsingNotes;
            const bundle = await savedReviews.get(id!);
            const target = bundle.targets.find((item) => item.commentReviewId === reviewId);
            if (target) {
              const family = registry.snapshot().find((item) => item.id === target.repositoryId);
              if (!family)
                throw new HostError(
                  "repository-unavailable",
                  "Register the repository to open these comments.",
                  409,
                );
              const repo = await requireRepo(family.path);
              if (
                (await registry.require(repo, abort.signal)).repository.id !== target.repositoryId
              )
                throw new HostError(
                  "repository-changed",
                  "This comment belongs to another repository.",
                  409,
                );
            } else {
              await requireReview(reviewId!);
            }
            if (request.method === "GET") {
              const state = target
                ? await savedReviews.notes(id!, target.id)
                : { reviewId: reviewId!, revision: 0, notes: [] };
              send({ ...state, reviewId });
              return;
            }
            if (request.method !== "POST")
              throw new HostError("method-not-allowed", "Use GET or POST for comments.", 405);
            const input = notesRequestSchema.parse(await readBody(request));
            if (input.reviewId !== reviewId)
              throw new HostError("invalid-note", "The comment comparison does not match.", 409);
            const state = await savedReviews.mutate(
              id!,
              target?.id ?? reviewId!,
              input.expectedRevision,
              input.mutation,
              assertRequestAccess,
              target
                ? undefined
                : async () => {
                    const review = reviews.get(await requireReview(reviewId!)).response;
                    if (review.comparison.kind === "files" || review.comparison.kind === "patch")
                      throw new HostError(
                        "git-required",
                        "Saved comments require a Git comparison.",
                        422,
                      );
                    const owner = await registry.require(review.repo, abort.signal);
                    const info = await resolveRepository(review.repo, abort.signal);
                    if (review.files.length > 500)
                      throw new HostError(
                        "saved-review-too-large",
                        "Narrow this comparison to at most 500 changed files.",
                        413,
                      );
                    const sources = [];
                    const images = await captureImages(review);
                    let bytes =
                      Buffer.byteLength(review.patch) +
                      images.reduce(
                        (sum, image) => sum + Buffer.byteLength(image.data, "base64"),
                        0,
                      );
                    for (const file of review.files) {
                      if (mediaType(file.path)?.kind === "image") continue;
                      if (file.binary || file.tooLarge) continue;
                      let source;
                      try {
                        source = await reviews.sources(reviewId!, file.path, abort.signal);
                      } catch (error) {
                        if (
                          error instanceof HostError &&
                          ["unsupported-source", "source-unavailable", "binary-source"].includes(
                            error.code,
                          )
                        )
                          continue;
                        throw error;
                      }
                      bytes += Buffer.byteLength(source.old) + Buffer.byteLength(source.new);
                      if (bytes > 24 * 1024 * 1024)
                        throw new HostError(
                          "saved-review-too-large",
                          "Comment context exceeds 24 MiB. Narrow this comparison.",
                          413,
                        );
                      sources.push(source);
                    }
                    const branch = info.branch === "Detached HEAD" ? null : info.branch;
                    const names = await endpointNames(
                      review.repo,
                      review.comparison,
                      review,
                      branch,
                      abort.signal,
                    );
                    assertRequestAccess();
                    return {
                      repositoryId: owner.repository.id,
                      repo: review.repo,
                      branch,
                      review,
                      sources,
                      images,
                      ...(names ? { names } : {}),
                    };
                  },
            );
            send({ ...state, reviewId });
            inbox.touch(id!);
            return;
          }
          if (url.pathname === "/api/reviews/by-key" && request.method === "POST") {
            const { key } = z.object({ key: reviewKeySchema }).parse(await readBody(request));
            send(await savedReviews.byKey(key));
            return;
          }
          const savedRoute =
            /^\/api\/reviews\/([^/]+)(?:\/targets\/([^/]+)\/(review|source|notes|drift)|\/(feedback|clear|brief|guide|brief-comments|pins|iterations|delete-notes|details|pull-request|codex-reviews))?$/.exec(
              url.pathname,
            );
          if (savedRoute) {
            const [, id, targetId, targetAction, action] = savedRoute;
            const bundle = await savedReviews.get(id!);
            // Saved data does not grant access to an unregistered repository family.
            const relevant = targetId
              ? bundle.targets.filter((target) => target.id === targetId)
              : !action && request.method === "GET"
                ? []
                : bundle.targets;
            if (targetId && !relevant.length)
              throw new HostError("target-not-found", "This review target does not exist.", 404);
            for (const target of relevant) {
              const entry = registry.snapshot().find((entry) => entry.id === target.repositoryId);
              if (!entry)
                throw new HostError(
                  "repository-unavailable",
                  `Register the repository for ${target.repo} to open this saved review.`,
                  409,
                );
              const available = await requireRepo(entry.path);
              const owner = await registry.require(available, abort.signal);
              if (owner.repository.id !== target.repositoryId)
                throw new HostError(
                  "repository-changed",
                  "This saved review belongs to another repository.",
                  409,
                );
            }
            if (request.method === "GET") {
              if (targetAction === "review") send(await savedReviews.review(id!, targetId!));
              else if (targetAction === "source")
                send(await savedReviews.source(id!, targetId!, url.searchParams.get("path") ?? ""));
              else if (targetAction === "notes") send(await savedReviews.notes(id!, targetId!));
              else if (targetAction === "drift") {
                // Whether captured working changes still match their checkout.
                const target = relevant[0]!;
                if (!target.captured) send({ changed: false });
                else {
                  // Later edits to its files send change events, as for a working review.
                  observe(target.repo, true);
                  const [saved, live] = await Promise.all([
                    savedReviews.review(id!, targetId!),
                    reviews.load(
                      { repo: target.repo, comparison: target.comparison },
                      abort.signal,
                    ),
                  ]);
                  send({ changed: captureChanged(saved, live) });
                }
              } else if (action === "feedback") send(await savedReviews.feedback(id!));
              else if (action === "pull-request") {
                if (!bundle.pullRequestUrl)
                  throw new HostError("no-pull-request", "This review has no pull request.", 404);
                send(
                  await loadPullRequestComments(
                    bundle.pullRequestUrl,
                    url.searchParams.get("refresh") === "1",
                  ),
                );
              } else if (action === "codex-reviews") {
                // Reviews of a head that the review shows, or run since it was saved.
                const heads = new Set(bundle.targets.map((target) => target.head));
                const runs = await codexReviews.find(
                  [...new Set(bundle.targets.map((target) => target.repo))],
                  Date.parse(bundle.createdAt) - 7 * 24 * 60 * 60 * 1000,
                );
                send({
                  runs: runs
                    .filter(
                      (run) =>
                        (run.commit && heads.has(run.commit)) || run.createdAt >= bundle.createdAt,
                    )
                    .slice(0, 20),
                });
              } else if (!action) send(bundle);
              else
                throw new HostError(
                  "method-not-allowed",
                  "Use POST for this saved review action.",
                  405,
                );
              return;
            }
            if (request.method === "POST" && targetAction === "notes") {
              const input = z
                .object({
                  expectedRevision: z.number().int().nonnegative(),
                  mutation: noteMutationSchema,
                })
                .parse(await readBody(request));
              assertRequestAccess();
              send(
                await savedReviews.mutate(
                  id!,
                  targetId!,
                  input.expectedRevision,
                  input.mutation,
                  assertRequestAccess,
                ),
              );
              inbox.touch(id!);
              return;
            }
            if (request.method === "POST" && action === "brief") {
              const input = z
                .object({ brief: z.string().nullable() })
                .parse(await readBody(request, MAX_BRIEF_BODY));
              assertRequestAccess();
              send(await savedReviews.setBrief(id!, input.brief, assertRequestAccess));
              return;
            }
            if (request.method === "POST" && action === "guide") {
              const input = z
                .object({ guide: z.unknown() })
                .parse(await readBody(request, MAX_GUIDE_BODY));
              assertRequestAccess();
              send(await savedReviews.setGuide(id!, input.guide ?? null, assertRequestAccess));
              return;
            }
            if (request.method === "POST" && action === "brief-comments") {
              const input = briefCommentMutationSchema.parse(await readBody(request));
              assertRequestAccess();
              send(await savedReviews.commentBrief(id!, input, assertRequestAccess));
              inbox.touch(id!);
              return;
            }
            if (request.method === "POST" && action === "delete-notes") {
              const input = z
                .object({
                  iteration: z.number().int().positive().optional(),
                  briefFrom: z.number().int().positive().optional(),
                })
                .parse(await readBody(request));
              assertRequestAccess();
              send(await savedReviews.deleteNotes(id!, input, assertRequestAccess));
              inbox.touch(id!);
              return;
            }
            if (request.method === "POST" && action === "iterations") {
              assertRequestAccess();
              send(await savedReviews.startNotes(id!, captureTarget, assertRequestAccess));
              return;
            }
            if (request.method === "POST" && action === "pins") {
              const input = pinMutationSchema.parse(await readBody(request, MAX_BRIEF_BODY));
              assertRequestAccess();
              send(await savedReviews.pin(id!, input, assertRequestAccess));
              return;
            }
            if (request.method === "POST" && action === "details") {
              const input = await readBody(request);
              assertRequestAccess();
              send(await savedReviews.details(id!, input, assertRequestAccess));
              return;
            }
            if (request.method === "POST" && action === "clear") {
              const input = z
                .object({ expectedRevision: z.number().int().nonnegative() })
                .parse(await readBody(request));
              assertRequestAccess();
              send(await savedReviews.clear(id!, input.expectedRevision, assertRequestAccess));
              inbox.touch(id!);
              return;
            }
            throw new HostError(
              "method-not-allowed",
              "This saved review action is not supported.",
              405,
            );
          }
          if (url.pathname === "/api/build" && request.method === "GET") {
            send({
              stale: await codeChanged(),
              entry: await currentWebEntry(),
              restart: options.service?.canRestart ?? false,
              instance,
            });
            return;
          }
          if (url.pathname === "/api/session" && request.method === "GET") {
            send(await session(await requireRepo(url.searchParams.get("repo")), abort.signal));
            return;
          }
          if (url.pathname === "/api/notes" && request.method === "GET") {
            send(notes.get(await requireReview(url.searchParams.get("reviewId") ?? "")));
            return;
          }
          if (url.pathname === "/api/repositories") {
            if (repository.git === false && !options.service) {
              if (request.method === "GET") {
                send({ repositories: [] });
                return;
              }
              throw new HostError(
                "file-only-session",
                "Open a Git session to manage repositories.",
                422,
              );
            }
            if (request.method === "GET") {
              send({ repositories: await registry.list(abort.signal) });
              return;
            }
            if (request.method === "POST") {
              const input = z
                .object({ path: z.string().min(1).max(8192) })
                .parse(await readBody(request));
              if (options.service)
                await options.service.request("add", { path: input.path, kind: "repo" });
              else await registry.register(input.path, abort.signal);
              send({ repositories: registry.snapshot() });
              return;
            }
            if (request.method === "DELETE") {
              const id = url.searchParams.get("id") ?? "";
              const entry = registry.snapshot().find((item) => item.id === id);
              if (options.service && entry) {
                const saved = options.service.sources
                  .list()
                  .find(
                    (source) => source.kind === "repo" && registry.owner(source.path)?.id === id,
                  );
                if (!saved)
                  throw new HostError(
                    "repository-not-found",
                    "This repository is not registered.",
                    404,
                  );
                await options.service.request("remove", { source: saved.id });
                send({ repositories: registry.snapshot() });
              } else send({ repositories: await registry.remove(id) });
              return;
            }
          }
          if (url.pathname === "/api/media" && ["GET", "HEAD"].includes(request.method ?? "")) {
            const path = z.string().min(1).max(4096).parse(url.searchParams.get("path"));
            const raw = JSON.parse(url.searchParams.get("source") ?? "null");
            let source,
              mediaPath = path;
            if (raw?.kind === "local") {
              if (raw.path !== path)
                throw new HostError("invalid-path", "File path does not match.", 400);
              const resolved = await localFiles.mediaSource(path);
              source = resolved.source;
              mediaPath = resolved.path;
            } else {
              source = browseSourceSchema.parse(raw);
              source.repo = await requireRepo(source.repo);
            }
            assertRequestAccess();
            await serveMedia(
              response,
              source,
              mediaPath,
              url.searchParams.get("identity"),
              request.headers.range,
              request.method === "HEAD",
              abort.signal,
              assertRequestAccess,
            );
            return;
          }
          if (url.pathname === "/api/review-image" && request.method === "GET") {
            const path = z.string().min(1).max(4096).parse(url.searchParams.get("path"));
            const side = z.enum(["old", "new"]).parse(url.searchParams.get("side"));
            let image;
            const saved = url.searchParams.get("saved");
            if (saved) {
              const targetId = url.searchParams.get("target") ?? "";
              const savedImage = await savedReviews.image(saved, targetId, path, side);
              const family = registry
                .snapshot()
                .find((item) => item.id === savedImage.repositoryId);
              if (!family)
                throw new HostError(
                  "repository-unavailable",
                  "Register this review's repository to view its images.",
                  409,
                );
              await requireRepo(family.path);
              image = savedImage;
            } else {
              const reviewId = await requireReview(url.searchParams.get("reviewId") ?? "");
              image = await reviews.image(reviewId, path, side, abort.signal);
            }
            assertRequestAccess();
            response.writeHead(200, {
              ...mediaHeaders,
              "Content-Type": image.mime,
              "Content-Length": image.bytes.length,
            });
            response.end(image.bytes);
            return;
          }
          if (url.pathname === "/api/markdown/image" && request.method === "GET") {
            const document = z.string().min(1).max(4096).parse(url.searchParams.get("document"));
            const href = z.string().min(1).max(4096).parse(url.searchParams.get("href"));
            const rawSource = JSON.parse(url.searchParams.get("source") ?? "null");
            let image;
            if (rawSource?.kind === "local") {
              const path = localPathSchema.parse(rawSource.path);
              if (path !== document)
                throw new HostError("invalid-image", "Document path does not match.", 400);
              image = await localFiles.image(path, href, abort.signal);
            } else {
              const source = browseSourceSchema.parse(rawSource);
              source.repo = await requireRepo(source.repo);
              image = await markdownAsset(source, document, href, abort.signal);
            }
            response.writeHead(200, {
              "Content-Type": image.mime,
              "Content-Length": image.bytes.length,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            });
            response.end(image.bytes);
            return;
          }
          if (url.pathname === "/api/local-files/open" && request.method === "POST") {
            const input = z.object({ path: localPathSchema }).parse(await readBody(request));
            send(await localFiles.open(input.path, abort.signal));
            return;
          }
          if (url.pathname === "/api/local-files/write" && request.method === "POST") {
            const input = z
              .object({
                path: localPathSchema,
                expectedIdentity: z.string().min(1).max(8192),
                text: z.string().max(1024 * 1024),
              })
              .parse(await readBody(request, 8 * 1024 * 1024));
            send(await localFiles.write(input.path, input.expectedIdentity, input.text));
            return;
          }
          if (url.pathname === "/api/browse/changes" && request.method === "POST") {
            const input = fileChangesRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            let comparison;
            if (input.saved) {
              const { id, target } = input.saved;
              const bundle = await savedReviews.get(id);
              const saved = bundle.targets.find((entry) => entry.id === target);
              const owner = await registry.require(input.source.repo, abort.signal);
              if (!saved || saved.repositoryId !== owner.repository.id)
                throw new HostError(
                  "invalid-source",
                  "The saved comparison belongs to another repository.",
                  403,
                );
              comparison = {
                review: await savedReviews.review(id, target),
                source: (path: string) => savedReviews.source(id, target, path),
              };
            } else if (input.reviewId) {
              await requireReview(input.reviewId);
              comparison = {
                review: reviews.get(input.reviewId).response,
                source: (path: string) => reviews.sources(input.reviewId!, path, abort.signal),
              };
            }
            send(
              await fileChanges(input.source, input.path, input.identity, comparison, abort.signal),
            );
            return;
          }
          if (url.pathname === "/api/browse/list" && request.method === "POST") {
            const input = browseListRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            send(await listBrowse(input.source, input.ignored, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/write" && request.method === "POST") {
            const input = browseWriteRequestSchema.parse(await readBody(request, 8 * 1024 * 1024));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              await writeBrowse(
                input.source,
                input.path,
                input.expectedIdentity,
                input.text,
                assertRequestAccess,
              ),
            );
            return;
          }
          if (url.pathname === "/api/browse/read" && request.method === "POST") {
            const input = browseReadRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            send(await readBrowse(input.source, input.path, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/symbols" && request.method === "POST") {
            const input = symbolSearchRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              input.path
                ? await symbols.search(input, abort.signal)
                : await registry.withSearch(input.source.repo, (search) =>
                    search.symbols(input.source, input.query, abort.signal),
                  ),
            );
            return;
          }
          if (url.pathname === "/api/browse/search" && request.method === "POST") {
            const input = browseSearchRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              await registry.withSearch(input.source.repo, (search) =>
                search.search(input.source, input.query, abort.signal),
              ),
            );
            return;
          }
          if (url.pathname === "/api/search/status" && request.method === "GET") {
            const repo = await requireRepo(url.searchParams.get("repo"));
            send(
              repository.git === false && !options.service
                ? { state: "unavailable", message: "This is a file comparison.", branches: [] }
                : await registry.withSearch(repo, (search) => search.status()),
            );
            return;
          }
          if (url.pathname === "/api/browse/blame" && request.method === "POST") {
            const input = browseBlameRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(await blameBrowse(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/git/targets" && request.method === "GET") {
            send(await gitTargets(await requireRepo(url.searchParams.get("repo")), abort.signal));
            return;
          }
          if (url.pathname === "/api/git/push" && request.method === "POST") {
            const input = pushRequestSchema.parse(await readBody(request));
            input.repo = await requireRepo(input.repo);
            send(await pushBranch(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/branches" && request.method === "GET") {
            const repo = await requireRepo(url.searchParams.get("repo"));
            if (repository.git === false && !options.service) {
              send([]);
              return;
            }
            await registry.refreshOwner(repo, abort.signal);
            send((await registry.require(repo, abort.signal)).repository.branches);
            return;
          }
          if (url.pathname === "/api/history" && request.method === "GET") {
            if (repository.git === false && !options.service) {
              send({ commits: [], cursor: null, hasMore: false });
              return;
            }
            send(
              await loadHistory(
                await requireRepo(url.searchParams.get("repo")),
                url.searchParams.get("cursor"),
                Number(url.searchParams.get("limit") ?? 50),
                abort.signal,
                url.searchParams.get("ref") ?? undefined,
              ),
            );
            return;
          }
          if (url.pathname === "/api/commit" && request.method === "GET") {
            send(
              await loadCommitDetails(
                await requireRepo(url.searchParams.get("repo")),
                url.searchParams.get("id") ?? "",
                abort.signal,
              ),
            );
            return;
          }
          // Closing a workspace can remove its linked worktree. Git keeps one
          // with changes; an agent that works there keeps it too.
          if (url.pathname === "/api/worktrees/remove" && request.method === "POST") {
            const input = z
              .object({ path: z.string().min(1).max(8192) })
              .parse(await readBody(request));
            await removeLinkedWorktree(input.path, abort.signal);
            send({ removed: true });
            return;
          }
          // Archiving a thread can remove the worktree that Med made for it.
          const archive = /^\/api\/threads\/(r_[a-f0-9]{24})\/archive$/.exec(url.pathname);
          if (archive && request.method === "POST") {
            const input = z
              .object({ archived: z.boolean(), removeWorktree: z.boolean().default(false) })
              .parse(await readBody(request));
            const id = archive[1]!;
            if (input.archived && input.removeWorktree) {
              const review = await savedReviews.get(id);
              const path = (
                review.targets.find((entry) => !entry.commentReviewId) ?? review.targets[0]
              )?.repo;
              const linked =
                !!path &&
                registry.owner(path)?.worktrees.some((tree) => tree.path === path && tree.linked);
              if (linked) {
                // Another thread that works there keeps the worktree.
                const others = (await savedReviews.list()).filter(
                  (entry) =>
                    entry.id !== id &&
                    !entry.archivedAt &&
                    entry.targets.some((target) => target.repo === path),
                );
                if (others.length)
                  throw new HostError(
                    "worktree-shared",
                    `"${others[0]!.title}" works in this worktree too.`,
                    409,
                  );
                await removeLinkedWorktree(path, abort.signal);
              }
            }
            send({ review: await savedReviews.archive(id, input.archived, assertRequestAccess) });
            return;
          }
          if (url.pathname === "/api/reveal" && request.method === "POST") {
            const input = z
              .object({ repo: z.string().optional(), path: z.string().min(1) })
              .parse(await readBody(request));
            const repo = await requireRepo(input.repo ?? null);
            const target = resolve(repo, input.path);
            const inside = relative(repo, target);
            if (!inside || inside.startsWith("..") || isAbsolute(inside))
              throw new HostError("path-not-allowed", "Choose a file in this repository.", 403);
            if (!(await lstat(target).catch(() => null)))
              throw new HostError("not-found", "This file is not in the working tree.", 404);
            (options.reveal ?? revealInFileManager)(target);
            send({ revealed: true });
            return;
          }
          if (url.pathname === "/api/review" && request.method === "POST") {
            const input = reviewRequestSchema.parse(await readBody(request));
            input.repo = await requireRepo(input.repo);
            if (
              repository.git === false &&
              !options.service &&
              input.comparison.kind !== "patch" &&
              input.comparison.kind !== "files"
            )
              throw new HostError(
                "not-a-git-repository",
                "This directory supports patch and file inputs only.",
                422,
              );
            if (repository.git !== false || options.service)
              observe(
                input.repo,
                browseLiveSources.has(input.repo) ||
                  input.comparison.kind === "working" ||
                  input.comparison.kind === "unstaged",
              );
            const review = await reviews.load(input, abort.signal);
            abort.signal.throwIfAborted();
            notes.adopt(review.id);
            send(review);
            return;
          }
          if (url.pathname === "/api/source" && request.method === "GET") {
            send(
              await reviews.sources(
                await requireReview(url.searchParams.get("reviewId") ?? ""),
                url.searchParams.get("path") ?? "",
                abort.signal,
              ),
            );
            return;
          }
          if (url.pathname === "/api/notes" && request.method === "POST") {
            const input = notesRequestSchema.parse(await readBody(request));
            send(
              await notes.mutate(
                await requireReview(input.reviewId),
                input.expectedRevision,
                input.mutation,
                abort.signal,
              ),
            );
            return;
          }
        } finally {
          release();
          if (latestRequests.get(latest) === replace) latestRequests.delete(latest);
        }
        throw new HostError("not-found", "This API route does not exist.", 404);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new HostError("method-not-allowed", "Use GET for application files.", 405);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new HostError("invalid-path", "This URL path is not valid.");
      }
      const appRoute =
        path === "/sources" ||
        path === "/sessions" ||
        path === "/welcome" ||
        path === "/elements" ||
        path.startsWith("/vault/") ||
        path === "/file" ||
        path.startsWith("/file/") ||
        path === "/files" ||
        path === "/search" ||
        path.startsWith("/attempts/") ||
        path === "/" ||
        /^\/review\/[a-zA-Z0-9_-]+$/.test(path);
      const file = resolve(webRoot, `.${appRoute ? "/index.html" : path}`);
      const rel = relative(webRoot, file);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new HostError("invalid-path", "This asset path is not valid.", 403);
      let data: Buffer;
      try {
        const embedded = await embeddedAssets?.(appRoute ? "/index.html" : path);
        if (embedded) data = Buffer.from(embedded);
        else {
          const info = await stat(file);
          if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("not an asset");
          data = await readFile(file);
        }
      } catch {
        if (appRoute) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(
            "<!doctype html><title>Med host</title><p>The review host is ready. Build the web application to serve its interface.</p>",
          );
          return;
        }
        throw new HostError("not-found", "This application asset does not exist.", 404);
      }
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        // Build assets and fonts keep their content in their names. Browsers
        // revalidate the manifest and icons so an installed app sees updates.
        "cache-control":
          appRoute || path.endsWith(".html")
            ? "no-store"
            : path.startsWith("/assets/") || path.startsWith("/fonts/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : data);
    })()
      .catch((error: unknown) => {
        if (response.headersSent || response.destroyed) {
          response.destroy();
          return;
        }
        const cancelled = error instanceof Error && error.name === "AbortError";
        const status = cancelled
          ? 499
          : error instanceof HostError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : error instanceof ProcessFailure
                ? error.code === "output-too-large"
                  ? 413
                  : error.code === "cancelled"
                    ? 499
                    : 422
                : 500;
        const code = cancelled
          ? "cancelled"
          : error instanceof HostError || error instanceof ProcessFailure
            ? error.code
            : error instanceof z.ZodError
              ? "invalid-request"
              : "internal-error";
        const message =
          error instanceof Error ? error.message : "The host could not complete the request.";
        json(response, status, { error: { code, message } } satisfies ApiError);
      })
      .finally(() => {
        activeRequests.delete(abort);
      });
  };
  const server = createServer(handle);
  // Bun's closeAllConnections() keeps a connection whose request still runs,
  // such as a pull request's comments from gh, so close() ends each socket.
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // A page's live stream as a WebSocket: the same events as /api/live sends,
  // without holding one of the browser's six connections to the host.
  server.on("upgrade", async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host;
    const url = new URL(request.url ?? "/", `http://${host ?? "127.0.0.1"}`);
    const cookie = request.headers.cookie
      ?.split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`med_session_${port}=`))
      ?.slice(`med_session_${port}=`.length);
    const allowed =
      !closing &&
      (host === `127.0.0.1:${port}` || host === `localhost:${port}`) &&
      (!request.headers.origin || request.headers.origin === `http://${host}`) &&
      url.pathname === "/api/live" &&
      lives.size < 32 &&
      timingSafeEqual(
        tokenDigest,
        createHash("sha256")
          .update(cookie ?? "")
          .digest(),
      );
    const peer = allowed
      ? await acceptWebSocket(request, socket, head).catch(() => undefined)
      : undefined;
    if (!peer) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const id = randomUUID();
    const channels = new Map<string, ChannelResponse>();
    lives.set(id, { response: peer, channels });
    peer.send(`event: live\ndata: ${JSON.stringify({ id })}\n\n`);
    peer.onClose(() => {
      lives.delete(id);
      for (const channel of channels.values()) channel.destroy();
    });
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The local server did not open a TCP port.");
  port = address.port;
  const clearConnection = options.stateDir
    ? await publishConnection(options.stateDir, {
        origin: `http://127.0.0.1:${port}`,
        token,
        pid: process.pid,
        version: 1,
      })
    : undefined;
  if (options.open) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    const child = spawn(command, [`http://127.0.0.1:${port}/#token=${token}`], {
      stdio: "ignore",
      detached: true,
      shell: false,
    });
    child.on("error", () => {
      /* The caller still receives a usable launch URL. */
    });
    child.unref();
  }
  const heartbeat = setInterval(() => {
    for (const stream of [...streams.keys(), ...windows]) stream.write(": heartbeat\n\n");
    for (const { response } of lives.values()) response.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();
  return {
    url: `http://127.0.0.1:${port}/${options.fileMode ? "files" : ""}#token=${token}`,
    token,
    port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      await ownedSessions.stopAll();
      closeTranscripts();
      found.close();
      checkoutWork.close();
      for (const abort of activeRequests.keys()) abort.abort();
      for (const stream of [...streams.keys(), ...windows]) stream.end();
      // A channel's handler stops when its response closes. Bun does not emit
      // "close" for a live stream that the host ends, so end the channels here.
      for (const { response, channels } of lives.values()) {
        for (const channel of channels.values()) channel.destroy();
        response.end();
      }
      streams.clear();
      windows.clear();
      await Promise.allSettled([...watchers.values()].map(async (stop) => (await stop)()));
      await Promise.allSettled(retiringWatchers);
      await options.service?.close();
      await registry.close();
      reviews.clear();
      notes.clear();
      await clearConnection?.();
      if (temporaryState) await rm(temporaryState, { recursive: true, force: true });
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
      await options.onClose?.();
    },
  };
}
