import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  reviewKeySchema,
  savedReviewCreateSchema,
  savedReviewSchema,
  threadCheckout,
  type AgentSession,
  type PartShape,
  type SavedReviewCreate,
} from "../shared/saved-review";
import { baseOf, type RegisteredRepository } from "../shared/protocol";
import { resolveParts } from "./review-parts";
import { apiErrorMessage } from "../shared/protocol";
import { checkGuide, guideCheckText } from "../shared/guide-paths";
import { guideError, reviewGuideSchema, type ReviewGuide } from "../shared/review-guide";
import { agentSessions } from "./agent-sessions";
import {
  DEFAULT_PORT,
  findPort,
  getStateDirectory,
  readConnection,
  type RunningConnection,
} from "../host/runtime/connection";

import { pullRequestTitle, reviewMetadata } from "./review-metadata";
import {
  comparisonEmpty,
  emptyMessage,
  git,
  headBranch,
  keyFromBranch,
  rangeFacts,
  repositoryRoot,
  requireRegistered,
  sessionScope,
  shellWord,
  titleProblem,
  usualBase,
} from "./review-checks";

export const reviewManifestSchema = savedReviewCreateSchema.strict();
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;

export const reviewHelp = `Usage: med-diff review create --title <title> --repo <path> --base <ref> --head <ref>
       med-diff review create --title <title> --repo <path> --working --paths <path>...
       med-diff review create --title <title> --repo <path> --working
       med-diff review create --manifest <json-path>
       med-diff review create --stack <pr|branch>... [--base <ref>] [--repo <path>] [--title <title>]
       med-diff review create --set <pr|branch>... [--base <ref>] [--repo <path>] [--title <title>]
       med-diff review update --key <key> [--pr <https-url>] [--title <title>] [--guide <path|->] [--session <agent:id>] [--paths <path>...]
       med-diff review wait --key <key>
       med-diff review repos

--key <key> names your task, such as its branch. Create with the same key again to add a version to that review: its workspace stays, earlier briefs and comments stay, and the new comparison and brief become current. Without --key, create uses the branch's name when the branch is not the repository's base branch. update also takes the review's ID (r_…) as --key.
update sets the title or the PR link of the review with that key, such as after you open the PR. With --paths, it adds a version that shows those files' uncommitted changes.
--paths <path>... keeps only these files or folders, relative to this directory. In a checkout that other sessions or people also change, such as a shared main checkout, show only your own files with --paths. med thread show --paths <path>... does the same for your session's thread.
--working shows the checkout's uncommitted changes: with --paths, only those files; without it, all of them, including changes that were there before you started.
wait waits until the user sends a message to your session from the review, prints it, and exits. Run it in the background; it has no time limit.
A Claude Code session that runs the command is recorded with the review, so Med can copy its resume command; --session codex:<id> or claude:<id> adds others, and --no-session records none.
In a session that Med started, MED_PORT and MED_STATE_DIR choose its host, and in a thread MED_THREAD_KEY and MED_THREAD_REPO give the default --key and --repo, so "create --working --guide -" hands off the thread's worktree to its Review. Med sends the user's messages to such a session itself, so wait exits at once.

--title names the review in the workspace list and the browser tab. Use 2–4 words, such as "Commit tab search". Without it, use the matching PR title or a comparison label. Once the review has a PR, its header shows the PR title, read with gh.
--pr <https-url> adds a clickable GitHub PR link. A matching PR is inferred for a single GitHub origin repository when gh is available; --no-pr skips lookup.
--merge-base compares the common ancestor of --base and --head with --head (for pull requests and stacked branches). When --base has commits that --head does not have, create uses the merge base by itself and says so; --no-merge-base compares the two tips.
--brief <path|-> attaches a Markdown explanation; - reads standard input. Links such as [App.tsx:42](src/App.tsx:42) open the cited lines.
--guide <path|-> attaches a JSON guide: a summary and segments to review one at a time, each with a title, a summary, its files, and your comments on lines. See med docs agents.
--generated <path|glob>... marks files that a tool wrote, such as a client from a code generator, with create or update --paths. Med folds them with lockfiles and build output, after the other files and out of the line totals. Name files, folders (ending in /), or globs, as a guide does; quote globs. A file that Git attributes unmark (-linguist-generated) stays unmarked.
Open Med windows add each new review to their workspaces, marked unread. --open also shows it in the window used last, or opens a browser when no window is open.
Options: --port <port> (default ${DEFAULT_PORT}), --state-dir <path> (or MED_STATE_DIR)
The running host must already have the target repositories registered.
--stack <pr|branch>... makes one thread of related changes, bottom first: each pull request (a number or URL) or branch is a layer, and each layer's diff starts at the layer below. A pull request is its own diff, read with gh; a missing head is fetched, never checked out. --base names the bottom branch's base (default: the repository's base branch). --set makes a thread of independent parts, each since its own base. --guide then takes a JSON array with one guide, or null, for each part. A later create with the same --key, or with --stack and the same parts, adds a version; create --key <a part's PR URL or branch> replaces that part only.
--group <name> --attempt <1-3> marks the review as one attempt at a task that several agents do, each in its own worktree. Med shows a group's attempts together and compares them.
A manifest is {"title":"Review title","targets":[{"repo":"/absolute/path","comparison":{"kind":"range","base":"<ref>","head":"<ref>"}}]}. --manifest - reads it from standard input.
The create command prints a Markdown review link without an access token.`;

