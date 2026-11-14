import { serveMedia, mediaHeaders } from "./media";
import { imagesText, pruneImages, saveImages } from "./prompt-images";
import { mediaType } from "../shared/media";
import { fileChangesRequestSchema } from "../shared/file-changes";
import { fileChanges } from "./repository/file-changes";
import { markdownAsset } from "./markdown-assets";
import { browseSourceSchema, type BrowseRead } from "../shared/browse";
import { LocalFiles } from "./local-files";
import { ChannelResponse, channelRequest, LIVE_PATH, liveInputSchema } from "./live-streams";
import { PullJobs } from "./pull-workspace";
import { isPullReviewKey, parsePullUrl, pullStartSchema } from "../shared/pull-workspace";
import { localPathSchema } from "../shared/local-file";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, relative, isAbsolute, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { normalizeDiffMetadataPaths } from "../shared/hunk/diffPaths";
import {
  apiErrorMessage,
  comparisonKey,
  MAX_COMPARISON_PATHS,
  notesRequestSchema,
  noteMutationSchema,
  reviewRequestSchema,
  type ApiError,
  type ChangeEvent,
  type Comparison,
  type NoteState,
  type Repository,
  type ReviewRequest,
  type ReviewResponse,
  type Session,
} from "../shared/protocol";
import { gitTargets, pushBranch } from "./repository/git-actions";
import {
  commitStaged,
  discardChanges,
  pushCurrentBranch,
  stageHunk,
  stagePaths,
  workingFileChanges,
  workingStatus,
} from "./repository/commit-flow";
import { commitRoutes, pushRequestSchema } from "../shared/git-actions";
import { route, routeTable } from "./routes";
import { createDependencyInfo } from "./dependency-info";
import { declareGenerated } from "./repository/generated";
import { generatedRoutes } from "../shared/generated";
import {
  endpointNames,
  loadCommitDetails,
  loadHistory,
  loadRangeCommits,
  resolveRepository,
} from "./repository/history";
import {
  changePendingReview,
  loadPullRequestComments,
  type PendingReviewChange,
} from "./repository/pull-request";
import {
  loadDescriptionImage,
  loadLivePullRequest,
  readCheckLog,
} from "./repository/pull-request-live";
import { ReviewService } from "./repository/review";
import { HostError } from "./runtime/errors";
import { ProcessFailure } from "./runtime/process";
import { watchRepository, type WatchOptions } from "./runtime/watch";
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
import {
  symbolHoverRequestSchema,
  symbolSearchRequestSchema,
  type SymbolHover,
  type SymbolHoverRequest,
  type SymbolSearch,
} from "../shared/symbols";
import { definitionText } from "../shared/definition-text";
import { PullInboxReader } from "./pull-inbox";
import { FileSymbolService, WorkingTreeSymbols } from "./search/symbols";
import { type SearchOptions } from "./search/service";
import { BasePulls } from "./repository/base-pull";
import { RepositoryRegistry } from "./repository/registry";
import { Memo } from "./repository/cache";
import { CheckoutRevisions } from "./repository/events";
import { removeWorktree } from "./repository/worktrees";
import { runProcess } from "./runtime/process";
import {
  prepareSuperagentFolder,
  SUPERAGENT_CHOICES,
  SUPERAGENT_KEY,
  SUPERAGENT_TITLE,
  superagentBrief,
  superagentFolder,
} from "./superagent";
import { acceptWebSocket } from "./runtime/websocket";
import { CodexReviews } from "./codex-reviews";
import { replyHelp, SavedReviewStore, type CommitLens } from "./saved-reviews";
import { createThreadService } from "./thread-service";
import { createThreadSubagents } from "./thread-subagents";
import {
  createTranscriptFeeds,
  findTranscript,
  readTranscriptPage,
  transcriptPoint,
  transcriptTurns,
} from "./agent-transcripts";
import { AgentInbox } from "./agent-inbox";
import { createQueuedMessages } from "./queued-messages";
import {
  agentEnvironment as startedAgentEnvironment,
  CONTINUE_TURN,
  findAgents,
  OwnedSessions,
  type RunnableAgent,
} from "./owned-sessions";
import { loadShellEnvironment } from "./shell-environment";
import { createAgentStatus } from "./agent-status";
import { createSessionIndex } from "./session-index";
import { createThreadStore } from "./thread-store";
import { createThreadComments } from "./thread-comments";
import { migrateTabs } from "./thread-migration";
import { createSessionSearch, sessionEntry, type SessionInfo } from "./session-search";
import { createCheckoutWork } from "./checkout-work";
import { createPullRequestLinks } from "./pull-request-links";
import {
  codeHosts,
  createHostProbe,
  findEditors,
  hostKind,
  launchEditor,
  listedEditors,
  openInLinks,
  openInSettings,
  type Editor,
} from "./open-in";
import { createSettingsFile, SETTING_KEY, settingsPath } from "./settings-file";
import { createThreadFeed } from "./thread-feed";
import { createCheckoutChanges } from "./checkout-changes";
import { createSessionEdits } from "./session-edits";
import { createSessionUsage } from "./session-usage";
import { usageRoutes } from "../shared/model-usage";
import {
  foundUpdateSchema,
  sessionAdoptSchema,
  sessionFindSchema,
  type SessionAdopt,
  type SessionAdopted,
} from "../shared/found-sessions";
import {
  ownedActionSchema,
  ownedStartSchema,
  sessionForkSchema,
  type SessionForked,
} from "../shared/owned-session";
import {
  threadCloseSchema,
  threadIdSchema,
  threadMarksSchema,
  threadNextSchema,
  threadOpenSchema,
  threadNameSchema,
  threadPinSchema,
  threadSeenSchema,
  threadSlug,
  threadStartSchema,
  threadTitle,
  parseSessionKey,
  sessionKey,
  REVIEW_ID,
  threadOfReview,
} from "../shared/threads";
import {
  agentMessageInputSchema,
  type AgentInboxState,
  type SentComment,
  type SessionPlace,
} from "../shared/agent-inbox";
import type { SessionEvent } from "../shared/agent-session";
import {
  fileCommentMutationSchema,
  reviewKeySchema,
  savedReviewCreateSchema,
  savedReviewDetailsSchema,
  reviewCheckout,
  type AgentSession,
  type CapturedReviewTarget,
  type PullRequestState,
  type SavedReviewCreate,
} from "../shared/saved-review";
import { defaultStateDirectory, getPersistentToken, publishConnection } from "./runtime/connection";
import { medCommand } from "./runtime/med-command";
import { ownedEnvironment, writeMedCommand } from "./thread-agents";
import { lastSaid } from "../shared/comment-thread";

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
  /**
   * The settings file. Med's own state folder uses ~/.config/med/settings.json;
   * another state folder, such as a trial's or a test's, keeps its own
   * settings.json in that folder, so it never changes the reader's Med.
   */
  settingsPath?: string;
  /** Open in's editors, code hosts, and launches; tests replace them. */
  openIn?: {
    editors?(): Promise<Editor[]>;
    isGitHub?(host: string): Promise<boolean>;
    launch?(editor: Editor, file: string, line: number): void;
  };
  /** The agents Med can start; tests replace the installed ones. */
  agents?: () => Promise<RunnableAgent[]>;
  /** The GitHub CLI that opens pull requests; tests give a fake one. */
  gh?: { command: string; args: string[] };
  /** deps.dev's origin for dependency lookups; tests give a local server. */
  dependencyApi?: string;
  /** The command that runs this Med again; agents that Med starts get it as `med`. */
  cli?: readonly string[];
  /** Whether the thread list shows sessions that no review names, until the
   * reader chooses (default true). The CLI turns it off for a state folder
   * other than Med's own, so that a second Med lists only its own threads. */
  foundSessions?: boolean;
  /** Offer Antigravity (`agy`): off unless `MED_AGY=1` (default false). */
  agy?: boolean;
  /** Pull each repository's base branch now and then (`BasePulls`): on for
   * Med's own service and review, off for tests and another state folder.
   * Tests give their own times. */
  basePull?: boolean | { delayMs?: number; intervalMs?: number };
  /** Repository watchers. Tests turn file events off, change the safety
   * check, and learn when a watcher that sees file edits is ready. */
  watch?: WatchOptions & { onReady?: (repo: string) => void };
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
/** Definitions that a hover shows; `gd` lists all of them. */
const MAX_HOVER_DEFINITIONS = 3;
// A prompt holds up to 100,000 characters; UTF-8 can need four bytes for one.
const MAX_PROMPT_BODY = 512 * 1024;
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
  const workingSymbols = new WorkingTreeSymbols();
  /** Symbols in a checkout's working files. They read again only when the
   * checkout's files or Git state changed; see `checkoutState`. */
  const projectSymbols = async (repo: string, query: string, signal: AbortSignal) =>
    workingSymbols.search(
      repo,
      query,
      signal,
      await checkoutState(repo, true).catch(() => undefined),
    );
  /** The definitions of a name that a hover shows: in its own file first,
   * then in the project, as `gd` looks; each with its declaration and doc
   * comment from its file. */
  const hoverSymbol = async (
    input: SymbolHoverRequest,
    signal: AbortSignal,
  ): Promise<SymbolHover> => {
    const base = {
      source: input.source,
      path: input.path,
      identity: input.identity,
      name: input.name,
      definitions: [],
      more: 0,
    };
    const exact = (search: SymbolSearch) =>
      search.matches
        .filter((match) => match.name === input.name)
        .map((match) => ({ match, source: search.resultSource ?? search.source }));
    const local = await symbols.search(
      { source: input.source, path: input.path, identity: input.identity, query: input.name },
      signal,
    );
    // A diff's side names no identity: its version is the commit's, or the
    // working tree's now.
    if (input.identity && local.identity !== input.identity)
      return { ...base, unavailable: local.unavailable ?? "This file changed." };
    let found = exact(local);
    let unavailable = local.unavailable;
    if (!found.length) {
      const project =
        (input.source.kind === "worktree" &&
          (await projectSymbols(input.source.repo, input.name, signal))) ||
        (await registry.withSearch(input.source.repo, (search) =>
          search.symbols(input.source, input.name, signal),
        ));
      found = exact(project);
      unavailable = project.unavailable;
    }
    const reads = new Map<string, Promise<BrowseRead | undefined>>();
    const definitions = await Promise.all(
      found.slice(0, MAX_HOVER_DEFINITIONS).map(async ({ match, source }) => {
        const key = JSON.stringify([source, match.path]);
        let read = reads.get(key);
        if (!read) {
          read = readBrowse(source, match.path, signal).catch(() => undefined);
          reads.set(key, read);
        }
        const file = await read;
        const text =
          file?.kind === "text" && file.text !== undefined
            ? definitionText(file.text, match.line)
            : { signature: [], doc: [] };
        return { ...match, source, ...text };
      }),
    );
    return {
      ...base,
      definitions,
      more: found.length - definitions.length,
      ...(!definitions.length && unavailable ? { unavailable } : {}),
    };
  };
  const localFiles = new LocalFiles();
  const temporaryState = options.stateDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "med-reviews-"));
  // The Superagent's folder (superagent.ts), which the lists of repositories
  // leave out.
  const superagentPath = superagentFolder(options.stateDir ?? temporaryState!);
  let superagentReal = existsSync(superagentPath) ? await realpath(superagentPath) : superagentPath;
  const isSuperagentRepo = (path: string) => path === superagentReal || path === superagentPath;
  const visibleRepositories = () =>
    registry.snapshot().filter((entry) => !isSuperagentRepo(entry.path));
  // The threads: tabs and the archive (thread-store.ts). Past the byte
  // budget, the reviews of the threads archived first give up their captures.
  const store = createThreadStore({
    file: join(options.stateDir ?? temporaryState!, "threads.json"),
  });
  const savedReviews = new SavedReviewStore(join(options.stateDir ?? temporaryState!, "reviews"), {
    evictable: () => threads.archivedReviews(),
    evicted: () => {},
  });
  // Comments on lines of files, by thread (thread-comments.ts).
  const threadComments = createThreadComments(
    join(options.stateDir ?? temporaryState!, "thread-comments"),
  );
  const inbox = new AgentInbox(join(options.stateDir ?? temporaryState!, "agent-messages"));
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
  // The login service reads the user's shell environment before any agent
  // starts, so agents get the tokens and PATH that a terminal gives them.
  await loadShellEnvironment();
  // Sessions that Med starts. ACP sessions keep their updates in the state
  // directory, and the sessions from before a restart come back first.
  const ownedSessions = new OwnedSessions({
    agents: options.agents ?? (() => findAgents(options.stateDir)),
    holderDirectory: join(options.stateDir ?? temporaryState!, "agents"),
    logDirectory: join(options.stateDir ?? temporaryState!, "sessions"),
    offersFile: join(options.stateDir ?? temporaryState!, "agent-offers.json"),
    recordsFile: join(options.stateDir ?? temporaryState!, "owned-sessions.json"),
    environment: agentEnvironment,
    agy: options.agy ?? process.env.MED_AGY === "1",
  });
  await ownedSessions.restore();
  /** The history of a fork before its first prompt, which has no transcript
   * yet: the transcript of the session that it forks, up to the fork's
   * message (`end`, a byte offset). */
  const forkSource = async (session: AgentSession) => {
    const point = ownedSessions.forkPoint(session.id);
    if (!point || session.agent !== "claude") return undefined;
    const parent: AgentSession = { agent: "claude", id: point.of, cwd: session.cwd };
    const path = await findTranscript(parent);
    if (!path) return undefined;
    const end = point.at ? (await transcriptPoint(path, point.at))?.end : (await stat(path)).size;
    return end === undefined ? undefined : { session: parent, path, end };
  };
  /**
   * The review's sessions that Med does not run now, or restored without a
   * process: those that another process has open, such as Claude Code in a
   * terminal or a thread in Codex Desktop, with where each is open, and the
   * Claude sessions that a message resumes in Med. Med cannot type into
   * another process: the reader sees the thread, and Fork in Med forks it.
   */
  const sessionPlaces = async (sessions: readonly AgentSession[] = [], maxAgeMs = 1000) => {
    const ids = sessions.flatMap((session) => {
      const runner = ownedSessions.get(session.id);
      return session.agent === "claude" &&
        (!runner || (runner.dormant() && runner.state().status !== "exited"))
        ? [session.id]
        : [];
    });
    const running = ids.length
      ? await ownedSessions.elsewhere(ids, maxAgeMs)
      : new Map<string, SessionPlace>();
    const codex = await Promise.all(
      sessions
        .filter((session) => session.agent === "codex" && !ownedSessions.get(session.id))
        .map(async (session): Promise<[string, SessionPlace][]> =>
          (await ownedSessions.lockedElsewhere("codex", session.id).catch(() => false))
            ? [[session.id, "other-app"]]
            : [],
        ),
    );
    return {
      elsewhere: Object.fromEntries<SessionPlace>([...running, ...codex.flat()]),
      resumable: ids.filter((id) => !running.has(id)),
    };
  };
  // Messages that came while an agent that Med runs worked.
  const queuedMessages = createQueuedMessages({
    inbox,
    runner: (sessionId) => ownedSessions.get(sessionId),
  });
  for (const { reviewId, sessionId } of await inbox.queued())
    queuedMessages.watch(reviewId, sessionId);
  const ownedStreams = new Set<ServerResponse>();
  const codexReviews = new CodexReviews();
  const reviewStatus = createAgentStatus({
    owned(sessionId) {
      const runner = ownedSessions.get(sessionId);
      return runner && { state: runner.state(), updatedAt: ownedSessions.updatedAt(sessionId) };
    },
    logPath: (sessionId) =>
      join(options.stateDir ?? temporaryState!, "sessions", `${sessionId}.jsonl`),
  });
  // The windows' thread lists.
  const threadStreams = new Set<ServerResponse>();
  // The `med thread wait` requests that wait for the next list.
  const threadWaits = new Set<(text: string | undefined) => void>();
  /**
   * A token that stays the same while a checkout's commits, and with
   * `working` its files, stay the same (repository/cache.ts,
   * repository/events.ts). The registry and the revisions come later in
   * this function; a call before them fails, and the caller reads Git.
   */
  async function checkoutState(checkout: string, working: boolean) {
    const metadata = await registry.gitState(checkout);
    if (!metadata || !working) return metadata;
    const files = revisions.token(checkout);
    return files && `${files}\n${metadata}`;
  }
  // The thread list reads again when a checkout's counts or work change. The
  // feed comes later in this function.
  let listChanged = () => {};
  // The counts of each thread's live Changes, for its row. Reads run only
  // when the checkout's Git state or files changed.
  const checkoutChanges = createCheckoutChanges({
    state: (checkout) => checkoutState(checkout, true),
    onChange: () => listChanged(),
  });
  // The files that each agent session edited, for "Only this session's files",
  // and the commands that wrote generated files.
  const sessionEdits = createSessionEdits();
  const sessionUsage = createSessionUsage();
  // Dependency licences and release dates, once the reader turns them on.
  const dependencyInfo = createDependencyInfo({
    stateDir: options.stateDir ?? temporaryState!,
    api: options.dependencyApi,
  });
  // Every agent session that Med lists, from its transcript: where it works
  // now, and the recent ones that worked in a registered repository.
  const found = createSessionIndex({
    repositories: () => registry.snapshot(),
    refreshRepositories: () => registry.list(),
    settingsFile: join(options.stateDir ?? temporaryState!, "found-sessions.json"),
    shown: options.foundSessions ?? true,
  });
  await found.restore();
  // Sessions of any age, for `med thread find` and `med thread adopt`.
  const sessionSearch = createSessionSearch({
    codexNames: () => found.codexNames(),
  });
  /** The thread of each session that Med keeps: by its ID, or for a
   * session that Med runs through ACP, by the agent's own ID. */
  const sessionThreads = async () => {
    const known = new Map<string, { id: string; archived?: boolean }>();
    for (const id of store.ids()) {
      const session = parseSessionKey(id);
      // `archived`: the thread is archived, not a tab.
      if (session) known.set(session.id, { id, ...(!store.isOpen(id) && { archived: true }) });
    }
    for (const [own, id] of ownedSessions.agentSessions()) {
      const thread = known.get(id);
      if (thread && !known.has(own)) known.set(own, thread);
    }
    return known;
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
  // Reads run only when a checkout's Git state or, for working changes, its
  // files changed (repository/cache.ts, repository/events.ts).
  const checkoutWork = createCheckoutWork({
    state: checkoutState,
    onChange: () => listChanged(),
  });
  // The open pull request of a tab's branch, for a thread that has none yet.
  const settingsFile = createSettingsFile(
    options.settingsPath ??
      (options.stateDir && resolve(options.stateDir) === defaultStateDirectory()
        ? settingsPath()
        : join(options.stateDir ?? temporaryState!, "settings.json")),
  );
  const settingsStreams = new Set<ServerResponse>();
  const pullRequestLinks = createPullRequestLinks({
    gh: options.gh ?? { command: "gh", args: [] },
    refs: (checkout) => checkoutState(checkout, false),
    async link(reviewId, pull) {
      // The agent or the reader can link one first.
      if ((await savedReviews.get(reviewId)).pullRequestUrl) return;
      await savedReviews.details(reviewId, {
        pullRequestUrl: pull.url,
        pullRequestTitle: pull.title,
      });
      listChanged();
    },
  });
  // What GitHub said last of each pull request, from the reads that a review
  // on screen or a pull request's job makes. The thread list names it beside
  // each review, and asks GitHub nothing itself.
  const pullStates = new Map<string, PullRequestState>();
  const rememberPull = (url: string, state: PullRequestState | undefined) => {
    if (!state || pullStates.get(url) === state) return;
    pullStates.set(url, state);
    listChanged();
  };
  // The tabs and history; the thread list polls only the tabs.
  const threads = createThreadService({
    savedReviews,
    store,
    sessions: found,
    repositories: visibleRepositories,
    status: reviewStatus,
    lastMessage: (threadId) => inbox.last(threadId),
    owned: () => ownedSessions.sessions(),
    checkoutWork,
    pullRequestLinks,
    checkoutChanges,
    pullRequestState: (url) => pullStates.get(url),
    subagents: createThreadSubagents(),
    removeWorktree: (path, signal) => removeLinkedWorktree(path, signal),
  });

  /**
   * The agent session of a thread, with the folder it works in now: a
   * session thread's, by its key, or the session that handed off a review.
   * Undefined for a review that no session handed off.
   */
  const threadSession = async (id: string): Promise<AgentSession | undefined> => {
    const parsed = parseSessionKey(id);
    if (!parsed) {
      if (!REVIEW_ID.test(id))
        throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      const review = await savedReviews.get(id);
      return review.session && threadSession(sessionKey(review.session));
    }
    // Only a session that Med lists: one it keeps or runs, one that handed
    // off a review, or one it found. Med does not read other transcripts.
    const kept = store.entry(id)?.session ?? ownedSessions.get(parsed.id)?.session;
    if (
      !kept &&
      !found.found().some((session) => session.key === id) &&
      !(await threads.reviewsOf(id)).length
    )
      throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
    const read =
      parsed.agent === "acp"
        ? undefined
        : await found.session({ agent: parsed.agent, id: parsed.id }).catch(() => undefined);
    const base = kept ?? (read && { agent: read.agent, id: read.id, cwd: read.cwd });
    if (!base) throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
    return read?.cwd ? { ...base, cwd: read.cwd } : base;
  };
  /** A thread's session, which a session route needs. */
  const requireSession = async (id: string) => {
    const session = await threadSession(id);
    if (!session)
      throw new HostError("session-not-found", "This thread has no agent session.", 404);
    return session;
  };

  /** The key that a thread's agent hands its reviews off with: its newest
   * review's, else a slug of its title. A pull request added to the thread
   * keeps its own key, which is the thread's only when Med started the
   * session on that pull request. */
  const threadKey = async (threadId: string) => {
    const reviews = await threads.reviewsOf(threadId);
    const session = parseSessionKey(threadId);
    const started = session && ownedSessions.keyOf(session.id);
    const keyed = reviews.find(
      (review) => review.key && (!isPullReviewKey(review.key) || review.key === started),
    )?.key;
    if (keyed) return keyed;
    const entry = threads.entry(threadId);
    return threadSlug(entry?.name ?? entry?.title ?? reviews[0]?.title ?? "thread");
  };
  /** Open message boxes read a review's comments again: its thread's. */
  const touchReview = async (reviewId: string) => {
    const thread = await threads.threadOf(reviewId).catch(() => undefined);
    if (thread) inbox.touch(thread);
  };
  /**
   * The message for a thread's comments: each review's, then the comments on
   * files, then how to answer one. `include` names the comments; without it,
   * every open one.
   */
  const threadFeedback = async (threadId: string, include?: ReadonlySet<string>) => {
    const parts: string[] = [];
    const out = new Map<string, { version: string; comment: SentComment }>();
    const ids: string[] = [];
    let count = 0;
    let example: string | undefined;
    for (const review of await threads.reviewsOf(threadId)) {
      const part = await savedReviews.feedback(review.id, include, { help: false });
      ids.push(...part.ids);
      if (!part.count) continue;
      parts.push(part.text);
      count += part.count;
      example ??= part.example;
      for (const [id, thread] of part.threads) out.set(id, thread);
    }
    const files = await threadComments.feedback(threadId, include, ids);
    if (files.count) {
      parts.push("# Comments on files", "", ...files.lines);
      count += files.count;
      for (const [id, thread] of files.threads) out.set(id, thread);
    }
    const shown = example ?? files.example;
    if (shown) parts.push(replyHelp(shown, files.example).join("\n"));
    return { text: parts.join("\n"), count, threads: out };
  };
  /** What a thread's message box shows: its messages, its comments that wait
   * to be sent, and where its session is open. */
  const threadInbox = async (threadId: string): Promise<AgentInboxState> => {
    const messages = await inbox.messages(threadId);
    // A comment is sent when a message holds its version. A message from
    // before versions holds the comments as they were when it was made.
    const versions = new Map<string, Set<string>>();
    const sentAt = new Map<string, string>();
    for (const message of messages)
      for (const id of message.noteIds) {
        const version = message.noteVersions?.[id];
        if (version !== undefined) versions.set(id, (versions.get(id) ?? new Set()).add(version));
        else if ((sentAt.get(id) ?? "") < message.createdAt) sentAt.set(id, message.createdAt);
      }
    const unsent = (comment: { id: string; updatedAt: string }) =>
      !versions.get(comment.id)?.has(comment.updatedAt) &&
      (sentAt.get(comment.id) ?? "") < comment.updatedAt;
    const reviews = await threads.reviewsOf(threadId);
    const comments = (
      await Promise.all(reviews.map((review) => savedReviews.comments(review.id).catch(() => [])))
    ).flat();
    const fileComments = await threadComments.list(threadId);
    const session = await threadSession(threadId).catch(() => undefined);
    return {
      messages,
      ...(await sessionPlaces(session ? [session] : [])),
      owned: session && ownedSessions.get(session.id) ? [session.id] : [],
      revision:
        reviews.reduce((sum, review) => sum + review.revision, 0) +
        fileComments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0),
      drafts: [
        ...comments.filter(unsent).map((comment) => ({
          id: comment.id,
          path: comment.path,
          line: comment.line,
          ...(comment.endLine ? { endLine: comment.endLine } : {}),
          ...comment.said,
          replies: comment.replies,
        })),
        ...fileComments
          .filter((comment) => !comment.resolved && unsent(comment))
          .map((comment) => ({
            id: comment.id,
            path: comment.path,
            line: comment.line,
            ...(comment.endLine ? { endLine: comment.endLine } : {}),
            ...lastSaid(comment, comment.replies),
            replies: comment.replies.length,
          })),
      ],
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
  // One thread list for all windows; a change to the tabs sends it at once.
  const threadFeed = createThreadFeed({ list: () => threads.list(), intervalMs: STATUS_MS });
  store.subscribe(() => threadFeed.changed());
  savedReviews.subscribe(() => threadFeed.changed());
  threadComments.subscribe((threadId) => inbox.touch(threadId));
  // An agent lives as long as its thread's tab: the sessions of closed tabs
  // go to OwnedSessions.release, which stops their agents when idle.
  let releasing: Promise<void> | undefined;
  let releaseAgain = false;
  const releaseClosedTabs = () => {
    if (releasing) {
      releaseAgain = true;
      return;
    }
    releasing = (async () => {
      const closed = new Map<string, number>();
      for (const entry of store.closed()) {
        const session = parseSessionKey(entry.id);
        if (session) closed.set(session.id, entry.closedAt);
      }
      ownedSessions.release(closed);
    })()
      .catch(() => {})
      .finally(() => {
        releasing = undefined;
        if (!releaseAgain) return;
        releaseAgain = false;
        releaseClosedTabs();
      });
  };
  store.subscribe(releaseClosedTabs);
  listChanged = () => threadFeed.changed();
  const activeRequests = new Map<AbortController, Set<string>>();
  // Each checkout's revision: watcher events change it at once.
  const revisions = new CheckoutRevisions();
  // Answers from Git metadata stay while the family's Git signature is the
  // same; answers from working files also need a watcher that sees edits.
  const checkoutInfo = new Memo<Awaited<ReturnType<typeof resolveRepository>>>();
  const targetsCache = new Memo<Awaited<ReturnType<typeof gitTargets>>>();
  const browseCache = new Memo<Awaited<ReturnType<typeof listBrowse>>>(32);
  const driftCache = new Memo<boolean>();
  // A live comparison's last review (its ID), while its checkout's token is
  // the same: Changes that open again load without Git.
  const liveReviews = new Map<string, { token: string; id: string }>();
  const loadLive = async (request: ReviewRequest, signal: AbortSignal) => {
    const key = JSON.stringify(request);
    // The token comes before the read, so a change during it reads again.
    const token = await checkoutState(request.repo, true).catch(() => undefined);
    const hit = liveReviews.get(key);
    if (token !== undefined && hit?.token === token) {
      // The loader can drop a review; then this loads again.
      const kept = (() => {
        try {
          return reviews.get(hit.id).response;
        } catch {
          return undefined;
        }
      })();
      // A review's ID names its diff, so two bases with the same merge base
      // share one review, which keeps the comparison and label of the last load.
      if (kept && comparisonKey(kept.comparison) === comparisonKey(request.comparison)) {
        liveReviews.delete(key);
        liveReviews.set(key, hit);
        return { ...kept, metrics: { ...kept.metrics, cacheHit: true, gitMs: 0 } };
      }
    }
    const review = await reviews.load(request, signal);
    if (token === undefined) liveReviews.delete(key);
    else liveReviews.set(key, { token, id: review.id });
    while (liveReviews.size > 64) liveReviews.delete(liveReviews.keys().next().value!);
    return review;
  };
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
  // The base branches stay up to date unless the reader turns
  // `sources.pullBase` off; POST /api/base-pulls pulls now.
  const basePulls = new BasePulls(
    {
      repositories: () => registry.snapshot(),
      enabled: async () => (await settingsFile.snapshot()).settings["sources.pullBase"] !== false,
      refresh: () => registry.list(),
    },
    typeof options.basePull === "object" ? options.basePull : {},
  );
  if (options.basePull) basePulls.start();
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
    remember: rememberPull,
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
  const pullInbox = new PullInboxReader({
    repositories: () => registry.snapshot(),
    gh: options.gh ?? { command: "gh", args: [] },
    // As Open in reads a host's kind: Settings' choice, else its answer.
    isGitHub: async (name) =>
      name === "github.com" ||
      (await hostKind(
        name,
        openInSettings((await settingsFile.snapshot()).settings),
        openInIsGitHub,
      )) === "github",
    file: join(options.stateDir ?? temporaryState!, "pull-requests.json"),
  });
  if (repository.git !== false) {
    await registry.register(repository.path);
    for (const path of options.repos ?? []) await registry.register(path);
  }
  await options.service?.attach(registry);
  // The Superagent's folder, once Med has made it, so its thread opens after
  // a restart; the service registers only its own sources.
  if (existsSync(join(superagentPath, ".git")))
    await registry.register(superagentPath).catch(() => {});
  // An older Med's tabs move to the thread store on the first start;
  // history prunes now and daily.
  await threads.start(async () => {
    await migrateTabs({
      tabsFile: join(options.stateDir ?? temporaryState!, "tabs.json"),
      store,
      savedReviews,
    });
  });
  releaseClosedTabs();
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
    // One watcher for each checkout of the tabs that stay loaded (16): a
    // watcher that stops costs its cached answers and a new start.
    if (!watchers.has(repo) && watchers.size >= 16) {
      const pinned = new Set(streams.values());
      const oldest = [...watchers.keys()].find((path) => !pinned.has(path));
      if (!oldest)
        throw new HostError(
          "too-many-watchers",
          "Sixteen working folders are in use. Close another viewer before opening this source.",
          503,
        );
      const stop = watchers.get(oldest)!;
      watchers.delete(oldest);
      watcherModes.delete(oldest);
      browseLiveSources.delete(oldest);
      evicted = retireWatcher(stop);
    }
    const previous = watchers.get(repo);
    // Until the new watcher is ready, a change can go unseen.
    revisions.watching(repo, false);
    const promise: Promise<() => Promise<void>> = (async () => {
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
      const stop = await watchRepository(
        repo,
        {
          change() {
            if (!registry.owner(repo)) return;
            registry.refreshSearch(repo);
            publish({ type: "changed", repo, revision: revisions.revision(repo) });
          },
          hint: () => revisions.changed(repo),
          ready() {
            if (!live || watchers.get(repo) !== promise) return;
            revisions.watching(repo, true);
            options.watch?.onReady?.(repo);
          },
          // A window that shows the checkout has its event stream open.
          shown: () => [...streams.values()].includes(repo),
        },
        live,
        options.watch,
      );
      return async () => {
        revisions.watching(repo, false);
        await stop();
      };
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
    const checkout = registry
      .gitState(repo)
      .then((state) => checkoutInfo.get(repo, state, () => resolveRepository(repo)));
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
    route(commitRoutes.stageHunk, async (input, { requireRepo, signal }) => {
      const repo = await requireRepo(input.repo);
      await stageHunk({ ...input, repo }, signal);
      return workingStatus(repo, signal);
    }),
    route(commitRoutes.discard, async (input, { requireRepo, signal }) => {
      const repo = await requireRepo(input.repo);
      await discardChanges({ ...input, repo }, signal);
      return workingStatus(repo, signal);
    }),
    route(commitRoutes.commit, async (input, { requireRepo, signal }) =>
      commitStaged({ ...input, repo: await requireRepo(input.repo) }, signal),
    ),
    route(commitRoutes.pushBranch, async (input, { requireRepo, signal }) =>
      pushCurrentBranch({ ...input, repo: await requireRepo(input.repo) }, signal),
    ),
    route(generatedRoutes.provenance, async (input, { requireRepo }) => ({
      files: await sessionEdits.provenance(
        input.sessions,
        await requireRepo(input.repo),
        input.files,
      ),
    })),
    route(generatedRoutes.dependencies, async (input, { signal }) => ({
      packages: await dependencyInfo.lookup(input.packages, signal),
    })),
    // A thread's spend and its session's context (session-usage.ts). An
    // agent that Med runs reports its window, and starts with Med's variables.
    route(usageRoutes.thread, async ({ id }) => {
      const own = await threadSession(id);
      return sessionUsage.thread(own ? [own] : [], own?.id, (sessionId) => {
        const runner = ownedSessions.get(sessionId);
        if (!runner) return undefined;
        const window = runner.state().context?.total;
        return { ...(window ? { window } : {}), env: startedAgentEnvironment() };
      });
    }),
  ]);
  // The editors on this machine, looked for again after a minute.
  let editorsFound: { at: number; editors: Promise<Editor[]> } | null = null;
  const openInEditors = () => {
    if (options.openIn?.editors) return options.openIn.editors();
    if (!editorsFound || Date.now() - editorsFound.at > 60_000)
      editorsFound = { at: Date.now(), editors: findEditors() };
    return editorsFound.editors;
  };
  const openInIsGitHub = options.openIn?.isGitHub ?? createHostProbe();
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
            `event: ready\ndata: ${JSON.stringify({ type: "ready", repo: eventRepo, revision: revisions.revision(eventRepo) })}\n\n`,
          );
          streams.set(response, eventRepo);
          response.once("close", () => streams.delete(response));
          return;
        }
        // Earlier work of a long session: a page before a byte offset, and the
        // index of its prompts. Its transcript's path names it to another agent.
        const sessionPage = /^\/api\/sessions\/([A-Za-z0-9_-]+)\/(page|turns|transcript)$/.exec(
          url.pathname,
        );
        if (sessionPage && request.method === "GET") {
          const session = await requireSession(sessionPage[1]!);
          const own = session && session.agent !== "acp" && (await findTranscript(session));
          // A fork before its first prompt reads the session that it forks.
          const fork =
            session && !own && sessionPage[2] !== "transcript"
              ? await forkSource(session)
              : undefined;
          const path = own || fork?.path;
          if (!session || !path)
            throw new HostError(
              "transcript-not-found",
              "The session's transcript is not on this computer.",
              404,
            );
          if (fork) {
            if (sessionPage[2] === "turns") {
              const turns = await transcriptTurns(fork.session, fork.path);
              send({ turns: turns.filter((turn) => turn.offset < fork.end) });
              return;
            }
            const before = Math.min(Number(url.searchParams.get("before")), fork.end);
            if (!Number.isSafeInteger(before) || before < 0)
              throw new HostError(
                "invalid-offset",
                "Give the byte offset where the page ends.",
                400,
              );
            send(await readTranscriptPage(fork.session, fork.path, before));
            return;
          }
          if (sessionPage[2] === "turns") {
            send({ turns: await transcriptTurns(session, path) });
            return;
          }
          if (sessionPage[2] === "transcript") {
            send({ path });
            return;
          }
          const before = Number(url.searchParams.get("before"));
          if (!Number.isSafeInteger(before) || before < 0)
            throw new HostError("invalid-offset", "Give the byte offset where the page ends.", 400);
          send(await readTranscriptPage(session, path, before));
          return;
        }
        // A thread's agent session: its transcript's updates, then new ones
        // as the agent writes them.
        const sessionRoute = /^\/api\/sessions\/([A-Za-z0-9_-]+)\/events$/.exec(url.pathname);
        if (sessionRoute && request.method === "GET") {
          const session = await requireSession(sessionRoute[1]!);
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
          if (session.agent === "acp") {
            // Med keeps an ACP session's updates itself.
            const idle = () => runner?.state().status !== "working";
            const all = parts(await ownedSessions.events(session.id));
            all.forEach((part, index) =>
              write(index ? "updates" : "reset", {
                events: part,
                idle: idle(),
                modifiedAt: Date.now(),
                ...(index ? {} : { truncated: false, parts: all.length }),
              }),
            );
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
          // A session that Med started writes its transcript with the first
          // turn. Until then, a fork shows the session that it forks, up to
          // the fork's message.
          if (!path) {
            const fork = await forkSource(session).catch(() => undefined);
            const page = fork && (await readTranscriptPage(fork.session, fork.path, fork.end));
            const all = page ? parts(page.events) : [[]];
            all.forEach((part, index) =>
              write(index ? "updates" : "reset", {
                events: part,
                idle: true,
                modifiedAt: Date.now(),
                ...(index
                  ? {}
                  : {
                      truncated: !!page && page.start > 0,
                      ...(page ? { start: page.start, parts: all.length } : {}),
                    }),
              }),
            );
          }
          while (!path && !abort.signal.aborted && !closing) {
            await new Promise((done) => setTimeout(done, 400));
            path = await findTranscript(session);
          }
          if (!path) return;
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
        // The pull requests page: open ones that wait on you, and yours.
        if (url.pathname === "/api/pull-requests" && request.method === "GET") {
          const want = url.searchParams.get("read");
          send(
            await pullInbox.read(
              url.searchParams.get("all") === "1",
              want === "fresh" || want === "new" ? want : "kept",
            ),
          );
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
          // Added to a thread, the review is one more of its session's.
          if (input.thread && agent)
            throw new HostError(
              "invalid-pull-request",
              "A pull request that joins a thread starts no agent of its own.",
              400,
            );
          const session = input.thread ? await requireSession(input.thread) : undefined;
          send(
            pullJobs.start(address, {
              ...(agent && { agent: { id: agent.id, name: agent.name } }),
              ...(session && { thread: { id: sessionKey(session), session } }),
            }),
          );
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
        // The settings file, sent again each time it changes, also when an
        // agent saves it.
        if (url.pathname === "/api/settings" && request.method === "GET") {
          send(await settingsFile.snapshot());
          return;
        }
        if (url.pathname === "/api/settings" && request.method === "PUT") {
          const input = z
            .object({
              key: z.string().regex(SETTING_KEY),
              value: z.union([
                z.string().max(200),
                z.number().finite(),
                z.boolean(),
                z.array(z.string().max(200)).max(50),
                z.record(z.string().max(200), z.string().max(1000)),
              ]),
            })
            .parse(await readBody(request));
          send(await settingsFile.set(input.key, input.value));
          return;
        }
        if (url.pathname === "/api/settings/events" && request.method === "GET") {
          if (settingsStreams.size >= 16)
            throw new HostError("too-many-streams", "Too many settings streams are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          settingsStreams.add(response);
          const push = () =>
            void settingsFile.snapshot().then((snapshot) => {
              if (!response.writableEnded)
                response.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
            });
          const unsubscribe = settingsFile.subscribe(push);
          response.once("close", () => {
            settingsStreams.delete(response);
            unsubscribe();
          });
          push();
          return;
        }
        // The tabs, with their agents' states, sent again when one changes;
        // and the registered repositories. A change to the tabs, such as a
        // close in another window, sends the list at once.
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
          const remove = threadFeed.add((text) => {
            if (!abort.signal.aborted) response.write(`event: state\ndata: ${text}\n\n`);
          });
          response.once("close", () => {
            threadStreams.delete(response);
            remove();
          });
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
        // An agent that Med starts on a review, such as a pull request's, in
        // its checkout: the review becomes the new session's.
        const reviewStart = /^\/api\/reviews\/(r_[a-f0-9]{24})\/start$/.exec(url.pathname);
        if (reviewStart && request.method === "POST") {
          const reviewId = reviewStart[1]!;
          const input = ownedStartSchema.parse(await readBody(request));
          const review = await savedReviews.get(reviewId);
          const checkout = reviewCheckout(review);
          const entry =
            checkout && registry.snapshot().find((item) => item.id === checkout.repositoryId);
          if (!checkout || !entry)
            throw new HostError(
              "repository-unavailable",
              `Register the repository for ${checkout?.repo ?? "this review"} to start an agent there.`,
              409,
            );
          // The agent works in the reviewed checkout, such as a pull request's
          // worktree, while that checkout stays.
          const cwd = await requireRepo(checkout.repo).catch(() => requireRepo(entry.path));
          assertRequestAccess();
          const runner = await ownedSessions.start(input.preset, cwd, {
            key: review.key ?? threadSlug(review.title),
            ...(input.choices ? { choices: input.choices } : {}),
          });
          const thread = await threads.keep(runner.session, { title: review.title });
          await savedReviews.details(reviewId, { session: runner.session }, assertRequestAccess);
          // The review's tab gives way to its session's.
          await threads.close(reviewId).catch(() => {});
          send({ thread, state: runner.state() });
          return;
        }
        // A session that Med runs: its state, its updates, and the reader's
        // actions on it. Fork in Med forks a session that another process
        // has open into one that Med runs, which takes the thread's place.
        const ownedRoute =
          /^\/api\/sessions\/([A-Za-z0-9_-]+)\/(owned|owned\/events|continue)$/.exec(url.pathname);
        if (ownedRoute) {
          const [, threadId, kind] = ownedRoute;
          const session = await requireSession(threadId!);
          if (kind === "continue" && request.method === "POST") {
            if (session.agent !== "claude")
              throw new HostError("session-not-found", "Med continues Claude sessions only.", 404);
            const current = ownedSessions.get(session.id);
            if (current && !current.dormant() && current.state().status !== "exited")
              throw new HostError(
                "session-owned",
                "Med runs this session already. Send your message here.",
                409,
              );
            assertRequestAccess();
            const runner = await ownedSessions.fork(session, { key: await threadKey(threadId!) });
            const thread = await threads.handOver(session, runner.session);
            // The messages that waited for the other process start the fork.
            await inbox.deliverPending(
              threadId!,
              session.id,
              (body) => runner.prompt(body),
              runner.session,
            );
            // The thread's messages go with it.
            await inbox.move(threadId!, thread);
            send({ thread, state: runner.state() });
            return;
          }
          const runner = ownedSessions.get(session.id);
          if (!runner)
            throw new HostError("session-not-owned", "Med does not run this session.", 404);
          const events = kind === "owned/events";
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
            // The agents keep working as the host closes. The page keeps their
            // last state, so its message box stays open while Med restarts.
            const push = () => {
              if (!closing)
                response.write(`event: state\ndata: ${JSON.stringify(runner.state())}\n\n`);
            };
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
            const action = ownedActionSchema.parse(await readBody(request, MAX_PROMPT_BODY));
            assertRequestAccess();
            if (action.action === "prompt") await runner.prompt(action.text);
            else if (action.action === "permission") {
              const { id, option, ...reply } = action;
              runner.answer(id, option, reply);
            } else if (action.action === "interrupt") runner.interrupt();
            else if (action.action === "setting") await runner.set(action.id, action.value);
            else if (action.action === "restart") await runner.restart();
            else if (action.action === "continue") await runner.prompt(CONTINUE_TURN);
            else if (action.action === "dismiss") runner.dismiss();
            else ownedSessions.end(runner);
            send(runner.state());
            return;
          }
          throw new HostError("method-not-allowed", "This session action is not supported.", 405);
        }
        // Messages from a thread to its agent session, and the agent's
        // answers to comments.
        const agentRoute =
          /^\/api\/sessions\/([A-Za-z0-9_-]+)\/agent(?:\/(messages|events|take|send-now|delete-comments))?$/.exec(
            url.pathname,
          );
        if (agentRoute) {
          const threadId = agentRoute[1]!;
          const action = agentRoute[2];
          const inboxState = () => threadInbox(threadId);
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
            const unsubscribe = inbox.subscribe(threadId, push);
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
            const session = await requireSession(threadId);
            // The page sends a message again when it lost Med's answer, or
            // after a reload, with the same ID: Med sends it once.
            const message = await inbox.once(threadId, input.id, async () => {
              const parts: string[] = [];
              if (input.text.trim()) parts.push(input.text.trim());
              // One read gives the agent's text, the thread's copy of each
              // comment, and the version that the message holds, so an edit
              // after it stays a draft.
              const feedback = input.noteIds.length
                ? await threadFeedback(threadId, new Set(input.noteIds))
                : undefined;
              // The text ends with how to answer a comment in its thread.
              if (feedback?.count) parts.push(feedback.text);
              const included = input.noteIds.flatMap((id) => {
                const thread = feedback?.threads.get(id);
                return thread ? [[id, thread] as const] : [];
              });
              const comments = included.map(([, thread]) => thread.comment);
              const noteVersions = Object.fromEntries(
                included.map(([id, thread]) => [id, thread.version]),
              );
              for (const attachment of input.attachments)
                parts.push(`## ${attachment.label}\n\n${attachment.text}`);
              const runner = ownedSessions.get(session.id);
              const live = runner && runner.state().status !== "exited" ? runner : undefined;
              // Med sends only to a session that it runs, or resumes because no
              // other process has it open. One that Claude Code in a terminal,
              // the Claude app, or Codex Desktop has open is the reader's to
              // see: Fork in Med forks it into one that Med runs.
              let resume = false;
              if ((!live || live.dormant()) && session.agent === "claude" && (!runner || live)) {
                if (await ownedSessions.runsElsewhere(session.id))
                  throw new HostError(
                    "session-elsewhere",
                    "Claude Code has this session open in another app, so Med can't send to it. Continue it in Med, or copy the comments.",
                    409,
                  );
                resume = !live;
              } else if (session.agent === "codex" && !live && !runner) {
                if (await ownedSessions.lockedElsewhere("codex", session.id))
                  throw new HostError(
                    "session-elsewhere",
                    "Codex has this thread open in another app, so Med can't send to it. Continue it in Med, or copy the comments.",
                    409,
                  );
                if (
                  !(await ownedSessions.agents()).some(
                    (agent) => agent.kind === "codex" && agent.available,
                  )
                )
                  throw new HostError(
                    "codex-not-found",
                    "Med could not find the codex command. Install Codex, or set MED_CODEX_PATH.",
                    409,
                  );
                // Med resumes the thread through Codex's app-server and runs it
                // from then on.
                resume = true;
              }
              // A session that stopped in Med takes no message, as one that no
              // agent of Med's can resume.
              if (!resume && !live)
                throw new HostError(
                  "session-stopped",
                  "This session stopped, so Med can't send to it. Start a new session, or copy the comments.",
                  409,
                );
              // The agent that Med runs works: the message waits for its next
              // step (queued-messages.ts), and the user can take it back.
              const queue = !resume && live?.state().status === "working";
              // An agent that Med runs and that takes images gets them in the
              // prompt, as Claude Code does. Any other agent, or a queued
              // message, gets the paths of saved copies.
              const native =
                !queue && (resume || (live && live.state().images)) ? input.images : [];
              if (input.images.length && !native.length)
                parts.push(imagesText(await saveImages(imageDirectory, input.images)));
              if (!parts.length && !native.length)
                throw new HostError(
                  "empty-message",
                  "Write a message or choose comments to send.",
                  400,
                );
              // A session that Med runs takes the message as its next prompt.
              const target = resume
                ? await ownedSessions.resume(session, { key: await threadKey(threadId) })
                : live;
              const message = await inbox.send(
                threadId,
                session,
                {
                  ...(input.id ? { id: input.id } : {}),
                  text: input.text.trim(),
                  noteIds: input.noteIds,
                  comments,
                  noteVersions,
                  attachmentCount: input.attachments.length,
                  ...(input.images.length ? { imageCount: input.images.length } : {}),
                },
                parts.join("\n\n"),
                queue
                  ? { queued: true, afterTurn: !!input.afterTurn }
                  : target
                    ? { deliver: (body) => target.prompt(body, native) }
                    : {},
              );
              if (queue && message.delivery === "pending")
                queuedMessages.watch(threadId, session.id);
              return message;
            });
            send({ message, state: await inboxState() });
            return;
          }
          // Takes back a queued message that the agent has not had, to edit
          // or to drop.
          if (action === "take" && request.method === "POST") {
            const input = z
              .object({ id: z.string().min(1).max(128) })
              .parse(await readBody(request));
            const message = await inbox.takeBack(threadId, input.id);
            send({ message, state: await inboxState() });
            return;
          }
          // Send now on a queued message: the agent takes it at its next
          // step, not at its turn's end (queued-messages.ts).
          if (action === "send-now" && request.method === "POST") {
            const input = z
              .object({ id: z.string().min(1).max(128) })
              .parse(await readBody(request));
            const message = (await inbox.messages(threadId)).find(
              (entry) => entry.id === input.id && entry.queued && entry.delivery === "pending",
            );
            if (!message)
              throw new HostError("message-gone", "The agent has this message already.", 409);
            if (!(await queuedMessages.sendNow(threadId, message.sessionId, input.id)))
              throw new HostError(
                "steer-unsupported",
                "This agent takes the message when its turn ends.",
                409,
              );
            send({ state: await inboxState() });
            return;
          }
          // Deletes comments from the message box, as from the review or the
          // file that holds them, with their replies.
          if (action === "delete-comments" && request.method === "POST") {
            const input = z
              .object({ ids: z.array(z.string().min(1).max(128)).min(1).max(500) })
              .parse(await readBody(request));
            assertRequestAccess();
            const ids = new Set(input.ids);
            for (const review of await threads.reviewsOf(threadId))
              await savedReviews.removeComments(review.id, ids, assertRequestAccess);
            await threadComments.removeComments(threadId, ids);
            inbox.touch(threadId);
            send({ state: await inboxState() });
            return;
          }
          throw new HostError("method-not-allowed", "This agent action is not supported.", 405);
        }
        // A thread's comments on lines of files (`gc` in a file).
        const fileCommentsRoute = /^\/api\/threads\/([A-Za-z0-9_-]+)\/file-comments$/.exec(
          url.pathname,
        );
        if (fileCommentsRoute) {
          const threadId = threadIdSchema.parse(fileCommentsRoute[1]);
          if (request.method === "GET") {
            send({ comments: await threadComments.list(threadId) });
            return;
          }
          if (request.method === "POST") {
            const mutation = fileCommentMutationSchema.parse(await readBody(request));
            assertRequestAccess();
            send({ comments: await threadComments.mutate(threadId, mutation) });
            return;
          }
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
            send(
              await routed(url, (limit) => readBody(request, limit), {
                signal: abort.signal,
                requireRepo,
              }),
            );
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
            // A review's ID, or a thread's (`med thread adopt --open`).
            const bundle = REVIEW_ID.test(input.id) ? await savedReviews.get(input.id) : undefined;
            const thread = bundle ? threadOfReview(bundle) : input.id;
            const title = bundle?.title ?? (await threads.open(thread)).title;
            const event = {
              type: "review",
              ...(bundle && { id: bundle.id }),
              thread,
              title,
              open: input.open,
              updated: input.updated,
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
            // Files that the hand-off names as generated (docs/GENERATED.md).
            const review = declareGenerated(
              await reviews.load({ repo, comparison: target.comparison }, abort.signal),
              target.generated,
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
            const input = savedReviewCreateSchema.parse(
              await readBody(request, MAX_GUIDE_BODY * 2),
            );
            // An agent that Med runs hands off with its thread's key, which
            // names its session when its command could not.
            input.session ??= input.key ? ownedSessions.sessionOfKey(input.key) : undefined;
            if (!input.session) delete input.session;
            const review = await savedReviews.create(input, captureTarget, assertRequestAccess);
            // A hand-off opens its thread as a tab, also a new version of an archived one.
            await threads.handedOff(review);
            send(review);
            return;
          }
          // A new Review version of a thread: what its agent shows now
          // (`med thread show`, `med review update --paths`).
          const version = /^\/api\/reviews\/(r_[a-f0-9]{24})\/versions$/.exec(url.pathname);
          if (version && request.method === "POST") {
            const body = savedReviewCreateSchema
              .omit({ title: true })
              .parse(await readBody(request, MAX_GUIDE_BODY * 2));
            const review = await savedReviews.addVersion(
              version[1]!,
              body,
              captureTarget,
              assertRequestAccess,
            );
            // As a hand-off does, a new version opens an archived thread as a tab.
            await threads.handedOff(review);
            send(review);
            return;
          }
          // Fork in Med: an agy conversation becomes a thread whose agent
          // Med runs, from its history. agy has one writer: while another
          // process has it open, a message says to end it there first.
          const continueAgy = async (input: SessionAdopt): Promise<SessionAdopted> => {
            const id = input.session;
            if (!ownedSessions.agy)
              throw new HostError("agent-unavailable", "Antigravity is off in Med.", 404);
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
              throw new HostError("session-not-found", "Choose an agy conversation ID.", 400);
            const named = (await sessionThreads()).get(id);
            if (named) {
              const thread = await threads.open(named.id);
              return { id: thread.id, title: thread.title, created: false };
            }
            const agent = (await ownedSessions.agents()).find(
              (entry) => entry.kind === "agy" && entry.available,
            );
            if (!agent) throw new HostError("agent-unavailable", "agy is not installed here.", 409);
            const place = input.repo ? await found.locate(input.repo) : undefined;
            if (!input.repo || !place?.checkout)
              throw new HostError(
                "session-checkout",
                `The conversation's folder${input.repo ? ` ${input.repo}` : ""} is not in a registered repository. Run ${medCommand({ port, stateDir: options.stateDir }, "add", "<repository>")} first.`,
                409,
              );
            const title = input.title ?? "Antigravity conversation";
            const key = `${threadSlug(title)}-${id.slice(0, 8)}`;
            assertRequestAccess();
            const runner = await ownedSessions.start(agent.id, input.repo, {
              key,
              conversation: id,
            });
            const thread = await threads.keep(runner.session, { title });
            return { id: thread, title, created: true };
          };
          // `med thread adopt`: a Claude Code or Codex session of any age
          // becomes a saved thread, as Keep in Med makes one. A session that
          // a thread names already gives that thread, back from history as a tab.
          if (url.pathname === "/api/sessions/adopt" && request.method === "POST") {
            const input = sessionAdoptSchema.parse(await readBody(request));
            if (input.agent === "agy") {
              send(await continueAgy(input));
              return;
            }
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
            const key = sessionKey(info);
            const known = store.known(key);
            // A session works wherever it goes: it needs no checkout to be
            // kept, and its Changes follow the folder it works in.
            const cwd = info.cwd ?? input.repo ?? homedir();
            const title = input.title ?? info.title.slice(0, 200);
            await threads.keep({ agent: info.agent, id: info.id, cwd }, { title });
            if (input.title) await threads.rename(key, input.title);
            const thread = await threads.open(key);
            send({
              id: key,
              title: thread.title,
              created: !known,
              session: entry!,
            } satisfies SessionAdopted);
            return;
          }
          // Fork from here: a new thread on the session's checkout, whose
          // Claude Code session starts from this one's history up to a reply.
          // The thread it forks stays as it is.
          const forkRoute = /^\/api\/sessions\/([A-Za-z0-9_-]+)\/fork$/.exec(url.pathname);
          if (forkRoute && request.method === "POST") {
            const input = sessionForkSchema.parse(await readBody(request));
            const session = await requireSession(forkRoute[1]!);
            if (session.agent !== "claude")
              throw new HostError("fork-unsupported", "Med forks Claude Code sessions only.", 409);
            const entry = threads.entry(forkRoute[1]!);
            const title = (
              input.title ?? `${entry?.name ?? entry?.title ?? "Agent session"} (fork)`
            ).slice(0, 120);
            const key = `${threadSlug(title)}-${randomUUID().slice(0, 4)}`;
            assertRequestAccess();
            const runner = await ownedSessions.fork(session, { key, at: input.at });
            // A new thread: it opens as a tab.
            const thread = await threads.keep(runner.session, { title });
            await threads.rename(thread, title);
            send({ id: thread, title } satisfies SessionForked);
            return;
          }
          // The Superagent's thread: made, with its folder and session, the
          // first time; opened as a tab after that.
          if (url.pathname === "/api/superagent" && request.method === "POST") {
            const input = z
              .object({ preset: z.string().min(1).max(200).default("claude") })
              .parse(await readBody(request));
            const known = threads.superagent();
            if (known) {
              await registry.register(superagentPath, abort.signal).catch(() => {});
              await threads.open(known).catch(() => {});
              send({ thread: known, created: false });
              return;
            }
            assertRequestAccess();
            await prepareSuperagentFolder(superagentPath);
            const cwd = await realpath(superagentPath);
            superagentReal = cwd;
            await registry.register(cwd, abort.signal);
            const runner = await ownedSessions.start(input.preset, cwd, {
              key: SUPERAGENT_KEY,
              choices: { ...SUPERAGENT_CHOICES },
            });
            const brief = superagentBrief();
            // An ordinary session, which the sidebar shows at its top.
            const thread = await threads.keep(runner.session, {
              title: SUPERAGENT_TITLE,
              prompt: brief,
              superagent: true,
            });
            await threads.rename(thread, SUPERAGENT_TITLE);
            await runner.prompt(brief);
            send({ thread, created: true });
            return;
          }
          // A new thread: a branch in a new worktree (or the checkout itself),
          // and an agent that starts on the task there. It has no review
          // until the agent hands one off.
          if (url.pathname === "/api/threads" && request.method === "POST") {
            const input = threadStartSchema.parse(await readBody(request));
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
              let name = slug;
              for (let n = 2; branches.has(name) || existsSync(join(base, name)); n++)
                name = `${slug}-${n}`;
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
            const thread = await threads.keep(runner.session, { prompt: input.prompt, title });
            await runner.prompt(input.prompt);
            send({ thread });
            return;
          }
          const browsingNotes =
            /^\/api\/reviews\/([^/]+)\/browsing\/([a-f0-9]{64})\/(notes|place)$/.exec(url.pathname);
          if (browsingNotes) {
            const [, id, reviewId, browsingAction] = browsingNotes;
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
            // A commit of the Review's range (`?target=`): the target's comments
            // show on the commit's lines too (SavedReviewStore.lens).
            const lensTarget = url.searchParams.get("target");
            const commitLens = (): CommitLens => {
              const stored = reviews.get(reviewId!).response;
              let parsed: Map<string, FileDiffMetadata> | undefined;
              const fileOf = (path: string) => {
                parsed ??= new Map(
                  parsePatchFiles(stored.patch, { throwOnError: true })
                    .flatMap((patch) => patch.files)
                    .map((file) => {
                      const named = normalizeDiffMetadataPaths(file);
                      return [named.name, named] as const;
                    }),
                );
                return parsed.get(path);
              };
              return {
                reviewId: reviewId!,
                files: stored.files,
                source: (path) =>
                  reviews.sources(reviewId!, path, abort.signal).catch(() => undefined),
                shown: (path, side, line, end) =>
                  !!fileOf(path)?.hunks.some((hunk) => {
                    const start = side === "old" ? hunk.deletionStart : hunk.additionStart;
                    const count = side === "old" ? hunk.deletionCount : hunk.additionCount;
                    return start <= end && start + count > line;
                  }),
              };
            };
            const commentCapture = async () => {
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
                images.reduce((sum, image) => sum + Buffer.byteLength(image.data, "base64"), 0);
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
            };
            if (browsingAction === "place") {
              if (request.method !== "POST" || !lensTarget)
                throw new HostError("method-not-allowed", "Use POST with a target.", 405);
              const input = z
                .object({
                  lines: z
                    .array(
                      z.object({
                        path: z.string().min(1),
                        side: z.enum(["old", "new"]),
                        line: z.number().int().positive(),
                        endLine: z.number().int().positive().optional(),
                      }),
                    )
                    .max(500),
                })
                .parse(await readBody(request));
              send({
                lines: await savedReviews.lensPlace(id!, lensTarget, commitLens(), input.lines),
              });
              return;
            }
            if (request.method === "GET") {
              if (lensTarget) {
                send(await savedReviews.lensNotes(id!, lensTarget, commitLens()));
                return;
              }
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
            if (lensTarget) {
              send(
                await savedReviews.lensMutate(
                  id!,
                  lensTarget,
                  commitLens(),
                  input.expectedRevision,
                  input.mutation,
                  assertRequestAccess,
                  commentCapture,
                ),
              );
              void touchReview(id!);
              return;
            }
            const state = await savedReviews.mutate(
              id!,
              target?.id ?? reviewId!,
              input.expectedRevision,
              input.mutation,
              assertRequestAccess,
              target ? undefined : commentCapture,
            );
            send({ ...state, reviewId });
            void touchReview(id!);
            return;
          }
          // `med reply <id>`: the reviews with a comment whose ID starts so.
          if (url.pathname === "/api/base-pulls") {
            if (request.method === "POST") send({ pulls: await basePulls.run() });
            else send({ pulls: [...basePulls.last.values()] });
            return;
          }
          // `med reply`: the agent answers a comment in its thread, on a
          // review's change or on a file. Med finds the comment by its ID's
          // start; `key` names the review when two comments share one.
          const commentRoute = /^\/api\/comments\/([0-9a-fA-F-]{6,36})\/reply$/.exec(url.pathname);
          if (commentRoute && request.method === "POST") {
            const input = z
              .object({
                text: z.string().min(1).max(16384),
                key: z.string().min(1).max(200).optional(),
                session: z
                  .object({
                    agent: z.enum(["claude", "codex", "acp"]),
                    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
                  })
                  .optional(),
                /** A comment on a file is done (`med reply --resolve`). */
                resolve: z.boolean().optional(),
              })
              .parse(await readBody(request));
            const prefix = commentRoute[1]!.toLowerCase();
            const keyed = input.key
              ? REVIEW_ID.test(input.key)
                ? input.key
                : (await savedReviews.byKey(input.key)).id
              : undefined;
            const reviews = keyed ? [keyed] : await savedReviews.reviewsWithComment(prefix);
            const onFiles = keyed ? [] : await threadComments.threadsWith(prefix);
            if (!reviews.length && !onFiles.length)
              throw new HostError(
                "note-not-found",
                `No thread in Med has a comment with ID ${prefix}.`,
                404,
              );
            if (reviews.length + onFiles.length > 1) {
              const names = await Promise.all(
                reviews.map(async (id) => `"${(await savedReviews.get(id)).title}" (--key ${id})`),
              );
              throw new HostError(
                "comment-ambiguous",
                `Comments in ${reviews.length + onFiles.length} places have an ID that starts with ${prefix}${names.length ? `: ${names.join(", ")}` : ""}. Give more of the ID${names.length ? ", or add --key with the review's ID" : ""}.`,
                409,
              );
            }
            const thread = reviews[0] ? await threads.threadOf(reviews[0]) : onFiles[0]!;
            const own = thread ? await threadSession(thread).catch(() => undefined) : undefined;
            const author = input.session
              ? {
                  agent: input.session.agent,
                  ...(own?.id === input.session.id && own.name ? { name: own.name } : {}),
                  sessionId: input.session.id,
                }
              : own
                ? { agent: own.agent, ...(own.name ? { name: own.name } : {}), sessionId: own.id }
                : { agent: "acp" as const };
            if (reviews[0]) {
              const note = await savedReviews.reply(
                reviews[0],
                prefix,
                input.text,
                author,
                undefined,
                { resolve: input.resolve },
              );
              // Open pages read the comments again.
              void touchReview(reviews[0]);
              send({ note });
            } else {
              const note = await threadComments.reply(onFiles[0]!, prefix, input.text, author, {
                resolve: input.resolve,
              });
              send({ note });
            }
            return;
          }
          if (url.pathname === "/api/reviews/by-key" && request.method === "POST") {
            const { key } = z.object({ key: reviewKeySchema }).parse(await readBody(request));
            send(await savedReviews.byKey(key));
            return;
          }
          // The thread of a review key (`MED_THREAD_KEY`): its review's, or,
          // before a hand-off, the session's that Med runs with the key.
          if (url.pathname === "/api/threads/by-key" && request.method === "POST") {
            const { key } = z.object({ key: reviewKeySchema }).parse(await readBody(request));
            const review = await savedReviews.byKey(key).catch(() => undefined);
            const running = ownedSessions.sessionOfKey(key);
            const thread = review ? threadOfReview(review) : running && sessionKey(running);
            if (!thread)
              throw new HostError("thread-not-found", `Med has no thread with key ${key}.`, 404);
            send({ thread });
            return;
          }
          const savedRoute =
            /^\/api\/reviews\/([^/]+)(?:\/targets\/([^/]+)\/(review|source|notes|drift)|\/(feedback|clear|guide|refresh|details|pull-request|pull-request-live|pull-request-log|pull-request-image|codex-reviews|since|read))?$/.exec(
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
            // `since`: only what changed since that version (sinceView).
            const sinceParam = url.searchParams.get("since");
            const since =
              sinceParam === null
                ? undefined
                : z.coerce.number().int().positive().parse(sinceParam);
            const sinceView =
              since && targetId ? () => savedReviews.sinceView(id!, targetId, since) : undefined;
            // In it, comments are the target's on new lines: old lines are another version's text.
            const sinceNotes = async (state: NoteState) =>
              sinceView
                ? {
                    ...state,
                    reviewId: (await sinceView()).review.id,
                    notes: state.notes.filter((note) => note.side === "new"),
                  }
                : state;
            if (request.method === "GET") {
              if (targetAction === "review" && sinceView) send((await sinceView()).review);
              else if (targetAction === "review") {
                // A saved target never changes: the browser keeps its diff and
                // asks again with this tag, as when a thread is read ahead again.
                const tag = `"${id}.${targetId}"`;
                const headers = { etag: tag, "cache-control": "private, no-cache" };
                if (request.headers["if-none-match"] === tag) {
                  assertRequestAccess();
                  response.writeHead(304, headers);
                  response.end();
                  return;
                }
                const body = JSON.stringify(await savedReviews.review(id!, targetId!));
                assertRequestAccess();
                response.writeHead(200, {
                  ...headers,
                  "content-type": "application/json; charset=utf-8",
                  "x-content-type-options": "nosniff",
                });
                response.end(body);
              } else if (targetAction === "source" && sinceView) {
                const path = url.searchParams.get("path") ?? "";
                const source = (await sinceView()).sources.find((entry) => entry.path === path);
                if (!source)
                  throw new HostError(
                    "saved-source-unavailable",
                    "Full text was not captured for this file. The saved patch remains available.",
                    422,
                  );
                send(source);
              } else if (targetAction === "source")
                send(await savedReviews.source(id!, targetId!, url.searchParams.get("path") ?? ""));
              else if (targetAction === "notes")
                send(await sinceNotes(await savedReviews.notes(id!, targetId!)));
              else if (targetAction === "drift") {
                // Whether captured working changes still match their checkout.
                const target = relevant[0]!;
                if (!target.captured) send({ changed: false });
                else {
                  // Later edits to its files send change events, as for a working review.
                  observe(target.repo, true);
                  // The answer stays while the watcher sees no edit and Git is the same.
                  const files = revisions.token(target.repo);
                  const state = files && (await registry.gitState(target.repo));
                  const changed = await driftCache.get(
                    `${id}\n${targetId}\n${bundle.revision}`,
                    state && `${files}\n${state}`,
                    async () => {
                      const [saved, live] = await Promise.all([
                        savedReviews.review(id!, targetId!),
                        reviews.load({ repo: target.repo, comparison: target.comparison }),
                      ]);
                      return captureChanged(saved, live);
                    },
                  );
                  send({ changed });
                }
              } else if (action === "since") {
                const version = Number(url.searchParams.get("version")) || undefined;
                send({ since: (await savedReviews.since(id!, version)) ?? null });
              } else if (action === "feedback") {
                const { threads: _threads, ...feedback } = await savedReviews.feedback(id!);
                // Copy comments copies what a message to the thread's agent
                // takes: its reviews' comments and its comments on files.
                const thread = await threadFeedback(threadOfReview(bundle));
                send({ ...feedback, text: thread.text });
              } else if (action === "pull-request") {
                if (!bundle.pullRequestUrl)
                  throw new HostError("no-pull-request", "This review has no pull request.", 404);
                const comments = await loadPullRequestComments(
                  bundle.pullRequestUrl,
                  url.searchParams.get("refresh") === "1",
                );
                rememberPull(bundle.pullRequestUrl, comments.pull?.state);
                send(comments);
              } else if (
                action === "pull-request-live" ||
                action === "pull-request-log" ||
                action === "pull-request-image"
              ) {
                // The Pull request tab: GitHub's pull request as it is now,
                // a failed job's log, and the description's images.
                if (!bundle.pullRequestUrl)
                  throw new HostError("no-pull-request", "This review has no pull request.", 404);
                if (action === "pull-request-live") {
                  const live = await loadLivePullRequest(
                    bundle.pullRequestUrl,
                    url.searchParams.get("refresh") === "1",
                  );
                  rememberPull(bundle.pullRequestUrl, live.state);
                  send(live);
                } else if (action === "pull-request-log")
                  send(
                    await readCheckLog(
                      bundle.pullRequestUrl,
                      z.coerce
                        .number()
                        .int()
                        .positive()
                        .parse(url.searchParams.get("job") ?? ""),
                    ),
                  );
                else {
                  const image = await loadDescriptionImage(
                    bundle.pullRequestUrl,
                    z.string().min(1).max(4096).parse(url.searchParams.get("src")),
                  );
                  response.writeHead(200, {
                    "Content-Type": image.mime,
                    "Content-Length": image.bytes.length,
                    "Cache-Control": "private, max-age=3600",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "default-src 'none'; sandbox",
                  });
                  response.end(image.bytes);
                }
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
              if (sinceView && input.mutation.type === "add" && input.mutation.note.side === "old")
                throw new HostError(
                  "invalid-note",
                  "Comment on a new line: a removed line here is an earlier version's text.",
                  422,
                );
              assertRequestAccess();
              send(
                await sinceNotes(
                  await savedReviews.mutate(
                    id!,
                    targetId!,
                    input.expectedRevision,
                    input.mutation,
                    assertRequestAccess,
                  ),
                ),
              );
              void touchReview(id!);
              return;
            }
            if (request.method === "POST" && action === "read") {
              const input = z
                .object({ version: z.number().int().positive() })
                .parse(await readBody(request));
              assertRequestAccess();
              send(await savedReviews.markRead(id!, input.version, assertRequestAccess));
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
            // Refresh: the review's comparisons, captured again as a new version.
            if (request.method === "POST" && action === "refresh") {
              assertRequestAccess();
              send(await savedReviews.refresh(id!, captureTarget, assertRequestAccess));
              return;
            }
            // The reader's pending review on GitHub: a Med comment or a reply
            // goes into it, and the reader submits or discards it.
            if (request.method === "POST" && action === "pull-request") {
              if (!bundle.pullRequestUrl)
                throw new HostError("no-pull-request", "This review has no pull request.", 404);
              const text = z.string().trim().min(1).max(65_536);
              const input = z
                .discriminatedUnion("action", [
                  z.object({ action: z.literal("note"), targetId: z.string(), noteId: z.string() }),
                  z.object({ action: z.literal("reply"), thread: z.number().int(), body: text }),
                  z.object({
                    action: z.literal("submit"),
                    event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
                    body: z.string().max(65_536).optional(),
                  }),
                  z.object({ action: z.literal("discard") }),
                ])
                .parse(await readBody(request));
              let change: PendingReviewChange;
              if (input.action === "note") {
                const target = bundle.targets.find((entry) => entry.id === input.targetId);
                const note = target
                  ? (await savedReviews.notes(id!, target.id)).notes.find(
                      (entry) => entry.id === input.noteId,
                    )
                  : undefined;
                if (!target || !note || note.parentId)
                  throw new HostError("note-not-found", "This review has no such comment.", 404);
                if (target.captured)
                  throw new HostError(
                    "not-pull-request-head",
                    "This comment is on captured working changes, which GitHub does not have.",
                    409,
                  );
                // GitHub reads a removed line against the pull request's own
                // base, which can differ from this version's.
                if (note.side === "old")
                  throw new HostError(
                    "old-side",
                    "Only a comment on the new side can go to GitHub.",
                    409,
                  );
                if (note.resolution && note.resolution !== "active")
                  throw new HostError(
                    "stale-note",
                    "This comment's lines changed since you wrote it, so GitHub would show it on other lines.",
                    409,
                  );
                change = {
                  kind: "comment",
                  commit: target.head,
                  path: note.path,
                  side: note.side,
                  line: note.endLine ?? note.line,
                  ...(note.endLine ? { startLine: note.line } : {}),
                  body: note.text,
                };
              } else if (input.action === "reply")
                change = { kind: "reply", thread: input.thread, body: input.body };
              else if (input.action === "submit")
                change = {
                  kind: "submit",
                  event: input.event,
                  ...(input.body ? { body: input.body } : {}),
                };
              else change = { kind: "discard" };
              assertRequestAccess();
              send(await changePendingReview(bundle.pullRequestUrl, change));
              return;
            }
            if (request.method === "POST" && action === "details") {
              const input = savedReviewDetailsSchema.parse(await readBody(request));
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
              void touchReview(id!);
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
              const repositories = await registry.list(abort.signal);
              send({ repositories: repositories.filter((entry) => !isSuperagentRepo(entry.path)) });
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
              // Ignored folders have no file events, so a list with them reads again.
              const files = input.ignored ? undefined : revisions.token(input.source.repo);
              const state = files && (await registry.gitState(input.source.repo));
              const { repo } = input.source;
              const { ignored } = input;
              send(
                await browseCache.get(repo, state && `${files}\n${state}`, () =>
                  listBrowse({ kind: "worktree", repo }, ignored),
                ),
              );
              return;
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
            // Symbols in the project of a checkout come from its working
            // files, with their uncommitted changes; a commit, or a checkout
            // too large for Ctags, from the index. A watcher that sees file
            // edits lets the last read answer each key.
            const project = !input.path && input.source.kind === "worktree";
            if (project) {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            send(
              input.path
                ? await symbols.search(input, abort.signal)
                : (project &&
                    (await projectSymbols(input.source.repo, input.query, abort.signal))) ||
                    (await registry.withSearch(input.source.repo, (search) =>
                      search.symbols(input.source, input.query, abort.signal),
                    )),
            );
            return;
          }
          if (url.pathname === "/api/browse/hover" && request.method === "POST") {
            const input = symbolHoverRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(await hoverSymbol(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/search" && request.method === "POST") {
            const input = browseSearchRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              await registry.withSearch(input.source.repo, (search) =>
                search.search(input.source, input.query, abort.signal, input.matchCase),
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
            const repo = await requireRepo(url.searchParams.get("repo"));
            send(
              await targetsCache.get(repo, await registry.gitState(repo), () => gitTargets(repo)),
            );
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
          // A branch's own commits, from its merge base to its head, beside its Changes.
          if (url.pathname === "/api/commits" && request.method === "GET") {
            const range =
              repository.git === false && !options.service
                ? undefined
                : await loadRangeCommits(
                    await requireRepo(url.searchParams.get("repo")),
                    url.searchParams.get("base") ?? "",
                    url.searchParams.get("head") ?? "",
                    abort.signal,
                  );
            send({ commits: range?.list ?? [], more: range?.more ?? false });
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
          // Threads: open as a tab, close to history, reorder, and delete.
          if (url.pathname === "/api/threads" && request.method === "GET") {
            send(await threads.list());
            return;
          }
          if (url.pathname === "/api/threads/history" && request.method === "GET") {
            send({ threads: await threads.history() });
            return;
          }
          // The marks that a browser kept of what the reader saw, before
          // the host kept them; once, from each browser.
          if (url.pathname === "/api/threads/seen" && request.method === "POST") {
            await threads.mergeSeen(threadMarksSchema.parse(await readBody(request)).marks);
            send({ ok: true });
            return;
          }
          // `med thread wait`: the tabs once they differ from the list that
          // the caller has, or as they are after a while. The feed reads the
          // tabs for every listener at once, as it does for the windows.
          if (url.pathname === "/api/threads/next" && request.method === "POST") {
            const input = threadNextSchema.parse((await readBody(request).catch(() => ({}))) ?? {});
            // A caller that left while its body was read waits for nothing.
            if (abort.signal.aborted) return;
            if (threadWaits.size >= 16)
              throw new HostError("too-many-waits", "Too many thread waits are open.", 503);
            // A wait is cheap while it waits: it leaves its place among the
            // host's busy requests to the others, and the cap above bounds it.
            release();
            const version = (text: string) => createHash("sha256").update(text).digest("hex");
            // The list's text; undefined when the request ended first.
            let text = await new Promise<string | undefined>((settle) => {
              let last: string | undefined;
              const done = (answer: string | undefined) => {
                clearTimeout(timer);
                remove();
                threadWaits.delete(done);
                abort.signal.removeEventListener("abort", aborted);
                settle(answer);
              };
              const aborted = () => done(undefined);
              // A feed that has read nothing yet leaves an empty answer: the
              // list is read below.
              const timer = setTimeout(() => done(last ?? ""), input.waitMs);
              threadWaits.add(done);
              abort.signal.addEventListener("abort", aborted);
              const remove = threadFeed.add((list) => {
                last = list;
                if (version(list) !== input.version) done(list);
              });
            });
            if (text === undefined || abort.signal.aborted) return;
            text ||= JSON.stringify(await threads.list());
            response.writeHead(200, {
              "content-type": "application/json",
              "cache-control": "no-store",
            });
            response.end(`{"version":${JSON.stringify(version(text))},"list":${text}}`);
            return;
          }
          if (url.pathname === "/api/threads/reopen" && request.method === "POST") {
            const thread = await threads.reopen();
            if (!thread)
              throw new HostError("thread-not-found", "No archived thread to reopen.", 404);
            send({ thread });
            return;
          }
          const threadAction =
            /^\/api\/threads\/([\w-]+)\/(open|close|delete|archive|name|pin|seen|base)$/.exec(
              url.pathname,
            );
          if (threadAction && request.method === "POST") {
            const id = threadIdSchema.parse(threadAction[1]);
            const action = threadAction[2];
            const body = await readBody(request).catch(() => ({}));
            if (action === "open") {
              threadOpenSchema.parse(body ?? {});
              send({ thread: await threads.open(id) });
            } else if (action === "close") {
              const input = threadCloseSchema.parse(body ?? {});
              send({ closed: await threads.close(id, input, abort.signal) });
            } else if (action === "delete") {
              await threads.delete(id);
              send({ deleted: true });
            } else if (action === "name") {
              await threads.rename(id, threadNameSchema.parse(body ?? {}).name);
              send({ ok: true });
            } else if (action === "pin") {
              const pin = threadPinSchema.parse(body ?? {});
              await threads.pin(id, pin.pinned, pin.at);
              send({ ok: true });
            } else if (action === "seen") {
              await threads.see(id, threadSeenSchema.parse(body ?? {}).at);
              send({ ok: true });
            } else if (action === "base") {
              // The branch that the thread's Changes start from; null for the base.
              const input = z
                .object({ base: z.string().trim().min(1).max(256).nullable() })
                .parse(body ?? {});
              await threads.setBase(id, input.base ?? undefined);
              send({ ok: true });
            } else {
              // Archive, from before tabs: it closes the thread, or opens it again.
              const input = z
                .object({ archived: z.boolean(), removeWorktree: z.boolean().default(false) })
                .parse(body);
              if (input.archived)
                await threads.close(id, { removeWorktree: input.removeWorktree }, abort.signal);
              else await threads.open(id);
              send({ ok: true });
            }
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
          if (url.pathname === "/api/open-in" && request.method === "GET") {
            const checkout = await requireRepo(url.searchParams.get("repo"));
            const settings = openInSettings((await settingsFile.snapshot()).settings);
            const [editors, links] = await Promise.all([
              openInEditors(),
              openInLinks(checkout, settings, openInIsGitHub),
            ]);
            send({
              editors: listedEditors(editors, settings).map(({ id, name }) => ({ id, name })),
              ...links,
            });
            return;
          }
          // For Settings: the code hosts of the sources' remotes, and every
          // editor found, listed or not.
          if (url.pathname === "/api/open-in/hosts" && request.method === "GET") {
            const checkouts = registry
              .snapshot()
              .filter((entry) => !entry.error)
              .map((entry) => entry.path);
            const [hosts, editors] = await Promise.all([
              codeHosts(checkouts, openInIsGitHub),
              openInEditors(),
            ]);
            send({
              hosts,
              editors: editors.map(({ id, name, usage }) => ({
                id,
                name,
                ...(usage && { usage }),
              })),
            });
            return;
          }
          if (url.pathname === "/api/open-in" && request.method === "POST") {
            const input = z
              .object({
                repo: z.string().optional(),
                path: z.string().min(1),
                line: z.number().int().positive().default(1),
                editor: z.string().min(1),
              })
              .parse(await readBody(request));
            const repo = await requireRepo(input.repo ?? null);
            const target = resolve(repo, input.path);
            const inside = relative(repo, target);
            if (!inside || inside.startsWith("..") || isAbsolute(inside))
              throw new HostError("path-not-allowed", "Choose a file in this repository.", 403);
            if (!(await lstat(target).catch(() => null)))
              throw new HostError("not-found", "This file is not in the working tree.", 404);
            const editor = (await openInEditors()).find((entry) => entry.id === input.editor);
            if (!editor) throw new HostError("not-found", "Med did not find this editor.", 404);
            (options.openIn?.launch ?? launchEditor)(editor, target, input.line);
            send({ opened: true });
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
            // Changes in the checkout's files: the last review serves again
            // while the checkout's token stays the same.
            const live =
              input.comparison.kind === "working" ||
              input.comparison.kind === "unstaged" ||
              input.comparison.kind === "staged";
            // "Only this session's files": the files that the session edited,
            // from its transcript, read again for each load.
            const scoped =
              input.comparison.kind !== "patch" && input.comparison.kind !== "files"
                ? input.comparison
                : undefined;
            if (scoped?.session) {
              const { session, ...comparison } = scoped;
              const edited = await sessionEdits.paths(session, input.repo);
              const listed = comparison.paths && new Set(comparison.paths);
              const paths = (listed ? edited.filter((path) => listed.has(path)) : edited).slice(
                -MAX_COMPARISON_PATHS,
              );
              const scopedRequest = { repo: input.repo, comparison: { ...comparison, paths } };
              const review = await (live
                ? loadLive(scopedRequest, abort.signal)
                : reviews.load(scopedRequest, abort.signal));
              abort.signal.throwIfAborted();
              notes.adopt(review.id);
              send({ ...review, comparison: input.comparison });
              return;
            }
            const review = await (live
              ? loadLive(input, abort.signal)
              : reviews.load(input, abort.signal));
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
        path === "/settings" ||
        path.startsWith("/settings/") ||
        path === "/sessions" ||
        path === "/welcome" ||
        path === "/elements" ||
        path.startsWith("/vault/") ||
        path === "/file" ||
        path.startsWith("/file/") ||
        path === "/files" ||
        path === "/search" ||
        path === "/pulls" ||
        path === "/archived" ||
        path === "/history" ||
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
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : data);
    })()
      .catch((error: unknown) => {
        // A request that fails because the host closes gets no answer, as
        // after the host has closed; the page asks again when Med is back.
        if (response.headersSent || response.destroyed || closing) {
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
      basePulls.close();
      queuedMessages.stop();
      await ownedSessions.detachAll();
      closeTranscripts();
      found.close();
      checkoutWork.close();
      pullRequestLinks.close();
      settingsFile.close();
      for (const done of [...threadWaits]) done(undefined);
      threadFeed.close();
      checkoutChanges.close();
      threads.stop();
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
        // Bun's node:http keeps waiting for a socket that a page's WebSocket
        // upgraded, after it ends. The port is free once `close` returns.
        setTimeout(resolvePromise, 500).unref();
      });
      await options.onClose?.();
    },
  };
}
