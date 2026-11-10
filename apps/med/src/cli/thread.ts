import { parseArgs } from "node:util";
import { z } from "zod";
import { clientPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import { medCommand } from "../host/runtime/med-command";
import { reviewKeySchema } from "../shared/saved-review";
import {
  THREAD_WAITS,
  threadAttention,
  threadHistorySchema,
  threadIdSchema,
  threadListSchema,
  threadNextListSchema,
  waitOver,
  waitState,
  type Thread,
  type ThreadWait,
  type WaitState,
} from "../shared/threads";
import { request } from "./review";
import { runThreadSessionsCommand } from "./thread-sessions";
import { NotFoundError, UsageError } from "./exit-status";

export const threadHelp = `Usage: med thread list [--archived] [--json]
       med thread open <id> | --key <key>
       med thread close <id> | --key <key> [--remove-worktree]
       med thread reopen
       med thread delete <id> | --key <key>
       med thread send <id> | --key <key> [--after-turn] <message>
       med thread wait [<id>... | --key <key>...] [--until needs-you|done|idle] [--timeout <seconds>] [--json]
       med thread find [<words>] [--limit <n>] [--json]
       med thread adopt <session> [--title <title>] [--open] [--json]

A thread is an agent's session, with the reviews that it handed off; a review
that no session handed off is a thread of its own. Threads that the user
opened are tabs: they show in Med's sidebar and stay loaded. The others
are archived, and Med does not watch them.

list         prints the tabs in the sidebar's order, one per line: the ID, the
             state, the repository and branch, and the title. The states, as
             ⌘0 ranks them: needs-you (a permission request, a question, or
             work that stopped), done (its work finished since the user last
             looked at it), working, and idle. --archived prints the archived
             threads instead, newest first; their state is closed. --json
             prints the threads as JSON, each with its state as "attention".
open         opens an archived thread as a tab.
close        archives a tab. Its agent keeps working; Med stops
             watching it. --remove-worktree also removes the linked worktree
             that Med made for it, if Git can do that without --force.
reopen       opens the thread that closed last.
delete       deletes a thread: its reviews, their comments, and its archive
             entry. Its agent session stays in Claude Code or Codex.
send         sends a message to the thread's agent, which Med runs. While the
             agent works, the message joins its turn at its next step;
             --after-turn waits until the turn ends. From another thread that
             Med started, such as the Superagent, the message says so: the
             agent reads it as a report from that thread, not as the user's.
wait         waits until a thread's agent stops: it comes to need the user, or
             its work finishes. Name the threads by ID or --key; without them,
             it waits on every tab but your own thread. --until needs-you or
             --until done waits for only that; --until idle waits until none
             of them works. A message that Med sent counts as work until the
             turn that reads it ends, so send, then wait. It ends at once when
             none of them works, and prints each thread's state as list does.
             --timeout <seconds> (default 100, within a shell tool's two
             minutes) ends the wait as a check-in: it says so, prints the
             states, and exits 0, so wait again to go on waiting.
find, adopt  find a Claude Code or Codex session of any age and make it a
             thread, which opens as a tab. med thread find --help tells more.
             To show the user your changes, hand them off with med review
             create: the review joins your session's thread.

--key names a thread by the key of its review, such as MED_THREAD_KEY in a
thread that Med started.
Options: --port <port>, --state-dir <path> (or MED_STATE_DIR)
Exit status: 0 when the command did its work, and when a wait ends or times
out (its first line says which); 2 for wrong usage; 3 when a thread that you
name does not exist or is not a tab; 4 when no Med server runs; else 1.`;

const actions = ["list", "open", "close", "reopen", "delete", "send", "wait"] as const;

/** How long `wait` waits by default, in seconds: under the two minutes that
 * Claude Code's shell tool gives a command. */
export const WAIT_SECONDS = 100;

export interface ThreadCommand {
  kind: "help" | (typeof actions)[number];
  id?: string;
  key?: string;
  history?: boolean;
  json?: boolean;
  removeWorktree?: boolean;
  /** send: the message, and whether it waits for the turn's end. */
  message?: string;
  afterTurn?: boolean;
  /** wait: the threads, what it waits for, and for how long, in seconds. */
  ids?: string[];
  keys?: string[];
  until?: ThreadWait;
  timeout?: number;
  port: number;
  stateDir: string;
}

export async function parseThreadCommand(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThreadCommand> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      key: { type: "string", multiple: true },
      archived: { type: "boolean" },
      // The old name of --archived.
      history: { type: "boolean" },
      json: { type: "boolean" },
      "remove-worktree": { type: "boolean" },
      "after-turn": { type: "boolean" },
      until: { type: "string" },
      timeout: { type: "string" },
    },
  });
  values["state-dir"] ??= environment.MED_STATE_DIR || undefined;
  const stateDir = getStateDirectory(values["state-dir"]);
  const port = await clientPort(stateDir, values.port, environment);
  const [action, ...words] = positionals;
  if (values.help || !action) return { kind: "help", port, stateDir };
  if (action === "wait") return parseWait(words, values, { port, stateDir });
  if (values.until !== undefined || values.timeout !== undefined)
    throw new Error("Use --until and --timeout with wait.");
  if ((values.key?.length ?? 0) > 1) throw new Error("Name one thread with --key.");
  const key = values.key?.[0];
  // send's words after the thread are its message.
  const [id, ...rest] = action === "send" && key ? [undefined, ...words] : words;
  if (!actions.includes(action as (typeof actions)[number]) || (rest.length && action !== "send"))
    throw new UsageError(threadHelp);
  const kind = action as (typeof actions)[number];
  const command: ThreadCommand = { kind, port, stateDir };
  if (kind === "list") {
    if (id) throw new Error("Use list without an ID.");
    return { ...command, history: !!(values.archived || values.history), json: !!values.json };
  }
  if (kind === "reopen") {
    if (id || key) throw new Error("Use reopen without an ID.");
    return command;
  }
  if (!!id === !!key) throw new Error(`Name the thread by its ID or by --key.\n\n${threadHelp}`);
  if (id) {
    const parsed = threadIdSchema.safeParse(id);
    if (!parsed.success)
      throw new Error(
        `"${id}" is not a thread ID. ${medCommand({ port, stateDir }, "thread list")} prints them.`,
      );
    command.id = parsed.data;
  } else {
    const parsed = reviewKeySchema.safeParse(key);
    if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
    command.key = parsed.data;
  }
  if (kind === "send") {
    const message = rest.join(" ").trim();
    if (!message) throw new Error(`Write the message after the thread.\n\n${threadHelp}`);
    command.message = message;
    command.afterTurn = !!values["after-turn"];
  } else if (values["after-turn"]) throw new Error("Use --after-turn with send.");
  if (values["remove-worktree"]) {
    if (kind !== "close") throw new Error("Use --remove-worktree with close.");
    command.removeWorktree = true;
  }
  return command;
}

