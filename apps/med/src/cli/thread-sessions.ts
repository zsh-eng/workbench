import { readFile } from "node:fs/promises";
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
import {
  findPort,
  getStateDirectory,
  readConnection,
  type RunningConnection,
} from "../host/runtime/connection";
import {
  addVersion,
  printGuideCheck,
  readGuide,
  readStandardInput,
  repoPaths,
  request,
  reviewCheckout,
  reviewManifestSchema,
  showReview,
  takePaths,
  takeWords,
  type ReviewManifest,
} from "./review";

// `med thread find` and `med thread adopt`: an agent finds a Claude Code or
// Codex session of any age and makes it a Med thread. The thread list finds
// only the sessions of the last FOUND_DAYS days by itself.

export const threadSessionsHelp = `Usage: med thread find [<words>] [--limit <n>] [--json]
       med thread adopt <session> [--repo <path>] [--title <title>] [--open] [--json]
       med thread show --paths <path>... [--base <ref>] [--guide <path|->] [--brief <path|->]
       med thread show --base <ref> [--head <ref>] | --commit <ref> | --working | --manifest <json-path>

find lists the Claude Code and Codex sessions on this computer, of any age,
newest first: those whose title, first prompt, folder, or ID has each word.
Each line has the session, the time of its last change, its folder, and its
title, with tabs between them. A session that a Med thread holds ends with the
thread's ID. --limit sets the number of lines (default 20). --json prints all
the details.

adopt makes a session a Med thread, as Keep in Med does. The thread shows the
session and the live Changes of its checkout; it captures nothing. It has a
Review when the agent shows one with med thread show. <session> is a session
ID or its first 6 or more characters, claude:<id> or codex:<id>, a found
thread's ID, or the path of a transcript. It prints the thread's ID and link.
For a session that a thread holds, it gives that thread. --repo chooses the
checkout when the session's folder is not in a registered repository or no
longer exists. --title names the thread. --open shows it.

show adds a version to the Review of your session's thread: what you want the
user to read. Comments go to that version.
  --paths <path>...   these files' uncommitted changes (relative to this
                      directory); with --base, their changes since the branch
                      left <ref>. Use it in a checkout that others also change.
  --base <ref>        the branch's commits since it left <ref>, and its
                      uncommitted changes; with --head, only the commits from
                      that merge base to <head>
  --commit <ref>      one commit
  --working           all uncommitted changes in the checkout, also changes
                      that were there before you started
  --manifest <path>   the targets of a review manifest (see med review --help)
  --guide, --brief    attach a guide or a brief, as med review create does
  --generated <path|glob>...  files that a tool wrote, as med review create
                      --generated marks them
The thread is MED_THREAD_KEY's in a Med thread, or else the thread that holds
this Claude Code session; --key <key> or --session codex:<id> names another.
--repo chooses the checkout (default: the thread's). --open shows the thread.

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

/**
 * `med thread show`: a new Review version of the session's thread, with the
 * files, the range, the commit, or the manifest's targets that the agent
 * names.
 */
async function showInThread(
  connection: RunningConnection,
  fetcher: typeof fetch,
  values: {
    key?: string;
    session?: string;
    repo?: string;
    base?: string;
    head?: string;
    commit?: string;
    working?: boolean;
    manifest?: string;
    guide?: string;
    brief?: string;
    open?: boolean;
    json?: boolean;
  },
  paths: string[] | undefined,
  generated: string[] | undefined,
  context: {
    environment: NodeJS.ProcessEnv;
    print: (text: string) => void;
    cwd: string;
    find(body: object): Promise<SessionEntry[]>;
    openUrl?: (url: string) => void;
  },
) {
  const { environment, print, cwd } = context;
  const kinds = [paths || values.base, values.commit, values.working, values.manifest].filter(
    Boolean,
  );
  if (!kinds.length)
    throw new Error("Say what to show: --paths, --base, --commit, --working, or --manifest.");
  if (kinds.length > 1 || (values.head && !values.base) || (paths && values.head))
    throw new Error(
      "Use one of --paths (with --base), --base (with --head), --commit, --working, or --manifest.",
    );
  if (values.manifest && values.repo) throw new Error("Use --manifest without --repo.");

  // The thread: a Med thread's key, or the thread that holds this session.
  const key = values.key ?? (environment.MED_THREAD_KEY || undefined);
  let id: string;
  if (key) {
    id = z
      .object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) })
      .parse(await request(connection, "/api/reviews/by-key", fetcher, { key })).id;
  } else {
    const named = values.session?.trim() || environment.CLAUDE_CODE_SESSION_ID;
    if (!named)
      throw new Error(
        "Med does not know this session. Run med thread show in a Med thread or a Claude Code session, or name the thread with --key <key> or --session codex:<id>.",
      );
    const [entry] = await context.find({ session: named, limit: 2 });
    if (!entry?.thread)
      throw new Error(
        `No Med thread holds session ${named}. Run med thread adopt ${named} first, then med thread show again.`,
      );
    id = entry.thread.id;
  }

  const repo = values.manifest
    ? undefined
    : values.repo
      ? resolve(cwd, values.repo)
      : await reviewCheckout(connection, id, fetcher);
  let targets: ReviewManifest["targets"];
  if (values.manifest) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(resolve(cwd, values.manifest), "utf8"));
    } catch {
      throw new Error("Could not read the manifest. Supply a readable JSON file.");
    }
    const parsed = reviewManifestSchema.shape.targets.safeParse(
      (manifest as { targets?: unknown } | null)?.targets,
    );
    if (!parsed.success || !parsed.data.length)
      throw new Error("The manifest needs 1–16 targets, each with repo and a Git comparison.");
    targets = parsed.data.map((target) => ({ ...target, repo: resolve(cwd, target.repo) }));
  } else {
    const only = paths && { paths: repoPaths(repo!, paths, cwd) };
    targets = [
      {
        repo: repo!,
        comparison: values.commit
          ? { kind: "commit", commit: values.commit }
          : values.head
            ? { kind: "range", base: values.base!, head: values.head, mergeBase: true }
            : {
                kind: "working",
                ...(values.base ? { base: values.base } : {}),
                ...only,
              },
      },
    ];
  }
  if (values.guide === "-" && values.brief === "-")
    throw new Error("Only one of --brief and --guide can read standard input.");
  const guide = values.guide === undefined ? undefined : await readGuide(values.guide);
  let brief: string | undefined;
  if (values.brief !== undefined)
    try {
      brief =
        values.brief === "-"
          ? await readStandardInput()
          : await readFile(resolve(cwd, values.brief), "utf8");
    } catch {
      throw new Error(
        "Could not read the brief. Supply a readable Markdown file, or - for standard input.",
      );
    }
  const added = await addVersion(connection, id, fetcher, {
    targets: generated
      ? targets.map((target) => ({
          ...target,
          generated: [...(target.generated ?? []), ...generated],
        }))
      : targets,
    ...(guide ? { guide } : {}),
    ...(brief ? { brief } : {}),
  });
  await showReview(connection, id, !!values.open, fetcher, context.openUrl, true);
  const url = `${connection.origin}/review/${id}`;
  const version = added.iterations?.at(-1)?.number ?? 1;
  if (values.json) print(JSON.stringify({ id, title: added.title, version, url }, null, 2));
  else print(`Version ${version} of [${added.title.replace(/[[\]]/g, "")}](${url})`);
  if (guide) await printGuideCheck(connection, id, guide, key, fetcher, print);
}

/** A transcript path is relative to this command's folder. */
const sessionArgument = (value: string) =>
  value.includes("/") || value.endsWith(".jsonl") ? resolve(value) : value;

export async function runThreadSessionsCommand(
  given: string[],
  options: {
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    openUrl?: (url: string) => void;
    environment?: NodeJS.ProcessEnv;
    /** The directory that relative paths start from. */
    cwd?: string;
  } = {},
): Promise<void> {
  const print = options.print ?? console.log;
  const declared = takeWords(given, "--generated");
  const taken = takePaths(declared.args);
  if (declared.words && !declared.words.length)
    throw new Error("Name one or more files, folders, or globs after --generated.");
  const { values, positionals } = parseArgs({
    args: taken.args,
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
      key: { type: "string" },
      session: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      commit: { type: "string" },
      working: { type: "boolean" },
      manifest: { type: "string" },
      guide: { type: "string" },
      brief: { type: "string" },
    },
  });
  const [action, ...rest] = positionals;
  if (values.help || !action) return print(threadSessionsHelp);
  if (action !== "find" && action !== "adopt" && action !== "show")
    throw new Error(threadSessionsHelp);
  const showOptions = [
    taken.paths,
    declared.words,
    values.key,
    values.session,
    values.base,
    values.head,
    values.commit,
    values.working,
    values.manifest,
    values.guide,
    values.brief,
  ];
  if (action !== "show" && showOptions.some((value) => value !== undefined))
    throw new Error(
      `Use --paths, --base, --commit, and the other show options with med thread show.`,
    );
  if (action === "show" && (rest.length || values.title || values.limit))
    throw new Error(
      "Use med thread show with --paths, --base, --commit, --working, or --manifest.",
    );
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

  if (action === "show")
    return showInThread(connection, fetcher, values, taken.paths, declared.words, {
      environment,
      print,
      cwd: options.cwd ?? process.cwd(),
      find,
      ...(options.openUrl ? { openUrl: options.openUrl } : {}),
    });

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
