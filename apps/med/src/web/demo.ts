// Med's live demo for the website: the real web app, answered from a
// recording of a real session instead of a server. The website's screenshot
// script records it (apps/med-site/scripts/screenshots/capture.ts).
//
// Reads replay the recorded answers. Event streams send what they recorded
// and stay open. Writes that change comments, messages, or Git state
// change a copy of that state in memory, and Med reads the copy back; other
// writes succeed and change nothing. The clock starts at the time of the
// recording, so relative times read as they did then. The layout is the
// recorded one, and the theme follows the visitor's light or dark setting.
//
// `?scene=` picks the view, one for each window on the website: the review,
// the guide, a comment, the agent's session, the commit, or the notes vault.
// Med's Screens page (/screens) uses the same scenes, and its own, on the
// recordings that `?recording=` names.
// The review plays its recording on a timeline: the reviewer sends a comment,
// and the agent answers it. `?still` keeps a scene at its first moment, for
// screenshots. `?full` shows the whole window, not just the scene's part.

import type { AgentInboxState, AgentMessage } from "../shared/agent-inbox";
import type { AgentStatus } from "../shared/agent-status";
import type { Note, NoteMutation, NoteState, RegisteredRepository } from "../shared/protocol";
import type { AgentSession, FileComment, SavedReview } from "../shared/saved-review";
import type { BrowseRead } from "../shared/browse";
import type { SymbolHoverRequest } from "../shared/symbols";
import { definitionText } from "../shared/definition-text";
import type { PullInbox, PullInboxRow } from "../shared/pull-inbox";
import { parseSessionKey, sessionKey, threadOfReview, type ThreadList } from "../shared/threads";
import type { WorkingStatus } from "../shared/git-actions";

interface Chunk {
  /** Milliseconds from the start of the timeline. */
  at: number;
  text: string;
}

interface Entry {
  method: string;
  /** Path and query. */
  url: string;
  /** A request body, when it was text. */
  body?: string;
  status: number;
  type: string;
  text: string;
  /** The text is base64, for images. */
  base64?: boolean;
  /** When the answer came, in milliseconds from the start of the timeline.
   * Only a recording with a timeline has it. */
  at?: number;
  /** An event stream's events, each when it came. */
  chunks?: Chunk[];
}

interface Recording {
  /** The app's path when it was recorded. */
  path: string;
  recordedAt: number;
  /** The app's local settings: panes, workspaces, modes, and drafts. */
  storage: Record<string, string>;
  entries: Entry[];
}

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "review";
// The notes vault and the review's timeline have recordings of their own.
// The Screens page names its own recordings (public/screens).
const file =
  params.get("recording") ??
  (scene === "notes" ? "vault.json" : scene === "review" ? "hero.json" : "recording.json");
const recording: Recording = await fetch(new URL(file, document.baseURI)).then((response) =>
  response.json(),
);
modernize(recording);
if (scene === "replies") answerComment(recording);
if (scene === "files" || scene === "comments") commentedFile(recording);

/**
 * The recordings are of the Med before a session was its own thread: a saved
 * review listed its sessions, and their routes went by the review. They read
 * as today's routes: a review names its one session, and the session's
 * transcript, Med's run of it, and its agent's inbox go by its key.
 */
function modernize(recording: Recording) {
  const sessions = new Map<string, AgentSession>();
  const threads = new Map<string, string>();
  for (const entry of recording.entries) {
    if (entry.method !== "GET" || !/^\/api\/reviews\/r_[a-f0-9]+$/.test(entry.url)) continue;
    const { sessions: list = [], ...review } = JSON.parse(entry.text) as SavedReview & {
      sessions?: AgentSession[];
    };
    for (const session of list) sessions.set(session.id, session);
    const session = list.at(-1);
    if (session) review.session = session;
    entry.text = JSON.stringify(review);
    threads.set(review.id, threadOfReview(review));
  }
  const keyOf = (id: string) => sessionKey(sessions.get(id) ?? { agent: "claude", id });
  for (const entry of recording.entries)
    entry.url = entry.url
      .replace(
        /^\/api\/reviews\/r_[a-f0-9]+\/sessions\/([^/?]+)/,
        (_, id) => `/api/sessions/${keyOf(id)}`,
      )
      .replace(
        /^\/api\/reviews\/r_[a-f0-9]+\/owned\/([^/?]+)/,
        (_, id) => `/api/sessions/${keyOf(id)}/owned`,
      )
      .replace(
        /^\/api\/reviews\/(r_[a-f0-9]+)\/agent/,
        (_, id) => `/api/sessions/${threads.get(id) ?? id}/agent`,
      );
}

/** The recorded review, which the recording's path opens. */
const recordedReview = (recording: Recording) => {
  const id = /^\/review\/([^/?]+)/.exec(recording.path)?.[1];
  const entry = recording.entries.find(
    (other) => other.method === "GET" && other.url === `/api/reviews/${id}`,
  );
  return entry ? (JSON.parse(entry.text) as SavedReview) : undefined;
};

/** Med runs the thread's session, so a comment goes to it from the comment. */
function ownSessions(recording: Recording) {
  const rewrite = (text: string, change: (value: any) => void) =>
    text.replace(/^data: (.*)$/gm, (_line, json: string) => {
      const value = JSON.parse(json);
      change(value);
      return `data: ${JSON.stringify(value)}`;
    });
  for (const entry of recording.entries) {
    if (entry.method !== "GET") continue;
    const path = entry.url.split("?")[0]!;
    if (!/\/agent(\/events)?$/.test(path)) continue;
    const session = recordedReview(recording)?.session;
    const own = (state: AgentInboxState) => {
      state.owned = [
        ...new Set([
          ...state.messages.map((message) => message.sessionId),
          ...(session ? [session.id] : []),
        ]),
      ];
    };
    if (path.endsWith("/events")) {
      entry.text = rewrite(entry.text, own);
      for (const chunk of entry.chunks ?? []) chunk.text = rewrite(chunk.text, own);
    } else {
      const state = JSON.parse(entry.text) as AgentInboxState;
      own(state);
      entry.text = JSON.stringify(state);
    }
  }
}

/**
 * The files scene: a comment on lines of a file that the agent answered and
 * resolved (`med reply --resolve`), and Med runs the agent's session.
 */
function commentedFile(recording: Recording) {
  ownSessions(recording);
  const saved = recordedReview(recording);
  if (!saved) return;
  const at = (minutes: number) => new Date(recording.recordedAt - minutes * 60_000).toISOString();
  const comments: FileComment[] = [
    {
      id: "f11e0c00-0000-4000-8000-000000000001",
      source: { kind: "worktree", repo: "/work/trailhead" },
      path: "src/search/query.ts",
      line: 18,
      endLine: 22,
      quote:
        '  return value\n    .normalize("NFD")\n    .replace(/[\\u0300-\\u036f]/g, "")\n    .toLowerCase()\n    .trim();',
      text: "This runs on every keystroke for every trail. Normalize the names once, when the trails load.",
      createdAt: at(14),
      updatedAt: at(14),
      replies: [
        {
          id: "f11e0c00-0000-4000-8000-000000000002",
          text: "Done: the index keeps each trail's normalized name, built once in `loadTrails`, and the search compares against it. The 2,400-trail fixture filters in 3 ms instead of 41.",
          author: { agent: "claude" },
          createdAt: at(9),
        },
      ],
      resolved: { at: at(9), by: { agent: "claude" } },
    },
  ];
  recording.entries.push({
    method: "GET",
    url: `/api/threads/${threadOfReview(saved)}/file-comments`,
    status: 200,
    type: "application/json",
    text: JSON.stringify({ comments }),
  });
}