/** `wait`: its threads, by ID or key, what it waits for, and for how long. */
function parseWait(
  ids: string[],
  values: { key?: string[]; until?: string; timeout?: string; json?: boolean } & Record<
    string,
    unknown
  >,
  command: Pick<ThreadCommand, "port" | "stateDir">,
): ThreadCommand {
  for (const option of ["archived", "history", "remove-worktree", "after-turn"])
    if (values[option]) throw new Error(`Use --${option} without wait.`);
  const until = values.until ?? "stopped";
  if (until !== "stopped" && !(THREAD_WAITS as readonly string[]).includes(until))
    throw new UsageError(`--until takes ${THREAD_WAITS.join(", ")}.\n\n${threadHelp}`);
  const timeout = values.timeout === undefined ? WAIT_SECONDS : Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 3600)
    throw new UsageError("--timeout takes seconds, from 0 to 3600.");
  const keys = (values.key ?? []).map((key) => {
    const parsed = reviewKeySchema.safeParse(key);
    if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
    return parsed.data;
  });
  return {
    kind: "wait",
    ...command,
    ids: ids.map((id) => {
      const parsed = threadIdSchema.safeParse(id);
      if (!parsed.success)
        throw new Error(
          `"${id}" is not a thread ID. ${medCommand(command, "thread list")} prints them.`,
        );
      return parsed.data;
    }),
    keys,
    until: until as ThreadWait,
    timeout,
    json: !!values.json,
  };
}

/** A thread's state as one word, as ⌘0 ranks them; closed when archived. */
function stateOf(thread: Thread) {
  return thread.open === false ? "closed" : threadAttention(thread);
}

function line(thread: Thread, state: string = stateOf(thread)) {
  const place = [thread.repository?.name, thread.branch].filter(Boolean).join("/");
  return [thread.id, state, place || "-", thread.title].join("\t");
}

