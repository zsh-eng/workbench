import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  FOUND_DAYS,
  sessionAdoptedSchema,
  sessionEntrySchema,
  type SessionEntry,
} from "../shared/found-sessions";
import { findPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import { request, showReview } from "./review";

// `med thread find` and `med thread adopt`: an agent finds a Claude Code or
// Codex session of any age and makes it a Med thread. The thread list finds
// only the sessions of the last FOUND_DAYS days by itself.

export const threadSessionsHelp = `Usage: med thread find [<words>] [--limit <n>] [--json]
       med thread adopt <session> [--repo <path>] [--title <title>] [--open] [--json]

find lists the Claude Code and Codex sessions on this computer, of any age,
newest first: those whose title, first prompt, folder, or ID has each word.
Each line has the session, the time of its last change, its folder, and its
title, with tabs between them. A session that a Med thread holds ends with the
thread's ID. --limit sets the number of lines (default 20). --json prints all
the details.

adopt makes a session a Med thread, as Keep in Med does: the thread captures
the working changes of the session's checkout and shows the session. <session>
is a session ID or its first 6 or more characters, claude:<id> or codex:<id>, a
found thread's ID, or the path of a transcript. It prints the thread's ID and
link. For a session that a thread holds, it gives that thread. --repo chooses
the checkout when the session's folder is not in a registered repository or no
longer exists. --title names the thread. --open shows it.

The thread list shows the sessions of the last ${FOUND_DAYS} days by itself.
Options: --port <port>, --state-dir <path> (or MED_STATE_DIR)`;

const sessionsSchema = z.object({ sessions: z.array(sessionEntrySchema) });

/** A folder with ~ for the home directory, for a short line. */
const shortPath = (path: string, home: string) =>
  path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

/** The local date and time, to the minute. */
const shortTime = (iso: string) => {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};

/** One session on one line: the fields have tabs between them. */
export function sessionLine(session: SessionEntry, home = homedir()) {
  return [
    `${session.agent}:${session.id}`,
    shortTime(session.updatedAt),
    session.cwd ? shortPath(session.cwd, home) : "-",
    session.title.replace(/\s+/g, " "),
    ...(session.thread ? [session.thread.id] : []),
  ].join("\t");
}

/** A transcript path is relative to this command's folder. */
const sessionArgument = (value: string) =>
  value.includes("/") || value.endsWith(".jsonl") ? resolve(value) : value;

export async function runThreadSessionsCommand(
  args: string[],
  options: {
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    openUrl?: (url: string) => void;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const print = options.print ?? console.log;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      limit: { type: "string" },
      repo: { type: "string" },
      title: { type: "string" },
      open: { type: "boolean" },
      port: { type: "string" },
      "state-dir": { type: "string" },
    },
  });
  const [action, ...rest] = positionals;
  if (values.help || !action) return print(threadSessionsHelp);
  if (action !== "find" && action !== "adopt") throw new Error(threadSessionsHelp);
  if (action === "adopt" && rest.length !== 1)
    throw new Error("Use med thread adopt <session-id | transcript path>.");
  if (action === "find" && (values.repo || values.title || values.open))
    throw new Error("find accepts only words, --limit, --json, --port, and --state-dir.");
  const limit = values.limit === undefined ? 20 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Use a --limit from 1 to 500.");

  const environment = options.environment ?? process.env;
  const stateDir = getStateDirectory(
    values["state-dir"] ?? (environment.MED_STATE_DIR || undefined),
  );
  const portValue = values.port ?? (environment.MED_PORT || undefined);
  const port = portValue === undefined ? await findPort(stateDir) : Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  const connection = await readConnection(stateDir, port);
  const fetcher = options.fetcher ?? fetch;
  const find = async (body: object) =>
    sessionsSchema.parse(await request(connection, "/api/sessions/find", fetcher, body)).sessions;

  if (action === "find") {
    const text = rest.join(" ");
    const sessions = await find({ text, limit });
    if (values.json) return print(JSON.stringify(sessions, null, 2));
    if (!sessions.length)
      return print(
        text
          ? `No Claude Code or Codex session matches "${text}".`
          : "Found no Claude Code or Codex sessions.",
      );
    for (const session of sessions) print(sessionLine(session));
    return;
  }

  const session = sessionArgument(rest[0]!);
  // Name the session first, so that a miss or a choice reads well.
  const matches = await find({ session, limit: 10 });
  if (!matches.length)
    throw new Error(
      `No Claude Code or Codex session matches "${rest[0]}". Run med thread find <words> to list sessions.`,
    );
  if (matches.length > 1)
    throw new Error(
      `"${rest[0]}" names more than one session. Run med thread adopt again with one of these:\n${matches
        .map((match) => sessionLine(match))
        .join("\n")}`,
    );
  const adopted = sessionAdoptedSchema.parse(
    await request(connection, "/api/sessions/adopt", fetcher, {
      session,
      ...(values.repo ? { repo: resolve(values.repo) } : {}),
      ...(values.title ? { title: values.title } : {}),
    }),
  );
  await showReview(
    connection,
    adopted.id,
    !!values.open,
    fetcher,
    options.openUrl,
    !adopted.created,
  );
  const url = `${connection.origin}/review/${adopted.id}`;
  if (values.json) return print(JSON.stringify({ ...adopted, url }, null, 2));
  print(
    `Thread ${adopted.id}: [${adopted.title.replace(/[[\]]/g, "")}](${url})${adopted.created ? "" : " (already in Med)"}`,
  );
}