/**
 * The replies scene: Med runs the agent's session, and the agent has
 * answered the reviewer's comment in its thread (`med reply`).
 */
function answerComment(recording: Recording) {
  const rewrite = (text: string, change: (value: any) => void) =>
    text.replace(/^data: (.*)$/gm, (_line, json: string) => {
      const value = JSON.parse(json);
      change(value);
      return `data: ${JSON.stringify(value)}`;
    });
  for (const entry of recording.entries) {
    if (entry.method !== "GET") continue;
    const path = entry.url.split("?")[0]!;
    if (/\/targets\/[^/]+\/notes$/.test(path)) {
      const state = JSON.parse(entry.text) as NoteState;
      const comment = state.notes.find((note) => !note.parentId);
      if (!comment) continue;
      const answered = new Date(recording.recordedAt).toISOString();
      state.notes.push({
        path: comment.path,
        side: comment.side,
        line: comment.line,
        ...(comment.endLine ? { endLine: comment.endLine } : {}),
        parentId: comment.id,
        text: 'On the list, it reads out every trail as the list changes. I would put it on the count above the list instead, so a filter change is one short announcement: "12 trails". Shall I?',
        id: "c0ffee00-0000-4000-8000-000000000001",
        createdAt: answered,
        updatedAt: answered,
        resolution: "active",
        author: { agent: "claude" },
      });
      entry.text = JSON.stringify(state);
    }
    // Med runs the session: a comment goes to it from the comment.
    if (/\/agent(\/events)?$/.test(path)) {
      const own = (state: AgentInboxState) => {
        const ids = [...new Set(state.messages.map((message) => message.sessionId))];
        state.owned = ids;
      };
      if (path.endsWith("/events")) {
        entry.text = rewrite(entry.text, own);
        for (const chunk of entry.chunks ?? []) chunk.text = rewrite(chunk.text, own);
      } else {
        const state = JSON.parse(entry.text) as AgentInboxState;
        own(state);
        entry.text = JSON.stringify(state);
      }
    }
  }
}

// The clock. A timeline's recording time is its start, which the clock
// shows again when the timeline starts.
const RealDate = Date;
let offset = recording.recordedAt - RealDate.now();
class RecordedDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    if (args.length) super(...(args as ConstructorParameters<DateConstructor>));
    else super(RealDate.now() + offset);
  }
  static override now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = RecordedDate as DateConstructor;

// The timeline. Until it starts, the demo answers as Med stood at its start;
// then each answer and event comes when it came in the recording. Without a
// timeline, the last answer recorded for a request is the answer.
let started: number | undefined;
const queued: (() => void)[] = [];
const elapsed = () => (started === undefined ? 0 : performance.now() - started);
/** Runs `run` at `time` on the timeline. */
const at = (time: number, run: () => void) => {
  if (started === undefined) queued.push(() => at(time, run));
  else setTimeout(run, Math.max(0, time - elapsed()));
};
function start() {
  if (started !== undefined) return;
  started = performance.now();
  offset = recording.recordedAt - RealDate.now();
  for (const run of queued.splice(0)) run();
}
// Med asks again as soon as an event says something changed, a moment before
// the recorded answer came.
const AHEAD = 600;
function pick(list: Entry[] | undefined): Entry | undefined {
  if (!list?.length) return undefined;
  const now = started === undefined ? 0 : elapsed() + AHEAD;
  let chosen: Entry | undefined;
  for (const entry of list) if ((entry.at ?? -Infinity) <= now) chosen = entry;
  return chosen ?? list[0];
}

// The recorded server.
const key = (method: string, url: string, body?: string) =>
  `${method} ${url}${body === undefined ? "" : ` ${body}`}`;
const answers = new Map<string, Entry[]>();
const record = (name: string, entry: Entry) => {
  const list = answers.get(name) ?? [];
  list.push(entry);
  answers.set(name, list);
};
for (const entry of [...recording.entries].sort(
  (a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity),
)) {
  record(key(entry.method, entry.url, entry.body), entry);
  if (entry.body !== undefined) record(key(entry.method, entry.url), entry);
  record(key(entry.method, entry.url.split("?")[0]!, "*"), entry);
}

const encoder = new TextEncoder();
/** The event streams that Med has open, by path, for events that a write sends. */
const open = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
function send(path: string, text: string) {
  for (const controller of open.get(path) ?? []) {
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      // Med closed it.
    }
  }
}
function respond(entry: Entry, path: string): Response {
  const headers = { "content-type": entry.type };
  if (entry.type.startsWith("text/event-stream")) {
    const chunks = entry.chunks ?? [{ at: -Infinity, text: entry.text }];
    let stream: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        open.set(path, (open.get(path) ?? new Set()).add(controller));
        const now = elapsed();
        for (const chunk of chunks) {
          const push = () => {
            try {
              controller.enqueue(encoder.encode(chunk.text));
            } catch {
              // Med closed it.
            }
          };
          if (chunk.at <= now) push();
          else at(chunk.at, push);
        }
      },
      cancel() {
        open.get(path)?.delete(stream);
      },
    });
    return new Response(body, { status: entry.status, headers });
  }
  const body = entry.base64
    ? Uint8Array.from(atob(entry.text), (character) => character.charCodeAt(0))
    : entry.text;
  return new Response(body, { status: entry.status, headers });
}

// The state that writes change, by request: Med reads it back in place of
// the recorded answer.
const kept = new Map<string, unknown>();
function read<T>(path: string): T | undefined {
  const value = kept.get(key("GET", path));
  if (value !== undefined) return structuredClone(value) as T;
  const entry = pick(answers.get(key("GET", path)));
  if (!entry || entry.type.startsWith("text/event-stream")) return undefined;
  try {
    return JSON.parse(entry.text) as T;
  } catch {
    return undefined;
  }
}
const keep = (path: string, value: unknown, method = "GET", body?: string) =>
  kept.set(key(method, path, body), value);
const hex = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length / 2)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
class DemoError extends Error {}

/** The saved review, after `change`. */
function changeReview(id: string, change: (saved: SavedReview) => void): SavedReview {
  const saved = read<SavedReview>(`/api/reviews/${id}`);
  if (!saved) throw new DemoError("This review is not in the demo.");
  change(saved);
  saved.revision += 1;
  keep(`/api/reviews/${id}`, saved);
  return saved;
}