/** A thread's state as a wait reports it: as list does, and working while a
 * message that Med sent waits for its turn to end. */
const waitWord = (thread: Thread | undefined, state: WaitState) =>
  !thread ? "closed" : state === "working" ? "working" : stateOf(thread);

export async function runThreadCommand(
  args: string[],
  options: {
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    environment?: NodeJS.ProcessEnv;
    openUrl?: (url: string) => void;
    /** The directory that relative paths start from (`adopt <path>`). */
    cwd?: string;
  } = {},
): Promise<void> {
  if (args[0] === "show")
    throw new UsageError(
      "med thread show is gone: hand off your changes with med review create, which links the review to your session's thread.",
    );
  if (args[0] === "find" || args[0] === "adopt") return runThreadSessionsCommand(args, options);
  const command = await parseThreadCommand(args, options.environment);
  const print = options.print ?? console.log;
  if (command.kind === "help") {
    print(threadHelp);
    return;
  }
  const connection = await readConnection(command.stateDir, command.port);
  const fetcher = options.fetcher ?? fetch;
  const call = (path: string, body?: unknown) => request(connection, path, fetcher, body);
  if (command.kind === "list") {
    const threads = command.history
      ? threadHistorySchema.parse(await call("/api/threads/history")).threads
      : threadListSchema.parse(await call("/api/threads")).threads;
    if (command.json)
      print(
        JSON.stringify(
          threads.map((thread) => ({ ...thread, attention: stateOf(thread) })),
          null,
          2,
        ),
      );
    else if (!threads.length) print(command.history ? "Nothing is archived." : "No tabs are open.");
    else print(threads.map((thread) => line(thread)).join("\n"));
    return;
  }
  if (command.kind === "reopen") {
    const { thread } = z
      .object({ thread: z.object({ id: z.string(), title: z.string() }) })
      .parse(await call("/api/threads/reopen", {}));
    print(`Opened "${thread.title}" (${thread.id}).`);
    return;
  }
  if (command.kind === "wait") {
    await waitForThreads(command, call, print, options.environment ?? process.env);
    return;
  }
  const id = command.id ?? (await threadByKey(call, command.key!));
  if (command.kind === "open") {
    const { thread } = z
      .object({ thread: z.object({ id: z.string(), title: z.string() }) })
      .parse(await call(`/api/threads/${id}/open`, {}));
    print(`Opened "${thread.title}" as a tab (${thread.id}).`);
  } else if (command.kind === "close") {
    const { closed } = z.object({ closed: z.boolean() }).parse(
      await call(`/api/threads/${id}/close`, {
        ...(command.removeWorktree && { removeWorktree: true }),
      }),
    );
    print(closed ? `Archived ${id}.` : `${id} was not open.`);
  } else if (command.kind === "send") {
    const thread = threadListSchema
      .parse(await call("/api/threads"))
      .threads.find((entry) => entry.id === id);
    if (!thread || thread.kind !== "session")
      throw new Error(
        thread
          ? `"${thread.title}" has no agent session to send to.`
          : `${id} is not an open thread. ${medCommand(command, "thread open", id)} opens it as a tab.`,
      );
    // A message from another thread that Med started names it, and says
    // that an agent sent it, not the user: the agent reads it as a report.
    const from = (options.environment ?? process.env).MED_THREAD_KEY;
    if (from) {
      if ((await threadByKey(call, from).catch(() => undefined)) === id)
        throw new Error("A thread can't send a message to itself.");
    }
    const sender = from === "superagent" ? "the Superagent" : from ? `the thread ${from}` : "";
    const text = sender
      ? `From ${sender} (an agent in Med, not the user):\n\n${command.message}`
      : command.message!;
    const { message } = z
      .object({ message: z.object({ delivery: z.string().optional() }).passthrough() })
      .parse(
        await call(`/api/sessions/${id}/agent/messages`, {
          id: crypto.randomUUID(),
          text,
          noteIds: [],
          ...(command.afterTurn && { afterTurn: true }),
        }),
      );
    print(
      message.delivery === "pending"
        ? `Queued for "${thread.title}" (${id}): it goes ${command.afterTurn ? "when its turn ends" : "at its next step"}.`
        : `Sent to "${thread.title}" (${id}).`,
    );
  } else {
    await call(`/api/threads/${id}/delete`, {});
    print(`Deleted ${id}.`);
  }
}

