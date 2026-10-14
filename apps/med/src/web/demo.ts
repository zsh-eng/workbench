// Med's live demo for the website: the real web app, answered from a
// recording of a real session instead of a server. The website's screenshot
// script records it (apps/med-site/scripts/screenshots/capture.ts).
//
// Reads replay the recorded answers. Event streams send what they recorded
// and stay open. Writes that change comments, pins, messages, or Git state
// change a copy of that state in memory, and Med reads the copy back; other
// writes succeed and change nothing. The clock starts at the time of the
// recording, so relative times read as they did then. The layout is the
// recorded one, and the theme follows the visitor's light or dark setting.
//
// `?scene=` picks the view, one for each window on the website: the review,
// the brief, a comment, the agent's session, the commit, or the notes vault.
// The review plays its recording on a timeline: the reviewer sends a comment,
// and the agent answers it. `?still` keeps a scene at its first moment, for
// screenshots.

import type { AgentInboxState, AgentMessage } from "../shared/agent-inbox";
import type { AgentStatus } from "../shared/agent-status";
import type { Note, NoteMutation, NoteState, RegisteredRepository } from "../shared/protocol";
import type { SavedReview } from "../shared/saved-review";
import type { ThreadList } from "../shared/threads";
import type { WorkingStatus } from "../shared/git-actions";
import { addDrawing, type Drawing } from "./demo-diagrams";

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
  /** Mermaid diagrams as Med drew them, which stand in for Mermaid. */
  diagrams?: Drawing[];
}

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "review";
// The notes vault and the review's timeline have recordings of their own.
const file = scene === "notes" ? "vault.json" : scene === "review" ? "hero.json" : "recording.json";
const recording: Recording = await fetch(new URL(file, document.baseURI)).then((response) =>
  response.json(),
);
for (const drawing of recording.diagrams ?? []) addDrawing(drawing);

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

/** The agent's inbox: the messages sent from Med, and the comments not sent yet. */
function inbox(id: string): AgentInboxState {
  const path = `/api/reviews/${id}/agent`;
  if (kept.has(key("GET", path))) return read<AgentInboxState>(path)!;
  return (
    streamed<AgentInboxState>(`${path}/events`) ??
    read<AgentInboxState>(path) ?? { messages: [], waiting: [], drafts: [] }
  );
}