/**
 * Takes `--paths a b c` (and `--paths=a`) out of the arguments: the words
 * after it, up to the next option. Undefined when it is not there.
 */
export function takePaths(args: readonly string[]) {
  const { args: rest, words: paths } = takeWords(args, "--paths");
  if (paths && !paths.length) throw new Error("Name one or more files or folders after --paths.");
  return { args: rest, paths };
}

/** Takes `option a b c` (and `option=a`) out of the arguments: the words
 * after it, up to the next option. Undefined when it is not there. */
export function takeWords(args: readonly string[], option: string) {
  const rest: string[] = [];
  let words: string[] | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith(`${option}=`)) {
      (words ??= []).push(arg.slice(option.length + 1));
      continue;
    }
    if (arg !== option) {
      rest.push(arg);
      continue;
    }
    words ??= [];
    // "#12" names a pull request; other words that start with - are options.
    while (index + 1 < args.length && !/^-/.test(args[index + 1]!)) words.push(args[++index]!);
  }
  return { args: rest, words: words?.filter(Boolean) };
}

/** Paths from this directory (or absolute), as paths in the checkout `repo`. */
export function repoPaths(repo: string, paths: readonly string[], cwd = process.cwd()) {
  const roots = [resolve(repo)];
  try {
    roots.push(realpathSync(repo));
  } catch {
    /* The host checks the checkout. */
  }
  const inside = (path: string, root: string) => {
    const rel = relative(root, path);
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
      ? rel.split(sep).join("/")
      : undefined;
  };
  return [
    ...new Set(
      paths.map((value) => {
        const path = resolve(cwd, value);
        let real = path;
        try {
          real = join(realpathSync(dirname(path)), basename(path));
        } catch {
          /* A folder that is gone keeps its path. */
        }
        const rel = roots.flatMap((root) => inside(path, root) ?? inside(real, root) ?? [])[0];
        if (!rel) throw new Error(`${value} is not a file or folder in ${repo}.`);
        return rel;
      }),
    ),
  ];
}

export interface ReviewCommand {
  kind: "help" | "repos" | "create" | "update" | "wait";
  /** For wait: the review's key, and the session that waits. `owned`: Med started this session and sends it messages itself. */
  wait?: { key: string; session?: string; owned?: boolean };
  /** For update: the review's key and its new details. With `paths`, a new
   * version shows those files' uncommitted changes in `repo` (or the
   * thread's checkout). */
  update?: {
    key: string;
    title?: string;
    pullRequestUrl?: string;
    sessions?: AgentSession[];
    guide?: ReviewGuide;
    paths?: string[];
    repo?: string;
    /** With `paths`: files of the new version that a tool wrote. */
    generated?: string[];
  };
  port: number;
  stateDir: string;
  manifest?: ReviewManifest;
  /** create --stack or --set: the items to resolve with gh and Git. */
  parts?: {
    shape: PartShape;
    items: string[];
    repo: string;
    base?: string;
    guides?: (ReviewGuide | null)[];
    /** Files of each part that a tool wrote. */
    generated?: string[];
    manifest: Omit<ReviewManifest, "targets" | "parts" | "title"> & { title?: string };
  };
  keepTitle?: boolean;
  inferPullRequest?: boolean;
  /** Show the review now, not only add it to open windows. */
  open?: boolean;
  /** create with --repo and one comparison: Med may choose the key and the merge base. */
  fromFlags?: boolean;
  /** --no-merge-base: compare the two tips even when the base moved on. */
  noMergeBase?: boolean;
  /** The agent named the review (--title, or a manifest's title). */
  titleGiven?: boolean;
  /** Med started this session in a thread, and sends it the user's messages. */
  owned?: boolean;
}