/** The last state that a recorded event stream had sent by now. */
function streamed<T>(path: string): T | undefined {
  const entry = pick(answers.get(key("GET", path)));
  const text =
    entry?.chunks
      ?.filter((chunk) => chunk.at <= elapsed())
      .map((chunk) => chunk.text)
      .join("") ??
    entry?.text ??
    "";
  const data = text
    .split("\n\n")
    .filter((block) => block.startsWith("event: state"))
    .at(-1)
    ?.split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return data ? (JSON.parse(data) as T) : undefined;
}

/** The thread of a saved review: its session's, or its own. */
function threadOf(reviewId: string) {
  const saved = read<SavedReview>(`/api/reviews/${reviewId}`);
  return saved ? threadOfReview(saved) : reviewId;
}

/** A session's agent inbox: the messages sent from Med, and the comments not sent yet. */
function inbox(thread: string): AgentInboxState {
  const path = `/api/sessions/${thread}/agent`;
  if (kept.has(key("GET", path))) return read<AgentInboxState>(path)!;
  return (
    streamed<AgentInboxState>(`${path}/events`) ??
    read<AgentInboxState>(path) ?? {
      messages: [],
      elsewhere: {},
      resumable: [],
      owned: [],
      drafts: [],
    }
  );
}

/** The sidebar's threads: the recorded review's session, with its agent's
 * state at this moment of the recording. */
function threadList(): ThreadList {
  const repositories = (
    read<{ repositories: RegisteredRepository[] }>("/api/repositories")?.repositories ?? []
  ).map(({ id, name, path }) => ({ id, name, path }));
  const id = /^\/review\/([^/?]+)/.exec(recording.path)?.[1];
  const saved = id ? read<SavedReview>(`/api/reviews/${id}`) : undefined;
  if (!saved) return { threads: [], repositories };
  const target = saved.targets.at(-1);
  const repository = repositories.find((entry) => entry.id === target?.repositoryId);
  const status = streamed<{ statuses: AgentStatus[] }>("/api/agent-status/events")?.statuses.find(
    (entry) => entry.reviewId === saved.id,
  );
  const changes = saved.totals && {
    files: saved.totals.files,
    additions: saved.totals.additions,
    deletions: saved.totals.deletions,
  };
  const place = {
    ...(repository && { repository }),
    ...(target && { checkout: target.repo }),
    ...(target?.branch && { branch: target.branch }),
  };
  const reviews: ThreadList["threads"][number]["reviews"] = [
    {
      id: saved.id,
      title: saved.title,
      createdAt: saved.createdAt,
      updatedAt: status?.updatedAt ?? Date.parse(saved.createdAt),
      ...(target && { repo: target.repo }),
      ...(target?.branch && { branch: target.branch }),
      ...(changes && { changes }),
    },
  ];
  // In the session scene the agent also handed off an earlier review, so the
  // side panel's Reviews lists two.
  if (scene === "session" && saved.session)
    reviews.push({
      id: "r_000000000000000000de0001",
      title: "Parse trail filters",
      createdAt: saved.createdAt,
      updatedAt: Date.parse(saved.createdAt) - 50 * 60_000,
      ...(target && { repo: target.repo }),
      ...(target?.branch && { branch: target.branch }),
    });
  const thread: ThreadList["threads"][number] = {
    id: threadOfReview(saved),
    kind: saved.session ? "session" : "review",
    title: saved.title,
    createdAt: saved.createdAt,
    updatedAt: reviews[0]!.updatedAt,
    ...place,
    ...(status && { agent: status.agent, state: status.state }),
    ...(saved.session && { session: saved.session }),
    reviews,
    ...(changes && { changes }),
    open: true,
  };
  // In the superagent scene, the Superagent's session is its row at the top
  // of the sidebar.
  const superagent: ThreadList["threads"][number] | undefined =
    scene === "superagent"
      ? {
          id: "claude-demo-superagent",
          kind: "session",
          title: "Superagent",
          createdAt: saved.createdAt,
          updatedAt: Date.parse(saved.createdAt) + 60_000,
          session: { agent: "claude", id: "demo-superagent", cwd: "/work" },
          reviews: [],
          superagent: true,
          agent: "claude",
          state: "idle",
          open: true,
        }
      : undefined;
  return { threads: [...(superagent ? [superagent] : []), thread], repositories };
}

/** The thread list's stream: the list now, and again when the agent's state
 * changes on the timeline. */
