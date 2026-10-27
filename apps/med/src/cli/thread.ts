import { parseArgs } from "node:util";
import { z } from "zod";
import { clientPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import { medCommand } from "../host/runtime/med-command";
import { reviewKeySchema } from "../shared/saved-review";
import {
  threadHistorySchema,
  threadIdSchema,
  threadListSchema,
  type Thread,
} from "../shared/threads";
import { request } from "./review";
import { runThreadSessionsCommand } from "./thread-sessions";

export const threadHelp = `Usage: med thread list [--history] [--json]
       med thread open <id> | --key <key>
       med thread close <id> | --key <key> [--remove-worktree]
       med thread reopen
       med thread delete <id> | --key <key>
       med thread find [<words>] [--limit <n>] [--json]
       med thread adopt <session> [--repo <path>] [--title <title>] [--open] [--json]
       med thread show --paths <path>... | --base <ref> | --commit <ref> | --working | --manifest <path>

A thread is one task: an agent's session and its changes. Threads that the
user opened are tabs: they show in Med's sidebar and stay loaded. The others
are history, which Med does not watch.

list         prints the tabs in the sidebar's order, one per line: the ID, the
             state (working, needs-you, or idle), the repository and branch,
             and the title. --history prints history instead, newest first.
             --json prints the threads as JSON.
open         opens a thread from history as a tab.
close        sends a tab to history. Its agent keeps working; Med stops
             watching it. --remove-worktree also removes the linked worktree
             that Med made for it, if Git can do that without --force.
reopen       opens the thread that closed last.
delete       deletes a thread: its saved review, comments, and history entry.
             Its agent sessions stay in Claude Code and Codex.
find, adopt  find a Claude Code or Codex session of any age and make it a
             thread, which opens as a tab. med thread find --help tells more.
show         adds a version to the Review of your session's thread: what you
             want the user to read. med thread show --help tells more.

--key names a thread by the key of its review, such as MED_THREAD_KEY in a
thread that Med started.
Options: --port <port>, --state-dir <path> (or MED_STATE_DIR)`;

const actions = ["list", "open", "close", "reopen", "delete"] as const;

export interface ThreadCommand {
  kind: "help" | (typeof actions)[number];
  id?: string;
  key?: string;
  history?: boolean;
  json?: boolean;
  removeWorktree?: boolean;
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
      key: { type: "string" },
      history: { type: "boolean" },
      json: { type: "boolean" },
      "remove-worktree": { type: "boolean" },
    },
  });
  values["state-dir"] ??= environment.MED_STATE_DIR || undefined;
  const stateDir = getStateDirectory(values["state-dir"]);
  const port = await clientPort(stateDir, values.port, environment);
  const [action, id, ...rest] = positionals;
  if (values.help || !action) return { kind: "help", port, stateDir };
  if (!actions.includes(action as (typeof actions)[number]) || rest.length)
    throw new Error(threadHelp);
  const kind = action as (typeof actions)[number];
  const command: ThreadCommand = { kind, port, stateDir };
  if (kind === "list") {
    if (id) throw new Error("Use list without an ID.");
    return { ...command, history: !!values.history, json: !!values.json };
  }
  if (kind === "reopen") {
    if (id || values.key) throw new Error("Use reopen without an ID.");
    return command;
  }
  if (!!id === !!values.key)
    throw new Error(`Name the thread by its ID or by --key.\n\n${threadHelp}`);
  if (id) {
    const parsed = threadIdSchema.safeParse(id);
    if (!parsed.success)
      throw new Error(
        `"${id}" is not a thread ID. ${medCommand({ port, stateDir }, "thread list")} prints them.`,
      );
    command.id = parsed.data;
  } else {
    const key = reviewKeySchema.safeParse(values.key);
    if (!key.success) throw new Error(key.error.issues[0]!.message);
    command.key = key.data;
  }
  if (values["remove-worktree"]) {
    if (kind !== "close") throw new Error("Use --remove-worktree with close.");
    command.removeWorktree = true;
  }
  return command;
}

/** A thread's state as one word, as the sidebar shows it. */
function stateOf(thread: Thread) {
  const answered = !!thread.replied && thread.replied.at > (thread.turn?.endedAt ?? 0);
  if (thread.state === "waiting" || (thread.turn?.asks && !answered)) return "needs-you";
  if (thread.state === "working") return "working";
  return thread.open === false ? "closed" : "idle";
}

function line(thread: Thread) {
  const place = [thread.repository?.name, thread.branch].filter(Boolean).join("/");
  return [thread.id, stateOf(thread), place || "-", thread.title].join("\t");
}

export async function runThreadCommand(
  args: string[],
  options: {
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    environment?: NodeJS.ProcessEnv;
    openUrl?: (url: string) => void;
    /** The directory that relative paths start from (`show --paths`). */
    cwd?: string;
  } = {},
): Promise<void> {
  if (args[0] === "find" || args[0] === "adopt" || args[0] === "show")
    return runThreadSessionsCommand(args, options);
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
    if (command.json) print(JSON.stringify(threads, null, 2));
    else if (!threads.length) print(command.history ? "History is empty." : "No tabs are open.");
    else print(threads.map(line).join("\n"));
    return;
  }
  if (command.kind === "reopen") {
    const { thread } = z
      .object({ thread: z.object({ id: z.string(), title: z.string() }) })
      .parse(await call("/api/threads/reopen", {}));
    print(`Opened "${thread.title}" (${thread.id}).`);
    return;
  }
  const id =
    command.id ??
    z.object({ id: threadIdSchema }).parse(await call("/api/reviews/by-key", { key: command.key }))
      .id;
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
    print(closed ? `Closed ${id}; it is in history.` : `${id} was not open.`);
  } else {
    await call(`/api/threads/${id}/delete`, {});
    print(`Deleted ${id}.`);
  }
}