/** Read and check a guide file, or standard input for "-". */
export async function readGuide(source: string): Promise<ReviewGuide> {
  let text: string;
  try {
    text = source === "-" ? await readStandardInput() : await readFile(resolve(source), "utf8");
  } catch {
    throw new Error(
      "Could not read the guide. Supply a readable JSON file, or - for standard input.",
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The guide is not valid JSON.");
  }
  const parsed = reviewGuideSchema.safeParse(data);
  if (!parsed.success) throw new Error(guideError(parsed.error));
  return parsed.data;
}

/** Read a brief file, or standard input for "-". */
async function readBrief(source: string) {
  try {
    return source === "-" ? await readStandardInput() : await readFile(resolve(source), "utf8");
  } catch {
    throw new Error(
      "Could not read the brief. Supply a readable Markdown file, or - for standard input.",
    );
  }
}

/** A stack's or a set's guides: a JSON array with a guide, or null, for each part. */
export async function readGuides(source: string, count: number) {
  let text: string;
  try {
    text = source === "-" ? await readStandardInput() : await readFile(resolve(source), "utf8");
  } catch {
    throw new Error(
      "Could not read the guides. Supply a readable JSON file, or - for standard input.",
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The guides are not valid JSON.");
  }
  if (!Array.isArray(data) || data.length !== count)
    throw new Error(
      `With --stack or --set, --guide takes a JSON array of ${count} guides, one (or null) for each part, in order.`,
    );
  return data.map((entry, index) => {
    if (entry === null) return null;
    const parsed = reviewGuideSchema.safeParse(entry);
    if (!parsed.success) throw new Error(`Part ${index + 1}: ${guideError(parsed.error)}`);
    return parsed.data;
  });
}

export async function readStandardInput() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseReviewCommand(
  given: string[],
  sessionOptions: { environment?: NodeJS.ProcessEnv; home?: string; cwd?: string } = {},
): Promise<ReviewCommand> {
  const stacked = takeWords(given, "--stack");
  const set = takeWords(stacked.args, "--set");
  const declared = takeWords(set.args, "--generated");
  const { args, paths } = takePaths(declared.args);
  const generated = declared.words;
  if (generated && !generated.length)
    throw new Error("Name one or more files, folders, or globs after --generated.");
  if (stacked.words && set.words) throw new Error("Use --stack or --set, not both.");
  const partItems = stacked.words ?? set.words;
  const shape: PartShape = stacked.words ? "stack" : "set";
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      title: { type: "string" },
      pr: { type: "string" },
      "no-pr": { type: "boolean" },
      repo: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      working: { type: "boolean" },
      "merge-base": { type: "boolean" },
      "no-merge-base": { type: "boolean" },
      manifest: { type: "string" },
      brief: { type: "string" },
      guide: { type: "string" },
      open: { type: "boolean" },
      key: { type: "string" },
      group: { type: "string" },
      attempt: { type: "string" },
      session: { type: "string", multiple: true },
      "no-session": { type: "boolean" },
    },
  });
  const sessions = () =>
    agentSessions(values.session, { ...sessionOptions, detect: !values["no-session"] });
  // A session that Med started for a thread knows the thread from its environment.
  const environment = sessionOptions.environment ?? process.env;
  const owned = environment.MED_SESSION === "owned";
  values.key ??= environment.MED_THREAD_KEY || undefined;
  values["state-dir"] ??= environment.MED_STATE_DIR || undefined;
  values.port ??= environment.MED_PORT || undefined;
  const stateDir = getStateDirectory(values["state-dir"]);
  const port = values.port === undefined ? await findPort(stateDir) : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Review connection port must be between 1 and 65535.");
  const common = { port, stateDir };
  if (values.help) return { ...common, kind: "help" };
  if (positionals.length !== 1 || !["repos", "create", "update", "wait"].includes(positionals[0]!))
    throw new Error(reviewHelp);
  if (paths && positionals[0] !== "create" && positionals[0] !== "update")
    throw new Error("Use --paths with create or update.");
  if (generated && positionals[0] !== "create" && !(positionals[0] === "update" && paths))
    throw new Error("Use --generated with create, or with update --paths.");
  if (positionals[0] === "wait") {
    if (owned) return { ...common, kind: "wait", wait: { key: values.key ?? "", owned } };
    if (!values.key) throw new Error("Use wait with --key, the key the review was created with.");
    const key = reviewKeySchema.safeParse(values.key);
    if (!key.success) throw new Error(key.error.issues[0]!.message);
    const session = (await sessions())[0]?.id;
    return { ...common, kind: "wait", wait: { key: key.data, ...(session ? { session } : {}) } };
  }
  if (positionals[0] === "update") {
    if (!values.key) throw new Error("Use update with --key, the key the review was created with.");
    if (
      !values.pr &&
      !values.title &&
      !values.session?.length &&
      values.guide === undefined &&
      !paths
    )
      throw new Error("Supply --pr, --title, --guide, --session, or --paths.");
    const key = reviewKeySchema.safeParse(values.key);
    if (!key.success) throw new Error(key.error.issues[0]!.message);
    const guide = values.guide === undefined ? undefined : await readGuide(values.guide);
    const found = await sessions();
    const repo = values.repo ?? (environment.MED_THREAD_REPO || undefined);
    return {
      ...common,
      kind: "update",
      update: {
        key: key.data,
        ...(values.title ? { title: values.title } : {}),
        ...(values.pr ? { pullRequestUrl: values.pr } : {}),
        ...(found.length ? { sessions: found } : {}),
        ...(guide ? { guide } : {}),
        // Paths stay relative to this directory until the checkout is known.
        ...(paths && {
          paths: paths.map((path) => resolve(sessionOptions.cwd ?? process.cwd(), path)),
        }),
        ...(paths && repo ? { repo: resolve(repo) } : {}),
        ...(generated && { generated }),
      },
    };
  }
  const targetOptions = [
    values.title,
    values.pr,
    values.repo,
    values.base,
    values.head,
    values.working,
    values["merge-base"],
  ];
  if (positionals[0] === "repos") {
    if (
      values["no-pr"] !== undefined ||
      values.manifest !== undefined ||
      values.brief !== undefined ||
      values.guide !== undefined ||
      values.key !== undefined ||
      targetOptions.some((value) => value !== undefined)
    )
      throw new Error("The repos command accepts only --port and --state-dir.");
    return { ...common, kind: "repos" };
  }
  if (partItems) {
    if (positionals[0] !== "create") throw new Error(`Use --${shape} with create.`);
    if (
      values.manifest !== undefined ||
      values.head !== undefined ||
      values.working ||
      values["merge-base"] ||
      values["no-merge-base"] ||
      values.pr !== undefined ||
      values.group !== undefined ||
      paths
    )
      throw new Error(
        `Use --${shape} without --manifest, --head, --working, --merge-base, --pr, --group, or --paths.`,
      );
    if (partItems.length < 2)
      throw new Error(`Name two or more pull requests or branches after --${shape}.`);
    const repo = await repositoryRoot(
      values.repo ??
        (environment.MED_THREAD_REPO || undefined) ??
        sessionOptions.cwd ??
        process.cwd(),
    );
    let guides: (ReviewGuide | null)[] | undefined;
    if (values.guide !== undefined) {
      if (values.guide === "-" && values.brief === "-")
        throw new Error("Only one of --brief and --guide can read standard input.");
      guides = await readGuides(values.guide, partItems.length);
    }
    let brief: string | undefined;
    if (values.brief !== undefined) brief = await readBrief(values.brief);
    if (values.key !== undefined) {
      const key = reviewKeySchema.safeParse(values.key);
      if (!key.success) throw new Error(`Invalid key: ${key.error.issues[0]!.message}`);
    }
    const found = await sessions();
    return {
      ...common,
      kind: "create",
      parts: {
        shape,
        items: partItems,
        repo: resolve(repo),
        ...(values.base ? { base: values.base } : {}),
        ...(guides ? { guides } : {}),
        ...(generated && { generated }),
        manifest: {
          ...(values.title ? { title: values.title } : {}),
          ...(values.key ? { key: values.key } : {}),
          ...(brief ? { brief } : {}),
          ...(found.length ? { sessions: found } : {}),
        },
      },
      keepTitle: values.title !== undefined,
      inferPullRequest: false,
      open: !!values.open,
    };
  }
  let input: unknown;
  if (values["merge-base"] && values["no-merge-base"])
    throw new Error("Use --merge-base or --no-merge-base, not both.");
  if (values.manifest !== undefined) {
    if (targetOptions.some((value) => value !== undefined) || paths || values["no-merge-base"])
      throw new Error(
        "Use --manifest without --title, --repo, --base, --head, --working, or --paths.",
      );
    if (values.manifest === "-" && (values.guide === "-" || values.brief === "-"))
      throw new Error(
        'Only one of --manifest, --brief, and --guide can read standard input. Put the guide in the manifest as "guide".',
      );
    try {
      input = JSON.parse(
        values.manifest === "-"
          ? await readStandardInput()
          : await readFile(resolve(values.manifest), "utf8"),
      );
    } catch {
      throw new Error(
        "Could not read the review manifest. Supply a readable JSON file, or - for standard input.",
      );
    }
  } else {
    values.repo ??= environment.MED_THREAD_REPO || undefined;
    if (!values.repo) throw new Error("Use --repo, or supply --manifest.");
    // A folder inside the repository names the repository.
    values.repo = await repositoryRoot(values.repo);
    if (values.pr && values["no-pr"]) throw new Error("Use --pr without --no-pr.");
    if (
      values.working &&
      (values.base !== undefined ||
        values.head !== undefined ||
        values["merge-base"] ||
        values["no-merge-base"])
    )
      throw new Error("Use --working without --base, --head, or --merge-base.");
    if (!values.working && (!values.base || !values.head))
      throw new Error(
        "Supply both --base and --head, or use --working to capture current changes.",
      );
    const only = paths && {
      paths: repoPaths(values.repo, paths, sessionOptions.cwd ?? process.cwd()),
    };
    input = {
      title:
        values.title ??
        `${basename(resolve(values.repo))} · ${values.working ? "Working changes" : `${values.base} → ${values.head}`}`.slice(
          0,
          200,
        ),
      ...(values.pr ? { pullRequestUrl: values.pr } : {}),
      targets: [
        {
          repo: values.repo,
          comparison: values.working
            ? { kind: "working", ...only }
            : {
                kind: "range",
                base: values.base,
                head: values.head,
                ...(values["merge-base"] ? { mergeBase: true } : {}),
                ...only,
              },
        },
      ],
    };
  }
  if (values.brief !== undefined)
    input = { ...(input as object), brief: await readBrief(values.brief) };
  if (values.guide !== undefined) {
    if (values.guide === "-" && values.brief === "-")
      throw new Error("Only one of --brief and --guide can read standard input.");
    input = { ...(input as object), guide: await readGuide(values.guide) };
  }
  if (values.key !== undefined) input = { ...(input as object), key: values.key };
  if ((values.group === undefined) !== (values.attempt === undefined))
    throw new Error("Use --group and --attempt together, such as --group week-view --attempt 2.");
  if (values.group !== undefined)
    input = {
      ...(input as object),
      group: { id: values.group, attempt: Number(values.attempt) },
    };
  const found = await sessions();
  if (found.length)
    input = {
      ...(input as object),
      sessions: [...((input as { sessions?: unknown[] }).sessions ?? []), ...found],
    };
  const result = reviewManifestSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues.some((issue) => issue.path[0] === "guide")
        ? guideError(
            new z.ZodError(
              result.error.issues
                .filter((issue) => issue.path[0] === "guide")
                .map((issue) => ({ ...issue, path: issue.path.slice(1) })),
            ),
          )
        : result.error.issues.some((issue) => issue.path[0] === "brief")
          ? `Invalid brief: ${result.error.issues.find((issue) => issue.path[0] === "brief")!.message}`
          : result.error.issues.some((issue) => issue.path[0] === "key")
            ? `Invalid key: ${result.error.issues.find((issue) => issue.path[0] === "key")!.message}`
            : result.error.issues.some((issue) => issue.path[0] === "group")
              ? "Invalid group: use a name of letters, digits, and . _ -, and an attempt from 1 to 3."
              : "Invalid review manifest. Supply a title and 1–16 targets, each with repo and a Git comparison.",
    );
  const manifest = {
    ...result.data,
    targets: await Promise.all(
      result.data.targets.map(async (target) => ({
        ...target,
        repo: await repositoryRoot(target.repo),
        ...(generated && { generated: [...(target.generated ?? []), ...generated] }),
      })),
    ),
  };
  return {
    ...common,
    kind: "create",
    manifest,
    keepTitle: values.title !== undefined || values.manifest !== undefined,
    inferPullRequest: !values["no-pr"],
    open: !!values.open,
    fromFlags: values.manifest === undefined,
    noMergeBase: !!values["no-merge-base"],
    titleGiven: values.title !== undefined || values.manifest !== undefined,
    owned,
  };
}