function threadStream(): Response {
  const changes = pick(answers.get(key("GET", "/api/agent-status/events")))?.chunks ?? [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => {
        try {
          controller.enqueue(
            encoder.encode(`event: state\ndata: ${JSON.stringify(threadList())}\n\n`),
          );
        } catch {
          // Med closed it.
        }
      };
      push();
      const now = elapsed();
      for (const change of changes) if (change.at > now) at(change.at, push);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
function setInbox(thread: string, state: AgentInboxState) {
  keep(`/api/sessions/${thread}/agent`, state);
  send(`/api/sessions/${thread}/agent/events`, `event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

/** Adds, edits, or removes a comment, as the host does. */
function mutateNotes(
  path: string,
  input: { reviewId?: string; mutation: NoteMutation },
  savedId?: string,
): NoteState {
  const current = read<NoteState>(path) ?? {
    reviewId: input.reviewId ?? "",
    revision: 0,
    notes: [],
  };
  const now = new Date().toISOString();
  const { mutation } = input;
  let notes = current.notes;
  let count = 0;
  if (mutation.type === "add") {
    const note: Note = {
      ...mutation.note,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      resolution: "active",
    };
    notes = [...notes, note];
    count = 1;
  } else if (mutation.type === "edit") {
    notes = notes.map((note) =>
      note.id === mutation.id ? { ...note, text: mutation.text, updatedAt: now } : note,
    );
  } else {
    notes = notes.filter((note) => note.id !== mutation.id && note.parentId !== mutation.id);
    count = notes.length - current.notes.length;
  }
  const next = { ...current, revision: current.revision + 1, notes };
  keep(path, next);
  if (savedId) {
    if (count) changeReview(savedId, (saved) => (saved.commentCount += count));
    // A top-level comment that changed is a draft for the agent again.
    const thread = threadOf(savedId);
    const state = inbox(thread);
    const drafts = state.drafts.filter((draft) => !("id" in mutation) || draft.id !== mutation.id);
    const changed =
      mutation.type === "add"
        ? notes.at(-1)
        : mutation.type === "edit"
          ? notes.find((note) => note.id === mutation.id)
          : undefined;
    if (changed && !changed.parentId)
      drafts.push({
        id: changed.id,
        path: changed.path,
        line: changed.line,
        ...(changed.endLine ? { endLine: changed.endLine } : {}),
        text: changed.text,
        replies: 0,
      });
    setInbox(thread, { ...state, drafts });
  }
  return next;
}

/** The saved review's comments on files, across its comparisons. */
function savedNotes(saved: SavedReview) {
  return saved.targets.flatMap((target) => {
    const path = `/api/reviews/${saved.id}/targets/${target.id}/notes`;
    const state = read<NoteState>(path);
    return state ? [{ path, state }] : [];
  });
}

/** Git: the status of a checkout, and the working changes that the Commit tab shows. */
const statusPath = (repo: string) => `/api/git/status?repo=${encodeURIComponent(repo)}`;
const workingBody = (repo: string) => JSON.stringify({ repo, comparison: { kind: "working" } });
function status(repo: string): WorkingStatus {
  const value = read<WorkingStatus>(statusPath(repo));
  if (!value) throw new DemoError("This checkout is not in the demo.");
  return value;
}

type Handler = (url: URL, body: any, match: RegExpMatchArray) => unknown;
// The settings file, kept in the page: Settings writes it, and Open in reads it.
const demoSettings: Record<string, unknown> = {};

/** Open pull requests on an invented GitHub, as the pull requests page reads them. */
function pullInbox(all: boolean): PullInbox {
  const hours = (count: number) => new Date(Date.now() - count * 3_600_000).toISOString();
  const pull = (
    repository: string,
    number: number,
    title: string,
    author: string,
    age: number,
    change: Partial<PullInboxRow> = {},
  ): PullInboxRow => ({
    url: `https://github.com/${repository}/pull/${number}`,
    number,
    title,
    repository,
    author,
    createdAt: hours(age + 30),
    updatedAt: hours(age),
    draft: false,
    review: "required",
    checks: "pass",
    conflicts: false,
    additions: 120,
    deletions: 18,
    ...change,
  });
  return {
    viewer: "you",
    scope: all ? "all" : "registered",
    repositories: all ? [] : ["acme/elevation", "acme/trailhead"],
    readAt: new Date(Date.now() - 60_000).toISOString(),
    waiting: [
      pull("acme/trailhead", 418, "Cache map tiles by zoom level", "maya", 3, {
        why: "review requested",
        additions: 340,
        deletions: 51,
      }),
      pull("acme/trailhead", 419, "Show elevation on the trail card", "ines", 26, {
        why: "review requested of acme/maps",
        checks: "pending",
        additions: 64,
        deletions: 9,
      }),
      pull("acme/trailhead", 412, "Retry the upload queue with backoff", "you", 5, {
        why: "changes requested",
        review: "changes-requested",
        checks: "fail",
        additions: 128,
        deletions: 40,
      }),
    ],
    yours: [
      pull("acme/trailhead", 420, "Search filters: chips in the search bar", "you", 1, {
        additions: 212,
        deletions: 33,
        stack: [
          {
            url: "https://github.com/acme/trailhead/pull/421",
            number: 421,
            title: "Search filters: clear all",
          },
        ],
      }),
      pull("acme/elevation", 77, "Bump the elevation API client", "you", 50, {
        review: "approved",
        additions: 14,
        deletions: 14,
      }),
      pull("acme/trailhead", 405, "Offline packs for saved trails", "you", 120, {
        draft: true,
        review: "none",
        checks: "none",
        additions: 860,
        deletions: 120,
      }),
    ],
  };
}

const handlers: [method: string, path: RegExp, handler: Handler][] = [
  // Settings › Open in: Trailhead's code hosts, and the editors on this Mac.
  [
    "GET",
    /^\/api\/open-in\/hosts$/,
    () => ({
      hosts: [
        { host: "github.acme.build", repositories: 31, github: true },
        { host: "github.com", repositories: 14, github: true },
        { host: "git.acme.build", repositories: 2, github: false },
      ],
      editors: [
        { id: "vscode", name: "VS Code", usage: "code -g file:line" },
        { id: "cursor", name: "Cursor", usage: "cursor -g file:line" },
        { id: "zed", name: "Zed", usage: "zed file:line" },
        { id: "idea", name: "IntelliJ IDEA", usage: "idea --line line file" },
      ],
    }),
  ],
  [
    "PUT",
    /^\/api\/settings$/,
    (_url, body) => {
      demoSettings[body.key] = body.value;
      return { path: "~/.config/med/settings.json", settings: { ...demoSettings }, error: null };
    },
  ],
  // New thread's model and effort, as Claude Code offers them.
  [
    "GET",
    /^\/api\/agents\/[^/]+\/choices$/,
    () => ({
      model: {
        id: "model",
        name: "Model",
        category: "model",
        value: "opus",
        options: [
          { value: "default", name: "Default (recommended)" },
          { value: "opus", name: "Opus" },
          { value: "sonnet", name: "Sonnet" },
          { value: "haiku", name: "Haiku" },
        ],
      },
      effort: {
        id: "effort",
        name: "Effort",
        category: "effort",
        value: "high",
        options: [
          { value: "default", name: "Default effort" },
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra high" },
        ],
      },
      efforts: {
        default: ["low", "medium", "high", "xhigh"],
        opus: ["low", "medium", "high", "xhigh"],
        sonnet: ["low", "medium", "high"],
        haiku: [],
      },
    }),
  ],
  [
    "POST",
    /^\/api\/reviews\/([^/]+)\/(?:targets|browsing)\/[^/]+\/notes$/,
    (url, body, [, id]) => mutateNotes(url.pathname, body, id),
  ],
  // A comparison that the recording did not comment on has no comments.
  [
    "GET",
    /^\/api\/reviews\/[^/]+\/(?:targets|browsing)\/([^/]+)\/notes$/,
    (_url, _body, [, reviewId]) => ({ reviewId, revision: 0, notes: [] }),
  ],
  [
    "POST",
    /^\/api\/notes$/,
    (_url, body) =>
      mutateNotes(`/api/notes?${new URLSearchParams({ reviewId: body.reviewId })}`, body),
  ],
  [
    "GET",
    /^\/api\/notes$/,
    (url) => ({ reviewId: url.searchParams.get("reviewId") ?? "", revision: 0, notes: [] }),
  ],
  [
    "POST",
    /^\/api\/reviews\/([^/]+)\/clear$/,
    (_url, _body, [, id]) => {
      const saved = changeReview(id!, (saved) => (saved.commentCount = 0));
      for (const { path, state } of savedNotes(saved))
        keep(path, { ...state, revision: state.revision + 1, notes: [] });
      const thread = threadOfReview(saved);
      setInbox(thread, { ...inbox(thread), drafts: [] });
      return saved;
    },
  ],
  // The pull requests page, from an invented GitHub.
  ["GET", /^\/api\/pull-requests$/, (url) => pullInbox(url.searchParams.get("all") === "1")],
  // A hover finds a name's declaration in the files that the recording read,
  // the hovered file first, as Med's index would.
  [
    "POST",
    /^\/api\/browse\/hover$/,
    (_url, body: SymbolHoverRequest) => {
      const files = recording.entries
        .filter((entry) => entry.url === "/api/browse/read" && entry.body)
        .map((entry) => JSON.parse(entry.text) as BrowseRead)
        .filter((file) => file.kind === "text" && file.text !== undefined)
        .sort((a, b) => Number(b.path === body.path) - Number(a.path === body.path));
      const declaration = new RegExp(
        `^\\s*(?:export\\s+)?(?:async\\s+)?(function|const|let|class|interface|type|enum)\\s+${body.name}\\b`,
      );
      const kinds: Record<string, string> = { const: "constant", let: "variable" };
      for (const file of files) {
        const lines = file.text!.split("\n");
        const index = lines.findIndex((line) => declaration.test(line));
        if (index < 0) continue;
        const kind = declaration.exec(lines[index]!)![1]!;
        return {
          ...body,
          definitions: [
            {
              name: body.name,
              kind: kinds[kind] ?? kind,
              path: file.path,
              line: index + 1,
              source: file.source,
              ...definitionText(file.text!, index + 1),
            },
          ],
          more: 0,
        };
      }
      return { ...body, definitions: [], more: 0 };
    },
  ],
  // Comments on lines of a file belong to the thread.
  [
    "POST",
    /^\/api\/threads\/([^/]+)\/file-comments$/,
    (_url, body, [, thread]) => {
      const now = new Date().toISOString();
      const path = `/api/threads/${thread}/file-comments`;
      const comments = read<{ comments: FileComment[] }>(path)?.comments ?? [];
      const find = (target: string) => comments.find((item) => item.id === target);
      if ("add" in body) {
        comments.push({
          ...body.add,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          replies: [],
        });
      } else if ("edit" in body) {
        const comment = find(body.edit.id);
        if (comment) Object.assign(comment, { text: body.edit.text, updatedAt: now });
      } else if ("reply" in body) {
        const comment = find(body.reply.id);
        comment?.replies.push({ id: crypto.randomUUID(), text: body.reply.text, createdAt: now });
        if (comment) {
          comment.updatedAt = now;
          delete comment.resolved;
        }
      } else if ("resolve" in body) {
        const comment = find(body.resolve);
        if (comment) comment.resolved = { at: now };
      } else if ("reopen" in body) {
        const comment = find(body.reopen);
        if (comment) delete comment.resolved;
      } else {
        const index = comments.findIndex((item) => item.id === body.remove);
        if (index >= 0) comments.splice(index, 1);
      }
      keep(path, { comments });
      const state = inbox(thread!);
      const files = new Set(comments.map((comment) => comment.id));
      const sent = new Set(state.messages.flatMap((message) => message.noteIds));
      setInbox(thread!, {
        ...state,
        drafts: [
          ...state.drafts.filter((draft) => !files.has(draft.id)),
          ...comments
            .filter((comment) => !comment.resolved && !sent.has(comment.id))
            .map((comment) => ({
              id: comment.id,
              path: comment.path,
              line: comment.line,
              ...(comment.endLine ? { endLine: comment.endLine } : {}),
              text: comment.text,
              replies: comment.replies.length,
            })),
        ],
      });
      return { comments };
    },
  ],
  ["GET", /^\/api\/threads\/[^/]+\/file-comments$/, () => ({ comments: [] })],
  [
    "GET",
    /^\/api\/reviews\/([^/]+)\/feedback$/,
    (_url, _body, [, id]) => {
      const saved = read<SavedReview>(`/api/reviews/${id}`);
      if (!saved) throw new DemoError("This review is not in the demo.");
      const comments = savedNotes(saved).flatMap(({ state }) =>
        state.notes
          .filter((note) => !note.parentId)
          .map(
            (note) =>
              `File: ${note.path}\nLines: ${note.line}${note.endLine ? `-${note.endLine}` : ""}\n\nComment:\n${note.text}`,
          ),
      );
      return {
        text: comments.join("\n\n---\n\n"),
        count: comments.length,
        repositoryCount: 1,
        revision: saved.revision,
      };
    },
  ],
  [
    "POST",
    /^\/api\/sessions\/([^/]+)\/agent\/messages$/,
    (_url, body, [, thread]) => {
      const session = parseSessionKey(thread!);
      if (!session) throw new DemoError("This session is not in the demo.");
      const state = inbox(thread!);
      const noteIds: string[] = body.noteIds ?? [];
      const sent = state.drafts.filter((draft) => noteIds.includes(draft.id));
      const message: AgentMessage = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        agent: session.agent,
        text: body.text?.trim() ?? "",
        noteIds,
        ...(sent.length
          ? { comments: sent.map(({ id: _id, replies: _replies, ...comment }) => comment) }
          : {}),
        attachmentCount: body.attachments?.length ?? 0,
        createdAt: new Date().toISOString(),
        // No agent runs in the demo, so the message waits.
        delivery: "pending",
      };
      const next = {
        ...state,
        messages: [...state.messages, message],
        drafts: state.drafts.filter((draft) => !noteIds.includes(draft.id)),
      };
      setInbox(thread!, next);
      return { message, state: next };
    },
  ],
  [
    "POST",
    /^\/api\/git\/stage$/,
    async (_url, body) => {
      const { predictStage } = await import("./data/commit");
      const next = predictStage(status(body.repo), {
        paths: body.paths ? new Set<string>(body.paths) : null,
        stage: body.stage,
      });
      next.indexKey = hex(16);
      keep(statusPath(body.repo), next);
      return next;
    },
  ],
  [
    "POST",
    /^\/api\/git\/commit$/,
    (_url, body) => {
      const before = status(body.repo);
      if (!before.files.some((file) => file.staged)) throw new DemoError("Nothing is staged.");
      const head = hex(40);
      const files = before.files
        .filter((file) => file.unstaged)
        .map((file) => ({ ...file, staged: null }));
      keep(statusPath(body.repo), {
        ...before,
        head,
        ahead: before.ahead + 1,
        indexKey: hex(16),
        files,
      });
      // The Commit tab's diff keeps the files that the commit left.
      const entry = pick(answers.get(key("POST", "/api/review", workingBody(body.repo))));
      if (entry) {
        const review = JSON.parse(entry.text) as {
          id: string;
          files: { path: string }[];
          patch: string;
        };
        const left = new Set(files.map((file) => file.path));
        keep(
          "/api/review",
          {
            ...review,
            id: hex(16),
            files: review.files.filter((file) => left.has(file.path)),
            patch: review.patch
              .split(/^(?=diff --git )/m)
              .filter((part) => [...left].some((path) => part.startsWith(`diff --git a/${path} `)))
              .join(""),
          },
          "POST",
          workingBody(body.repo),
        );
      }
      return { head, summary: String(body.message).split("\n")[0]!.trim() };
    },
  ],
  [
    "POST",
    /^\/api\/git\/push-branch$/,
    (_url, body) => {
      const before = status(body.repo);
      const upstream = before.upstream ?? {
        remote: before.pushRemote ?? "origin",
        branch: before.branch,
      };
      keep(statusPath(body.repo), { ...before, upstream, ahead: 0 });
      return { head: body.head, ...upstream };
    },
  ],
];