/** The sidebar's threads: the recorded review is the one thread, with its
 * agent's state at this moment of the recording. */
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
  const thread: ThreadList["threads"][number] = {
    id: saved.id,
    title: saved.title,
    createdAt: saved.createdAt,
    updatedAt: status?.updatedAt ?? Date.parse(saved.createdAt),
    ...(repository && { repository }),
    ...(target && { checkout: target.repo }),
    ...(target?.branch && { branch: target.branch }),
    ...(status && { agent: status.agent, state: status.state }),
    ...(saved.sessions && { sessions: saved.sessions }),
    ...(saved.totals && {
      changes: {
        files: saved.totals.files,
        additions: saved.totals.additions,
        deletions: saved.totals.deletions,
      },
    }),
  };
  return { threads: [thread], repositories };
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
function setInbox(id: string, state: AgentInboxState) {
  keep(`/api/reviews/${id}/agent`, state);
  send(`/api/reviews/${id}/agent/events`, `event: state\ndata: ${JSON.stringify(state)}\n\n`);
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
    const state = inbox(savedId);
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
    setInbox(savedId, { ...state, drafts });
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
const handlers: [method: string, path: RegExp, handler: Handler][] = [
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
      const saved = changeReview(id!, (saved) => {
        saved.commentCount = 0;
        delete saved.briefComments;
      });
      for (const { path, state } of savedNotes(saved))
        keep(path, { ...state, revision: state.revision + 1, notes: [] });
      setInbox(id!, { ...inbox(id!), drafts: [] });
      return saved;
    },
  ],
  [
    "POST",
    /^\/api\/reviews\/([^/]+)\/pins$/,
    (_url, body, [, id]) =>
      changeReview(id!, (saved) => {
        const owner = saved.iterations?.at(-1) ?? saved;
        if ("add" in body)
          owner.pins = [
            ...(owner.pins ?? []),
            {
              id: `p_${hex(12)}`,
              text: body.add.text,
              createdAt: new Date().toISOString(),
              ...(body.add.source ? { source: body.add.source } : {}),
            },
          ];
        else
          for (const entry of [saved, ...(saved.iterations ?? [])])
            entry.pins = entry.pins?.filter((pin) => pin.id !== body.remove);
      }),
  ],
  [
    "POST",
    /^\/api\/reviews\/([^/]+)\/brief-comments$/,
    (_url, body, [, id]) => {
      const now = new Date().toISOString();
      const saved = changeReview(id!, (saved) => {
        const comments = saved.briefComments ?? [];
        if ("add" in body) {
          comments.push({ ...body.add, id: `c_${hex(12)}`, createdAt: now, updatedAt: now });
          saved.commentCount += 1;
        } else if ("edit" in body) {
          const comment = comments.find((item) => item.id === body.edit.id);
          if (comment) Object.assign(comment, { text: body.edit.text, updatedAt: now });
        } else {
          comments.splice(
            comments.findIndex((item) => item.id === body.remove),
            1,
          );
          saved.commentCount -= 1;
        }
        saved.briefComments = comments;
      });
      const state = inbox(id!);
      setInbox(id!, {
        ...state,
        drafts: [
          ...state.drafts.filter((draft) => draft.path !== "Notes"),
          ...(saved.briefComments ?? []).map((comment) => ({
            id: comment.id,
            path: "Notes",
            quote: comment.quote,
            text: comment.text,
            replies: 0,
          })),
        ],
      });
      return saved;
    },
  ],
  [
    "GET",
    /^\/api\/reviews\/([^/]+)\/feedback$/,
    (_url, _body, [, id]) => {
      const saved = read<SavedReview>(`/api/reviews/${id}`);
      if (!saved) throw new DemoError("This review is not in the demo.");
      const comments = [
        ...savedNotes(saved).flatMap(({ state }) =>
          state.notes
            .filter((note) => !note.parentId)
            .map(
              (note) =>
                `File: ${note.path}\nLines: ${note.line}${note.endLine ? `-${note.endLine}` : ""}\n\nComment:\n${note.text}`,
            ),
        ),
        ...(saved.briefComments ?? []).map(
          (comment) =>
            `On: the review's brief\n\nQuote:\n> ${comment.quote}\n\nComment:\n${comment.text}`,
        ),
      ];
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
    /^\/api\/reviews\/([^/]+)\/agent\/messages$/,
    (_url, body, [, id]) => {
      const state = inbox(id!);
      const noteIds: string[] = body.noteIds ?? [];
      const sent = state.drafts.filter((draft) => noteIds.includes(draft.id));
      const saved = read<SavedReview>(`/api/reviews/${id}`);
      const message: AgentMessage = {
        id: crypto.randomUUID(),
        sessionId: body.sessionId,
        agent: saved?.sessions?.find((session) => session.id === body.sessionId)?.agent ?? "claude",
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
      setInbox(id!, next);
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
const theme = () => (dark.matches ? "med-night" : "med-dawn");

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
// Zen mode's first hints name keys that a visitor on the website does not need.
storage.setItem("med:zen-hints", "3");
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
/** Sets a toggle button, such as a pane, to shown or hidden. */
const toggle = (label: string, pressed: boolean) => {
  const button = visible(`button[aria-label='${label}']`);
  if (button && (button.getAttribute("aria-pressed") === "true") !== pressed) button.click();
};
const tab = (name: string) =>
  all<HTMLElement>("[role='tab']")
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
  await until(() => visible("diffs-container"));
  if (!panes.sidebar) visible("button[aria-label='Hide sidebar']")?.click();
  // ⌘⇧B shows the session at any width. A phone shows the chosen pane only:
  // there the session is open without room, so it closes, then opens chosen.
  for (let press = 0; panes.session && press < 2 && !visible(session); press += 1) {
    dispatchEvent(
      new KeyboardEvent("keydown", { key: "B", code: "KeyB", metaKey: true, shiftKey: true }),
    );
    await pause(300);
  }
  if (!panes.session) visible("button[aria-label='Close session']")?.click();
  tab(name);
};
const session = "section[aria-label='Claude session']";
/** The Commit tab's marks that stage or unstage a file. */
const marks = (action: "stage" | "unstage") =>
  all<HTMLElement>(`[aria-label='Changed files'] [title$='click to ${action}']`).filter((node) =>
    node.checkVisibility(),
  );

const scenes: Record<string, () => Promise<void>> = {
  // Med in zen mode: the thread in the sidebar, the agent's session waiting
  // for the review, and the diff with the reviewer's comment on the first file.
  async review() {
    await review({ sidebar: true, session: true }, "Changes");
    if (!visible("[data-zen-exit]"))
      dispatchEvent(new KeyboardEvent("keydown", { key: "Ω", code: "KeyZ", altKey: true }));
    await until(() => visible(`${session} textarea`) && visible("[data-comment-card]"));
    // The first file, with the comment, at the top.
    const stream = scroller(visible("diffs-container") ?? null);
    if (stream) stream.scrollTop = 0;
  },
  // The agent's brief, with its cited diffs.
  async brief() {
    await review({ sidebar: false, session: false }, "Notes");
    await until(() => visible("diffs-container"));
  },
  // A short unified diff with the reviewer's comment.
  async comment() {
    await review({ sidebar: false, session: false }, "Changes");
    visible("[role='group'][aria-label='Diff layout'] button[aria-label='Unified']")?.click();
    await toComment();
  },
  async session() {
    await review({ sidebar: false, session: true }, "Changes");
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
  // A note in the vault beside its preview.
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
    await until(() => visible("button[aria-label='Toggle Markdown preview']"));
    toggle("Toggle Markdown preview", true);
  },
};
await scenes[scene]?.();

// A feature's scene shows one part of Med, which fills the window over the
// rest of the app; the app still runs underneath. While the part is gone, as
// when the visitor opens something else, the whole app shows.
const parts: Record<string, () => HTMLElement | undefined> = {
  brief: () => visible("section[aria-label='Notes']"),
  comment: () => scroller(visible("diffs-container") ?? null) as HTMLElement | undefined,
  session: () => visible(session),
  // A phone has room for the files to stage, without their diffs.
  commit: () =>
    innerWidth < 600
      ? (visible("[aria-label='Changed files']")?.parentElement ?? undefined)
      : visible("[role='tabpanel'][aria-label='Commit']"),
  notes: () => visible("#vault-file-panel"),
};
const find = parts[scene];
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
  if (scene === "comment" && part) {
    await pause(200);
    const card = visible("[data-comment-card]");
    if (card) part.scrollTop += card.getBoundingClientRect().bottom - (innerHeight - 64);
  }
}
await pause(400);
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