export async function request(
  connection: RunningConnection,
  path: string,
  fetcher: typeof fetch,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${connection.origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(35_000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      `Could not connect to med at ${connection.origin}. Start med-diff with your repositories and retry.`,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = apiErrorMessage(data);
    const detail = message
      ? message.replaceAll(connection.token, "[credential]")
      : `HTTP ${response.status}`;
    throw new Error(`Med request failed: ${detail}`);
  }
  return data;
}

export async function runReviewCommand(
  args: string[],
  options: {
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    openUrl?: (url: string) => void;
    /** Where agent sessions are found: the environment and home directory. */
    environment?: NodeJS.ProcessEnv;
    home?: string;
    /** How long wait pauses before it retries a lost connection. */
    retryDelay?: number;
    /** Where the checks' advice goes: standard error by default. */
    warn?: (text: string) => void;
  } = {},
): Promise<void> {
  const command = await parseReviewCommand(args, options);
  const print = options.print ?? console.log;
  const warn = options.warn ?? console.error;
  if (command.kind === "help") {
    print(reviewHelp);
    return;
  }
  if (command.kind === "wait" && command.wait?.owned) {
    print(
      "Med started this session and sends the user's messages to it as new turns, so there is nothing to wait for. Do not run med review wait in this session.",
    );
    return;
  }
  const connection = await readConnection(command.stateDir, command.port);
  const fetcher = options.fetcher ?? fetch;
  if (command.kind === "wait") {
    await waitForMessage(command, connection, fetcher, print, options.retryDelay);
    return;
  }
  if (command.kind === "update") {
    const { key, guide, paths, repo, generated, ...details } = command.update!;
    const title = details.pullRequestUrl && (await pullRequestTitle(details.pullRequestUrl));
    const found = await reviewByKey(connection, key, fetcher);
    // A guide for code that changed after the capture describes code that the
    // review does not show: the fix belongs in a new version.
    const stale =
      guide && !paths ? await staleCapture(connection, found.id, key, fetcher) : undefined;
    if (details.title || details.pullRequestUrl || details.sessions?.length)
      await request(connection, `/api/reviews/${found.id}/details`, fetcher, {
        ...details,
        ...(title ? { pullRequestTitle: title } : {}),
      });
    // --paths: a new version with those files; a guide goes with it.
    if (paths) {
      const checkout = repo ?? (await reviewCheckout(connection, found.id, fetcher));
      await addVersion(connection, found.id, fetcher, {
        targets: [
          {
            repo: checkout,
            comparison: { kind: "working", paths: repoPaths(checkout, paths) },
            ...(generated && { generated }),
          },
        ],
        ...(guide ? { guide } : {}),
      });
    } else if (guide)
      // In a stack or a set, the key names the part that the guide is for.
      await request(connection, `/api/reviews/${found.id}/guide`, fetcher, { guide, part: key });
    await showReview(connection, found.id, false, fetcher, options.openUrl, true);
    print(`[Review changes here](${connection.origin}/review/${found.id})`);
    if (guide) await printGuideCheck(connection, found.id, guide, key, fetcher, print);
    if (stale) warn(stale);
    return;
  }
  const repositories = await request(connection, "/api/repositories", fetcher);
  if (command.kind === "repos") {
    print(JSON.stringify(repositories, null, 2));
    return;
  }
  await requireRegistered(
    command.parts ? [command.parts.repo] : command.manifest!.targets.map((target) => target.repo),
    repositories,
  );
  const notes: string[] = [];
  let defaultKey: string | undefined;
  if (command.manifest) {
    const prepared = await prepareTargets(command, repositories, options);
    notes.push(...prepared.notes);
    defaultKey = prepared.key;
  }
  const manifest = command.parts
    ? await partsManifest(command.parts, repositories)
    : await reviewMetadata(command.manifest!, !!command.keepTitle, !!command.inferPullRequest);
  const result = await request(connection, "/api/reviews", fetcher, manifest);
  const parsed = z
    .object({
      id: z.string().regex(/^[A-Za-z0-9_-]+$/),
      title: z.string().optional(),
      iterations: z.array(z.object({ number: z.number() })).optional(),
      joined: z.object({ layer: z.number(), of: z.number() }).optional(),
    })
    .safeParse(result);
  if (!parsed.success) throw new Error("Med returned an invalid review ID.");
  const iteration = parsed.data.iterations?.at(-1)?.number ?? 1;
  const joined = parsed.data.joined;
  await showReview(
    connection,
    parsed.data.id,
    !!command.open,
    fetcher,
    options.openUrl,
    iteration > 1 || !!joined,
  );
  print(`[Review changes here](${connection.origin}/review/${parsed.data.id})`);
  if (joined)
    print(
      `Added layer ${joined.layer} of ${joined.of} to the stack "${parsed.data.title ?? ""}": its base is the head of the layer below. Ungroup it in Med to make it a thread of its own.`,
    );
  else if (iteration > 1) print(`Added iteration ${iteration} to the review with this key.`);
  if (manifest.parts)
    print(
      `${manifest.parts.items.length} ${manifest.parts.shape === "stack" ? "layers, bottom first" : "parts"}: ${manifest.parts.items.map((part) => part.title).join(" · ")}`,
    );
  if (manifest.guide)
    await printGuideCheck(connection, parsed.data.id, manifest.guide, manifest.key, fetcher, print);
  const key = manifest.key;
  const update = (option: string) =>
    `med review update --key ${shellWord(key ?? parsed.data.id)} ${option}`;
  for (const note of notes) warn(note);
  if (defaultKey)
    warn(
      `Key: ${defaultKey}, from the branch. Hand off each later round of this task with the same key: med review create --key ${shellWord(defaultKey)} …`,
    );
  if (!manifest.parts) {
    const repos = manifest.targets.map((target) => target.repo);
    const problem = command.titleGiven
      ? titleProblem(manifest.title, repos)
      : manifest.pullRequestTitle
        ? undefined
        : "is not set";
    if (problem)
      warn(
        `Title check: the title ${problem}. Use 2–4 words that name what the task builds, without the repository's name or words such as "review" and "changes": ${update('--title "<2-4 words>"')}`,
      );
    const scope = await sharedCheckout(connection, parsed.data.id, manifest, fetcher, options.home);
    if (scope)
      warn(
        `Shared checkout: ${listed(scope.others)} changed, but this session did not edit ${scope.others.length === 1 ? "it" : "them"}. If ${scope.others.length === 1 ? "it is" : "they are"} not part of your task, hand off only your files: ${update(`--paths ${scope.own.map(shellWord).join(" ")}`)}`,
      );
  }
  // A Claude Code session outside a Med thread gets the user's comments by waiting.
  const environment = options.environment ?? process.env;
  if (key && !command.owned && environment.CLAUDE_CODE_SESSION_ID)
    warn(
      `To get the user's comments, run this as a background command: med review wait --key ${shellWord(key)}. Its output is the user's message.`,
    );
}

/** Up to 8 paths, for a line of advice. */
const listed = (paths: readonly string[], limit = 8) =>
  paths.length > limit
    ? `${paths.slice(0, limit).join(", ")}, and ${paths.length - limit} more`
    : paths.join(", ");

/** A review by its key, or by its ID (r_…) when no review has that key. */
async function reviewByKey(connection: RunningConnection, key: string, fetcher: typeof fetch) {
  const shape = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) });
  try {
    return shape.parse(await request(connection, "/api/reviews/by-key", fetcher, { key }));
  } catch (error) {
    if (!/^r_[a-z0-9]+$/.test(key)) throw error;
    return shape.parse(await request(connection, `/api/reviews/${key}`, fetcher)).id === key
      ? { id: key }
      : Promise.reject(error);
  }
}