const realFetch = fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  // Without the shared live stream, each event stream is direct, and the
  // recording keeps each one by its path.
  if (url.pathname === "/api/live") return new Response(null, { status: 404 });
  const { method } = request;
  if (method === "GET" && url.pathname === "/api/threads/events") return threadStream();
  const body = typeof init?.body === "string" ? init.body : undefined;
  const path = url.pathname + url.search;
  const changed = kept.get(key(method, path, body));
  if (changed !== undefined) return Response.json(changed);
  const entry = pick(answers.get(key(method, path, body)));
  if (entry) return respond(entry, path);
  const route = handlers.find(([verb, pattern]) => verb === method && pattern.test(url.pathname));
  if (route)
    try {
      const match = url.pathname.match(route[1])!;
      return Response.json(await route[2](url, body ? JSON.parse(body) : undefined, match));
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
      return Response.json({ error: { message: error.message } }, { status: 409 });
    }
  if (method === "GET") {
    if (import.meta.env.DEV) console.warn("demo: unrecorded", path);
    return Response.json(
      { error: { message: "This part of Med is not in the demo." } },
      { status: 404 },
    );
  }
  const loose =
    pick(answers.get(key(method, path))) ?? pick(answers.get(key(method, url.pathname, "*")));
  if (loose) return respond(loose, path);
  return Response.json({ ok: true });
};