/** The thread of a review key, such as `MED_THREAD_KEY`. */
async function threadByKey(call: (path: string, body?: unknown) => Promise<unknown>, key: string) {
  return z.object({ thread: z.string() }).parse(await call("/api/threads/by-key", { key })).thread;
}

/**
 * `med thread wait`: reads the tabs from the host each time they change (a
 * long poll on the host's thread feed) until one of the threads comes to need
 * the user or finishes its work, as `--until` says, or until the timeout.
 */
async function waitForThreads(
  command: ThreadCommand,
  call: (path: string, body?: unknown) => Promise<unknown>,
  print: (text: string) => void,
  environment: NodeJS.ProcessEnv,
) {
  const byKey = (key: string) => threadByKey(call, key);
  const named = [...command.ids!, ...(await Promise.all(command.keys!.map(byKey)))];
  // Without names: every tab but the caller's own thread.
  const own = environment.MED_THREAD_KEY
    ? await byKey(environment.MED_THREAD_KEY).catch(() => undefined)
    : undefined;
  const deadline = Date.now() + command.timeout! * 1000;
  let version: string | undefined;
  let ids: string[] | undefined;
  let before: Map<string, WaitState> | undefined;
  for (;;) {
    const next = threadNextListSchema.parse(
      await call("/api/threads/next", {
        ...(version && { version }),
        waitMs: Math.round(Math.min(20_000, Math.max(0, deadline - Date.now()))),
      }),
    );
    version = next.version;
    const threads = new Map(next.list.threads.map((thread) => [thread.id, thread]));
    if (!ids) {
      const missing = named.filter((id) => !threads.has(id));
      if (missing.length)
        throw new NotFoundError(
          `${missing.join(", ")} ${missing.length > 1 ? "are not tabs" : "is not a tab"}. ${medCommand(command, "thread list")} prints the tabs; ${medCommand(command, "thread open", "<id>")} opens an archived one.`,
        );
      ids = named.length
        ? [...new Set(named)]
        : next.list.threads.map((thread) => thread.id).filter((id) => id !== own);
      if (!ids.length) {
        report(command, print, "nothing", [], new Map(), threads);
        return;
      }
    }
    const now = new Map(ids.map((id) => [id, waitState(threads.get(id))]));
    const over = waitOver(command.until!, before, now);
    if (over || Date.now() >= deadline) {
      const reason = !over
        ? "timeout"
        : !before && command.until !== "idle"
          ? "nothing"
          : command.until === "idle"
            ? "idle"
            : [...now].some(([id, state]) => state === "needs-you" && before?.get(id) !== state)
              ? "needs-you"
              : "done";
      report(command, print, reason, ids, now, threads);
      return;
    }
    before = now;
  }
}

/** Why a wait ended, as `--json` says it. */
type WaitEnd = "needs-you" | "done" | "idle" | "nothing" | "timeout";

function report(
  command: ThreadCommand,
  print: (text: string) => void,
  reason: WaitEnd,
  ids: readonly string[],
  states: ReadonlyMap<string, WaitState>,
  threads: ReadonlyMap<string, Thread>,
) {
  const rows = ids.map((id) => {
    const thread = threads.get(id);
    return { id, thread, state: waitWord(thread, states.get(id) ?? "closed") };
  });
  if (command.json) {
    print(
      JSON.stringify(
        {
          ended: reason !== "timeout",
          reason,
          threads: rows.map((row) => ({
            id: row.id,
            state: row.state,
            ...(row.thread && { title: row.thread.title, said: row.thread.turn?.said }),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const working = rows.filter((row) => row.state === "working").length;
  const heading = {
    "needs-you": "A thread needs the user.",
    done: "A thread finished its work.",
    idle: "None of the threads works.",
    nothing: ids.length
      ? "None of the threads works, so there is nothing to wait for."
      : "No other thread is a tab.",
    timeout: `Timed out after ${command.timeout} s, a check-in: ${working} ${working === 1 ? "thread works" : "threads work"}. Wait again to go on.`,
  }[reason];
  print(
    [
      heading,
      ...rows.map((row) =>
        row.thread ? line(row.thread, row.state) : [row.id, "closed", "-", "-"].join("\t"),
      ),
    ].join("\n"),
  );
}