/**
 * Checks a single hand-off before Med captures it: an empty comparison is
 * refused; a base that moved on uses the merge base; a branch gives the key.
 * Returns the advice to print after the link.
 */
async function prepareTargets(
  command: ReviewCommand,
  repositories: unknown,
  options: { environment?: NodeJS.ProcessEnv; home?: string },
) {
  const manifest = command.manifest!;
  const notes: string[] = [];
  const environment = options.environment ?? process.env;
  const running = environment.CLAUDE_CODE_SESSION_ID;
  const session = running ? { agent: "claude" as const, id: running } : undefined;
  const empty: string[] = [];
  for (const target of manifest.targets) {
    const comparison = target.comparison;
    if (comparison.kind === "range" && !comparison.mergeBase) {
      const facts = await rangeFacts(target.repo, comparison.base, comparison.head);
      if (facts?.baseAhead && facts.mergeBase) {
        const ahead = `${comparison.base} has ${facts.baseAhead} ${facts.baseAhead === 1 ? "commit" : "commits"} that ${comparison.head} does not have`;
        if (command.fromFlags && !command.noMergeBase) {
          comparison.mergeBase = true;
          notes.push(
            `Merge base: ${ahead}, so Med compared ${comparison.head} with their merge base, as a pull request does. Add --no-merge-base to compare the two tips.`,
          );
        } else if (!command.noMergeBase)
          notes.push(
            `Merge base: in ${target.repo}, ${ahead}, so the review shows them as removed. For a branch, set "mergeBase": true in the manifest and create the review again with the same key.`,
          );
      }
    }
    const nothing = await comparisonEmpty(target.repo, comparison);
    if (nothing)
      empty.push(
        await emptyMessage(
          target.repo,
          comparison as Parameters<typeof emptyMessage>[1],
          session,
          options.home,
        ),
      );
  }
  if (empty.length && empty.length === manifest.targets.length) throw new Error(empty.join("\n"));
  for (const message of empty) notes.push(`${message} Leave this repository out of the review.`);
  let key: string | undefined;
  if (command.fromFlags && !manifest.key && !command.owned) {
    const target = manifest.targets[0]!;
    const branch = keyFromBranch(await headBranch(target.repo, target.comparison));
    const listing = z
      .object({
        repositories: z.array(
          z.object({
            path: z.string(),
            worktrees: z.array(
              z.object({
                path: z.string(),
                branch: z.string().optional(),
                linked: z.boolean().optional(),
              }),
            ),
          }),
        ),
      })
      .safeParse(repositories);
    const family = listing.data?.repositories.find(
      (entry) =>
        entry.path === target.repo || entry.worktrees.some((tree) => tree.path === target.repo),
    );
    // The repository's base branch: the main checkout's branch (for a linked
    // worktree), the remote's default, or a usual name.
    const remote = (
      await git(target.repo, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD")
    )?.replace(/^origin\//, "");
    const bases = new Set(
      [
        family?.path !== target.repo
          ? baseOf(family as Pick<RegisteredRepository, "path" | "worktrees"> | undefined)
          : undefined,
        remote,
        "main",
        "master",
        "trunk",
        "develop",
      ].filter(Boolean),
    );
    if (branch && !bases.has(branch)) {
      manifest.key = branch;
      key = branch;
    }
  }
  return { notes, key };
}

/**
 * The changed files of a working hand-off without --paths that this
 * session's transcript never edited: other work in a shared checkout.
 */
async function sharedCheckout(
  connection: RunningConnection,
  id: string,
  manifest: ReviewManifest,
  fetcher: typeof fetch,
  home?: string,
) {
  const target = manifest.targets[0];
  const found = manifest.sessions?.find((entry) => entry.agent !== "acp");
  const session = found && { agent: found.agent as "claude" | "codex", id: found.id };
  if (
    manifest.targets.length !== 1 ||
    !target ||
    target.comparison.kind !== "working" ||
    target.comparison.paths ||
    !session
  )
    return undefined;
  try {
    const files = await currentFiles(connection, id, fetcher);
    const scope = await sessionScope(
      session,
      target.repo,
      files.flatMap((entry) => entry.files.map((file) => file.path)),
      home,
    );
    return scope?.others.length && scope.own.length ? scope : undefined;
  } catch {
    return undefined;
  }
}

/** The changed files of each comparison in the review's current version. */
async function currentFiles(connection: RunningConnection, id: string, fetcher: typeof fetch) {
  const saved = z
    .object({
      targets: z.array(z.object({ id: z.string(), repo: z.string() })),
      iterations: z.array(z.object({ targetIds: z.array(z.string()) })).optional(),
    })
    .parse(await request(connection, `/api/reviews/${id}`, fetcher));
  const current = saved.iterations?.findLast((entry) => entry.targetIds.length)?.targetIds;
  const targets = current
    ? saved.targets.filter((target) => current.includes(target.id))
    : saved.targets;
  const fileList = z.object({
    files: z.array(
      z.object({
        path: z.string(),
        previousPath: z.string().optional(),
        generated: z.unknown().optional(),
      }),
    ),
  });
  return Promise.all(
    targets.map(async (target) => ({
      root: target.repo,
      files: fileList.parse(
        await request(
          connection,
          `/api/reviews/${id}/targets/${encodeURIComponent(target.id)}/review`,
          fetcher,
        ),
      ).files,
    })),
  );
}

/**
 * Whether the checkout moved past the capture of the review's current
 * version: what `update --guide` would describe is then not what Med shows.
 * Returns the advice, with the command that makes the next version.
 */
async function staleCapture(
  connection: RunningConnection,
  id: string,
  key: string,
  fetcher: typeof fetch,
) {
  try {
    const saved = savedReviewSchema.parse(await request(connection, `/api/reviews/${id}`, fetcher));
    const version = saved.iterations?.findLast((entry) => entry.targetIds.length);
    const targets = saved.targets.filter((target) =>
      version ? version.targetIds.includes(target.id) : !target.commentReviewId,
    );
    if (!targets.length || saved.parts) return undefined;
    const changed: string[] = [];
    for (const target of targets) {
      if (target.captured) {
        const drift = z
          .object({ changed: z.boolean() })
          .parse(
            await request(
              connection,
              `/api/reviews/${id}/targets/${encodeURIComponent(target.id)}/drift`,
              fetcher,
            ),
          );
        if (drift.changed) changed.push(target.repo);
      } else if (target.comparison.kind === "range") {
        const head = target.names?.head ?? target.names?.on?.branch;
        const now = head && (await git(target.repo, "rev-parse", "--verify", "--quiet", head));
        const dirty = await git(target.repo, "status", "--porcelain", "--untracked-files=no");
        if ((now && now !== target.head) || dirty) changed.push(target.repo);
      }
    }
    if (!changed.length) return undefined;
    const number = version?.number ?? 1;
    const target = targets[0]!;
    const comparison =
      targets.length > 1
        ? "--manifest <file>"
        : target.comparison.kind === "working"
          ? `--repo ${shellWord(target.repo)} --working${target.comparison.paths?.length ? ` --paths ${target.comparison.paths.map(shellWord).join(" ")}` : ""}`
          : `--repo ${shellWord(target.repo)} --base ${target.base.slice(0, 12)} --head HEAD`;
    return `Stale capture: the checkout changed after version ${number} was captured, so this guide now goes with code that the review does not show. To hand off your fixes, make version ${number + 1} with the same key: med review create --key ${shellWord(key)} ${comparison} --guide <file>`;
  } catch {
    return undefined;
  }
}

/** The manifest of `create --stack` or `--set`: each item read with gh or Git. */
async function partsManifest(
  wanted: NonNullable<ReviewCommand["parts"]>,
  repositories: unknown,
): Promise<SavedReviewCreate> {
  const known = z
    .object({
      repositories: z.array(
        z.object({
          path: z.string(),
          worktrees: z.array(
            z.object({
              path: z.string(),
              branch: z.string().optional(),
              linked: z.boolean().optional(),
            }),
          ),
        }),
      ),
    })
    .safeParse(repositories);
  const family = known.data?.repositories.find(
    (entry) =>
      entry.path === wanted.repo || entry.worktrees.some((tree) => tree.path === wanted.repo),
  );
  let base =
    wanted.base ?? baseOf(family as Pick<RegisteredRepository, "path" | "worktrees"> | undefined);
  // The main checkout can be on a branch of the stack, which is then no base.
  if (!wanted.base && (!base || wanted.items.includes(base)))
    base = (await usualBase(wanted.repo, wanted.items)) ?? base ?? "main";
  const { targets, parts } = await resolveParts(wanted.repo, wanted.shape, wanted.items, base!);
  // A part without changes cannot be reviewed: its base is wrong.
  for (const [index, target] of targets.entries())
    if (await comparisonEmpty(target.repo, target.comparison))
      throw new Error(
        `Part ${index + 1} (${parts[index]!.title ?? wanted.items[index]}) has no changes since ${parts[index]!.base ?? base}, so there is nothing to review. Name the bottom branch's base with --base <branch>, such as --base main.`,
      );
  const items = parts.map((part, index) => {
    const guide = wanted.guides?.[index];
    return guide ? { ...part, guide } : part;
  });
  const bottom = items[0]!.title;
  return {
    ...wanted.manifest,
    title: (
      wanted.manifest.title ??
      `${bottom} · ${items.length} ${wanted.shape === "stack" ? "layers" : "parts"}`
    ).slice(0, 200),
    targets: wanted.generated
      ? targets.map((target) => ({ ...target, generated: wanted.generated }))
      : targets,
    parts: { shape: wanted.shape, items },
  };
}

/** The checkout that a thread works in. */
export async function reviewCheckout(
  connection: RunningConnection,
  id: string,
  fetcher: typeof fetch,
) {
  const saved = savedReviewSchema.parse(await request(connection, `/api/reviews/${id}`, fetcher));
  const checkout = threadCheckout(saved)?.repo;
  if (!checkout) throw new Error("The thread names no checkout. Supply --repo <path>.");
  return checkout;
}

/** Adds a Review version to a thread: what its agent shows now. */
export async function addVersion(
  connection: RunningConnection,
  id: string,
  fetcher: typeof fetch,
  body: Omit<ReviewManifest, "title">,
) {
  return z
    .object({
      id: z.string(),
      title: z.string(),
      iterations: z.array(z.object({ number: z.number() })).optional(),
    })
    .parse(await request(connection, `/api/reviews/${id}/versions`, fetcher, body));
}

/**
 * Check a guide against the comparisons of the review's current iteration and
 * print what it leaves out, so the agent can fix it. A check that cannot run
 * stays silent: the review exists either way.
 */
export async function printGuideCheck(
  connection: RunningConnection,
  id: string,
  guide: ReviewGuide,
  key: string | undefined,
  fetcher: typeof fetch,
  print: (text: string) => void,
) {
  try {
    const comparisons = await currentFiles(connection, id, fetcher);
    const text = guideCheckText(
      checkGuide(guide, comparisons),
      key
        ? `med review update --key ${JSON.stringify(key)} --guide <file>`
        : "med review create again with the same options and the fixed --guide",
    );
    if (text) print(text);
  } catch {
    // The check is advice; the review was saved.
  }
}

/**
 * Waits for the user's next message to this session: a series of long polls,
 * so it has no time limit. A lost connection, such as a Med restart, is
 * retried for about five minutes.
 */
async function waitForMessage(
  command: ReviewCommand,
  first: RunningConnection,
  fetcher: typeof fetch,
  print: (text: string) => void,
  retryDelay = 5_000,
) {
  const { key, session } = command.wait!;
  let connection = first;
  let id: string | undefined;
  let failures = 0;
  for (;;) {
    try {
      id ??= z
        .object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) })
        .parse(await request(connection, "/api/reviews/by-key", fetcher, { key })).id;
      const result = z
        .object({
          message: z.string().nullable(),
          ids: z.array(z.string()).optional(),
          superseded: z.boolean().optional(),
        })
        .parse(
          await request(connection, `/api/reviews/${id}/agent/wait`, fetcher, {
            ...(session ? { session } : {}),
            confirm: true,
          }),
        );
      failures = 0;
      if (result.message) {
        print(result.message);
        // Med gives a message that nobody confirms to the next wait.
        if (result.ids?.length)
          await request(connection, `/api/reviews/${id}/agent/ack`, fetcher, {
            ids: result.ids,
          }).catch(() => {});
        return;
      }
      if (result.superseded) {
        print("Another `med review wait` for this session now waits. This one stops.");
        return;
      }
    } catch (error) {
      const lost = error instanceof Error && error.message.startsWith("Could not connect");
      if (!lost || ++failures > Math.ceil(300_000 / retryDelay)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      connection = await readConnection(command.stateDir, command.port).catch(() => connection);
    }
  }
}

/**
 * Tells open Med windows about a saved review. Each adds it to its workspaces,
 * marked unread; with `open`, the window used last shows it. With `open` and
 * no window listening, the review opens in the browser instead.
 */
export async function showReview(
  connection: RunningConnection,
  id: string,
  open: boolean,
  fetcher: typeof fetch,
  openUrl: (url: string) => void = openBrowser,
  updated = false,
) {
  // An older server has no window channel; the link still works.
  const windows = await request(connection, "/api/windows/review", fetcher, { id, open, updated })
    .then((data) => z.object({ windows: z.number() }).parse(data).windows)
    .catch(() => 0);
  if (open && !windows) openUrl(`${connection.origin}/review/${id}#token=${connection.token}`);
}

export function openBrowser(url: string) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const child = spawn(opener, [url], { stdio: "ignore", detached: true });
  child.once("error", () => console.error("Could not open a browser. Use the review URL below."));
  child.unref();
}