// The demo runs in a window on a web page. Its scrolling and focus stay
// inside it: a frame that scrolls an element into view, or focuses one, also
// scrolls the page around it.
type Align = "start" | "center" | "end" | "nearest";
const shift = (align: Align, low: number, high: number, min: number, max: number) => {
  if (align === "start") return low - min;
  if (align === "end") return high - max;
  if (align === "center") return (low + high - min - max) / 2;
  if (low < min) return low - min;
  if (high > max) return Math.min(high - max, low - min);
  return 0;
};
const scrolls = (overflow: string) => /auto|scroll|overlay/.test(overflow);
Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
  const settings: ScrollIntoViewOptions =
    typeof options === "object" ? options : { block: options === false ? "end" : "start" };
  const block = (settings.block ?? "start") as Align;
  const inline = (settings.inline ?? "nearest") as Align;
  for (
    let box: Element | null = this.parentElement ?? (this.getRootNode() as ShadowRoot).host ?? null;
    box;
    box = box.parentElement ?? (box.getRootNode() as ShadowRoot).host ?? null
  ) {
    const style = getComputedStyle(box);
    const vertical = scrolls(style.overflowY) && box.scrollHeight > box.clientHeight;
    const horizontal = scrolls(style.overflowX) && box.scrollWidth > box.clientWidth;
    if (!vertical && !horizontal) continue;
    const target = this.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (vertical) box.scrollTop += shift(block, target.top, target.bottom, frame.top, frame.bottom);
    if (horizontal)
      box.scrollLeft += shift(inline, target.left, target.right, frame.left, frame.right);
  }
};
// Focus moves only after the visitor has clicked in the demo, and never
// scrolls the page.
const focus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (options?: FocusOptions) {
  if (document.hasFocus()) focus.call(this, { ...options, preventScroll: true });
};
// A scene that plays waits until most of its window is in view, which the
// page says; alone in a tab, it plays at once.
let shown: () => void;
const inView = new Promise<void>((resolve) => (shown = resolve));
if (parent === window) {
  if (!params.has("still")) shown!();
} else {
  // In a window, the wheel scrolls the page until the visitor clicks in the
  // demo, and again once the pointer leaves it.
  let engaged = false;
  addEventListener("pointerdown", () => (engaged = true), true);
  addEventListener("mouseout", (event: MouseEvent) => {
    if (!event.relatedTarget) engaged = false;
  });
  addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (engaged || event.ctrlKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      parent.postMessage({ type: "med-demo", wheel: event.deltaY * line }, "*");
    },
    { capture: true, passive: false },
  );
  // While its window is out of view, the demo's motion stops. A browser does
  // not slow a frame of the same origin, and the work-in-progress shimmer
  // paints on each frame.
  const still = document.createElement("style");
  still.textContent = "*, ::before, ::after { animation-play-state: paused !important }";
  addEventListener(
    "message",
    (event: MessageEvent<{ type?: string; visible?: boolean; play?: boolean }>) => {
      if (event.source !== parent || event.data?.type !== "med-demo") return;
      if (event.data.visible === true) still.remove();
      if (event.data.visible === false) document.head.append(still);
      if (event.data.play === true) shown();
    },
  );
}

const dark = matchMedia("(prefers-color-scheme: dark)");
// The Screens page picks the theme (`?theme=`); the website follows the visitor.
const theme = () => params.get("theme") ?? (dark.matches ? "med-night" : "med-dawn");

// The demos on a page share one origin, and so one storage: a scene's layout
// would open in the next demo, and each write would reach the others as a
// storage event. Each demo keeps its own storage, for as long as it runs.
class MemoryStorage {
  readonly #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  clear() {
    this.#items.clear();
  }
}
const storage = new MemoryStorage();
for (const [name, value] of Object.entries(recording.storage)) storage.setItem(name, value);
storage.setItem("med:theme:v1", theme());
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
Object.defineProperty(window, "sessionStorage", {
  value: new MemoryStorage(),
  configurable: true,
});
history.replaceState(null, "", recording.path);
// A page can show several demos at once, so each one highlights in a single
// worker: Med sizes its pool from the processor count.
Object.defineProperty(navigator, "hardwareConcurrency", { value: 2 });
await import("./main");
const { themeController } = await import("./themes");
dark.addEventListener("change", () => themeController.preview(theme()));

// Each scene sets up its view, then the demo tells the website it is ready.
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const all = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];
const visible = (selector: string) =>
  all<HTMLElement>(selector).find((node) => node.checkVisibility());
const until = async (test: () => unknown) => {
  for (let waited = 0; waited < 15_000 && !test(); waited += 100) await pause(100);
};
/** Shows a page of the review's header, or a file's tab. */
const tab = (name: string) =>
  all<HTMLElement>("[role='radio'], [role='tab']")
    .find((node) => node.textContent?.trim().startsWith(name))
    ?.click();
const scroller = (node: Element | null) => {
  for (let next = node?.parentElement; next; next = next.parentElement)
    if (scrolls(getComputedStyle(next).overflowY) && next.scrollHeight > next.clientHeight)
      return next;
};
/** Types into a field as a person does, one character at a time. */
const type = async (field: HTMLTextAreaElement | HTMLInputElement, text: string, ms: number) => {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  // An empty text clears the field.
  for (let length = text ? 1 : 0; length <= text.length; length += 1) {
    set.call(field, text.slice(0, length));
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await pause(ms);
  }
};
/** Scrolls the Changes stream to its first comment. */
const toComment = async () => {
  await pause(300);
  const stream = scroller(visible("diffs-container") ?? null);
  for (let step = 0; step < 40 && !visible("[data-comment-card]"); step += 1) {
    stream?.scrollBy(0, 400);
    await pause(120);
  }
  visible("[data-comment-card]")?.scrollIntoView({ block: "center" });
};
/** The review, with only the parts that a scene names. The thread sidebar
 * folds away by itself in a narrow window. */
const review = async (panes: { sidebar: boolean; session: boolean }, name: string) => {
  // The review opens on its Review page, which shows diffs only in a part.
  await until(() => visible("[data-review-status='ready']"));
  if (!panes.sidebar) visible("button[aria-label='Hide sidebar']")?.click();
  // ⌘⇧B shows the session at any width. A phone shows the chosen pane only:
  // there the session is open without room, so it closes, then opens chosen.
  // A key, not a click, so no button keeps the focus and its tooltip.
  for (let press = 0; press < 2 && !!visible(session) !== panes.session; press += 1) {
    dispatchEvent(
      new KeyboardEvent("keydown", { key: "B", code: "KeyB", metaKey: true, shiftKey: true }),
    );
    await pause(300);
  }
  // Closing the session gives its toggle the focus, which shows its tooltip.
  await pause(300);
  (document.activeElement as HTMLElement | null)?.blur();
  tab(name);
  if (name === "Changes") await until(() => visible("diffs-container"));
};
/** Review's every file, with the comments on the saved version. Changes
 * shows the checkout as it is now. */
const allFiles = async () => {
  await until(() =>
    all<HTMLButtonElement>("button").find((button) => button.textContent === "All files"),
  );
  all<HTMLButtonElement>("button")
    .find((button) => button.textContent === "All files")
    ?.click();
  await until(() => visible("diffs-container"));
};
const session = "section[aria-label='Claude session']";
/** The Commit tab's marks that stage or unstage a file. */
const marks = (action: "stage" | "unstage") =>
  all<HTMLElement>(`[aria-label='Changed files'] [title$='click to ${action}']`).filter((node) =>
    node.checkVisibility(),
  );

const scenes: Record<string, () => Promise<void>> = {
  // The thread in the sidebar, the agent's session waiting for the review,
  // and the diff with the reviewer's comment on the first file.
  async review() {
    await review({ sidebar: true, session: true }, "Changes");
    await until(() => visible(`${session} textarea`) && visible("[data-comment-card]"));
    // The first file, with the comment, at the top.
    const stream = scroller(visible("diffs-container") ?? null);
    if (stream) stream.scrollTop = 0;
  },
  // Settings, on its Appearance section: the system's light and dark, and a
  // theme for each.
  async settings() {
    await until(() => visible("[data-review-status='ready']"));
    history.pushState(null, "", "/settings");
    dispatchEvent(new PopStateEvent("popstate"));
    await until(() => visible("nav[aria-label='Settings']"));
  },
  // The agent's summary on the Review page, with links to the lines it cites.
  async brief() {
    await review({ sidebar: false, session: false }, "Review");
    await until(() => visible("section[aria-label='Guide overview']"));
  },
  // A short unified diff with the reviewer's comment.
  async comment() {
    await review({ sidebar: false, session: false }, "Review");
    await allFiles();
    localStorage.setItem("med:mode", "unified");
    dispatchEvent(new StorageEvent("storage", { key: "med:mode" }));
    await toComment();
  },
  // The agent's answer under the reviewer's comment.
  async replies() {
    await review({ sidebar: false, session: false }, "Review");
    await allFiles();
    localStorage.setItem("med:mode", "unified");
    dispatchEvent(new StorageEvent("storage", { key: "med:mode" }));
    await toComment();
  },
  async session() {
    await review({ sidebar: false, session: true }, "Review");
    await allFiles();
    await toComment();
  },
  // The Commit tab, with the first four files staged.
  async commit() {
    await review({ sidebar: false, session: false }, "Commit");
    await until(() => marks("stage").length || marks("unstage").length);
    for (const mark of marks("unstage")) mark.click();
    await until(() => !marks("unstage").length);
    for (let count = 0; count < 4; count += 1) {
      marks("stage")[0]?.click();
      await until(() => marks("unstage").length > count);
    }
  },
  // A file in the thread: a comment that the agent resolved, and a new one
  // that `gc` opened under the lines that Visual mode selected.
  async files() {
    await review({ sidebar: false, session: true }, "Review");
    dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", code: "KeyK", metaKey: true, shiftKey: true }),
    );
    await until(() => visible("input[aria-label='Find file']"));
    const find = visible("input[aria-label='Find file']") as HTMLInputElement;
    await type(find, "query.ts", 0);
    await until(() =>
      all<HTMLElement>("[role='option']").some((node) => node.textContent?.includes("query.ts")),
    );
    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // A file of the worktree opens in the editor, where Vim takes the keys.
    const content = () => visible("section[aria-label='File editor'] .cm-content");
    await until(() => content() && visible("[data-file-comment]"));
    const [{ EditorView }, { Vim, getCM }] = await Promise.all([
      import("@codemirror/view"),
      import("@replit/codemirror-vim"),
    ]);
    const editor = EditorView.findFromDOM(content()!)!;
    editor.focus();
    const cm = getCM(editor)!;
    for (const key of "36GVjgc") Vim.handleKey(cm, key, "user");
    await until(() => visible("[data-file-comment-box] textarea"));
    await type(
      visible("[data-file-comment-box] textarea") as HTMLTextAreaElement,
      "Accept miles too, as under:8mi, and convert them to km here.",
      0,
    );
  },
  // A name's definition, as the pointer or K shows it, in another file.
  async hover() {
    await review({ sidebar: false, session: false }, "Review");
    dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", code: "KeyK", metaKey: true, shiftKey: true }),
    );
    await until(() => visible("input[aria-label='Find file']"));
    const find = visible("input[aria-label='Find file']") as HTMLInputElement;
    await type(find, "search/index.ts", 0);
    await until(() =>
      all<HTMLElement>("[role='option']").some((node) => node.textContent?.includes("index.ts")),
    );
    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const content = () => visible("section[aria-label='File editor'] .cm-content");
    await until(content);
    const [{ EditorView }, { Vim, getCM }] = await Promise.all([
      import("@codemirror/view"),
      import("@replit/codemirror-vim"),
    ]);
    const editor = EditorView.findFromDOM(content()!)!;
    editor.focus();
    const cm = getCM(editor)!;
    for (const key of "14Gfp") Vim.handleKey(cm, key, "user");
    await until(() => editor.state.doc.lineAt(editor.state.selection.main.head).number === 14);
    Vim.handleKey(cm, "K", "user");
    await until(() => visible("[data-symbol-hover]"));
  },
  // All comments, from the header: the diff's comment, with the file's
  // resolved one on request.
  async comments() {
    await review({ sidebar: false, session: true }, "Review");
    await allFiles();
    await until(() => visible("button[aria-label='All comments']"));
    visible("button[aria-label='All comments']")!.click();
    await until(() => visible("ul[aria-label='Comments'] li"));
    (visible("button[aria-label='Show resolved']") as HTMLButtonElement | undefined)?.click();
  },
  // A name's definition in the diff, as the pointer rests on it.
  async "diff-hover"() {
    await review({ sidebar: false, session: false }, "Review");
    await allFiles();
    localStorage.setItem("med:mode", "unified");
    dispatchEvent(new StorageEvent("storage", { key: "med:mode" }));
    const token = () => {
      for (const host of all<HTMLElement>("diffs-container"))
        for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>("[data-char]") ?? [])
          if (node.textContent === "parseQuery" && node.checkVisibility()) return node;
      return undefined;
    };
    await until(token);
    token()!.scrollIntoView({ block: "center" });
    await pause(200);
    const box = token()!.getBoundingClientRect();
    token()!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        pointerType: "mouse",
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    await until(() => visible("[data-symbol-hover]"));
  },
  // The Superagent's thread, on top of the sidebar.
  async superagent() {
    await review({ sidebar: true, session: true }, "Review");
    await until(() =>
      all<HTMLButtonElement>("nav[aria-label='Sessions'] button").some((node) =>
        node.textContent?.includes("Superagent"),
      ),
    );
  },
  // Open pull requests that wait on you, and yours.
  async pulls() {
    await review({ sidebar: true, session: true }, "Review");
    const button = () =>
      all<HTMLButtonElement>("nav[aria-label='Sessions'] button").find(
        (node) => node.textContent === "Pull requests",
      );
    await until(button);
    button()!.click();
    await until(() => visible("[role='listbox'][aria-label='Pull requests'] [role='option']"));
  },
  // A note in the vault, as it reads.
  async notes() {
    // The file tree renders in its own shadow root. A click selects the
    // note; a double click keeps it open.
    const note = () =>
      document
        .querySelector("file-tree-container")
        ?.shadowRoot?.querySelector<HTMLElement>("[data-item-path='Search filters.md']");
    await until(note);
    note()?.click();
    note()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true }));
    await until(() => visible("section[aria-label='Markdown preview'] .med-md-block"));
  },
};
await scenes[scene]?.();

// A feature's scene shows one part of Med, which fills the window over the
// rest of the app; the app still runs underneath. While the part is gone, as
// when the visitor opens something else, the whole app shows.
const parts: Record<string, () => HTMLElement | undefined> = {
  brief: () => visible("section[aria-label='Guide overview']"),
  comment: () => scroller(visible("diffs-container") ?? null) as HTMLElement | undefined,
  replies: () => scroller(visible("diffs-container") ?? null) as HTMLElement | undefined,
  session: () => visible(session),
  // A phone has room for the files to stage, without their diffs.
  commit: () =>
    innerWidth < 600
      ? (visible("[aria-label='Changed files']")?.parentElement ?? undefined)
      : visible("[role='tabpanel'][aria-label='Commit']"),
  notes: () => visible("#vault-file-panel"),
  files: () => visible("section[aria-label='Full file']"),
  hover: () => visible("section[aria-label='Full file']"),
};
// The Screens page shows the whole window (`?full`).
const find = params.has("full") ? undefined : parts[scene];
if (find) {
  const fill = document.createElement("style");
  fill.textContent = `
    [data-demo-part] {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483000 !important;
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      transform: none !important;
      overflow: hidden !important;
      background: var(--demo-canvas) !important;
    }
    [data-demo-part="session"] > header {
      display: none !important;
    }
    /* A pane contains its layout, which would hold the part inside it. */
    :has([data-demo-part]) {
      contain: none !important;
    }
    /* Dialogs, such as the commit message, open over the part. */
    body > :has([role="dialog"]) {
      position: relative;
      z-index: 2147483001;
    }`;
  document.head.append(fill);
  const canvas = () =>
    document.documentElement.style.setProperty(
      "--demo-canvas",
      themeController.getSnapshot().active.palette.canvas,
    );
  canvas();
  themeController.subscribe(canvas);
  let part: HTMLElement | undefined;
  const keep = () => {
    if (part?.isConnected && part.checkVisibility()) return;
    part?.removeAttribute("data-demo-part");
    part = find();
    part?.setAttribute("data-demo-part", scene);
  };
  keep();
  new MutationObserver(keep).observe(document.body, { childList: true, subtree: true });
  // The comment sits near the foot of its window, under the lines it is about.
  if ((scene === "comment" || scene === "replies") && part) {
    await pause(200);
    const card = visible("[data-comment-card]");
    if (card) part.scrollTop += card.getBoundingClientRect().bottom - (innerHeight - 64);
  }
}
await pause(400);
// A control that a scene clicked keeps its focus, and its tooltip, otherwise.
if (scene !== "review") (document.activeElement as HTMLElement | null)?.blur();
document.documentElement.dataset.demo = "ready";
if (parent !== window) parent.postMessage({ type: "med-demo", state: "ready" }, "*");

// Once in view, some scenes play: the review sends its comment to the agent,
// and the commit stages, commits, and pushes.
const plays: Record<string, () => Promise<void>> = {
  async review() {
    const message = recording.entries.find(
      (entry) => entry.method === "POST" && entry.url.endsWith("/agent/messages"),
    );
    if (!message?.body) return;
    await pause(900);
    const field = visible(`${session} textarea`) as HTMLTextAreaElement | undefined;
    const { text } = JSON.parse(message.body) as { text: string };
    if (field && text) await type(field, text, 45);
    await pause(400);
    start();
    visible(`${session} button[aria-label='Send']`)?.click();
    // When the agent answers, the reviewer opens the edit that it cites.
    const cited = () =>
      all<HTMLAnchorElement>(`${session} a`).findLast(
        (link) => link.textContent === "SearchBar.tsx:28-34",
      );
    await until(cited);
    await pause(1200);
    cited()?.click();
  },
  // Slow enough to follow: each file, the message, the commit, the push.
  async commit() {
    await pause(1200);
    for (let step = 0; step < 20 && marks("stage").length; step += 1) {
      marks("stage")[0]!.click();
      await pause(800);
    }
    await pause(900);
    all<HTMLButtonElement>("button")
      .find((button) => button.textContent?.includes("Commit…") && !button.disabled)
      ?.click();
    await until(() => visible("input[aria-label='Commit summary']"));
    // The recorded draft fills the fields; the scene writes it out again.
    const summary = visible("input[aria-label='Commit summary']") as HTMLInputElement;
    const body = visible("textarea[aria-label='Commit description']") as HTMLTextAreaElement;
    const [title, text] = [summary.value, body.value];
    await type(body, "", 0);
    await type(summary, "", 0);
    if (title) await type(summary, title, 28);
    await pause(300);
    body.focus();
    if (text) await type(body, text, 18);
    await pause(1100);
    all<HTMLButtonElement>("[role='dialog'] button")
      .find((button) => /^Commit\b/.test(button.textContent ?? "") && !button.disabled)
      ?.click();
    await until(() => document.body.textContent?.includes("Committed"));
    await pause(2400);
    visible("button[title^='Push to']")?.click();
  },
};
const play = plays[scene];
if (play) void inView.then(play);
