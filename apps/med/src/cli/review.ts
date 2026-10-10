import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  reviewKeySchema,
  savedReviewCreateSchema,
  type AgentSession,
} from "../shared/saved-review";
import { apiErrorMessage } from "../shared/protocol";
import { agentSessions } from "./agent-sessions";
import {
  DEFAULT_PORT,
  getStateDirectory,
  readConnection,
  type RunningConnection,
} from "../host/runtime/connection";

import { pullRequestTitle, reviewMetadata } from "./review-metadata";

export const reviewManifestSchema = savedReviewCreateSchema.strict();
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;

export const reviewHelp = `Usage: med-diff review create --title <title> --repo <path> --base <ref> --head <ref>
       med-diff review create --title <title> --repo <path> --working
       med-diff review create --manifest <json-path>
       med-diff review update --key <key> [--pr <https-url>] [--title <title>] [--session <agent:id>]
       med-diff review wait --key <key>
       med-diff review repos

--key <key> names your task, such as its branch. Create with the same key again to add an iteration to that review: its workspace stays, earlier briefs and comments stay, and the new comparison and brief become current.
update sets the title or the PR link of the review with that key, such as after you open the PR.
wait waits until the user sends a message to your session from the review, prints it, and exits. Run it in the background; it has no time limit.
A Claude Code session that runs the command is recorded with the review, so Med can copy its resume command; --session codex:<id> or claude:<id> adds others, and --no-session records none.

--title names the review in the workspace list and the browser tab. Use 2–4 words, such as "Commit tab search". Without it, use the matching PR title or a comparison label. Once the review has a PR, its header shows the PR title, read with gh.
--pr <https-url> adds a clickable GitHub PR link. A matching PR is inferred for a single GitHub origin repository when gh is available; --no-pr skips lookup.
--merge-base compares the common ancestor of --base and --head with --head (for pull requests and stacked branches).
--brief <path|-> attaches a Markdown explanation; - reads standard input. Links such as [App.tsx:42](src/App.tsx:42) open the cited lines.
Open Med windows add each new review to their workspaces, marked unread. --open also shows it in the window used last, or opens a browser when no window is open.
Options: --port <port> (default ${DEFAULT_PORT}), --state-dir <path> (or MED_STATE_DIR)
The running host must already have the target repositories registered.
--working captures the current changes, including pre-existing changes.
A manifest is {"title":"Review title","targets":[{"repo":"/absolute/path","comparison":{"kind":"range","base":"<ref>","head":"<ref>"}}]}.
The create command prints a Markdown review link without an access token.`;

export interface ReviewCommand {
  kind: "help" | "repos" | "create" | "update" | "wait";
  /** For wait: the review's key, and the session that waits. */
  wait?: { key: string; session?: string };
  /** For update: the review's key and its new details. */
  update?: { key: string; title?: string; pullRequestUrl?: string; sessions?: AgentSession[] };
  port: number;
  stateDir: string;
  manifest?: ReviewManifest;
  keepTitle?: boolean;
  inferPullRequest?: boolean;
  /** Show the review now, not only add it to open windows. */
  open?: boolean;
}

async function readStandardInput() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseReviewCommand(
  args: string[],
  sessionOptions: { environment?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<ReviewCommand> {
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
      manifest: { type: "string" },
      brief: { type: "string" },
      open: { type: "boolean" },
      key: { type: "string" },
      session: { type: "string", multiple: true },
      "no-session": { type: "boolean" },
    },
  });
  const sessions = () =>
    agentSessions(values.session, { ...sessionOptions, detect: !values["no-session"] });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Review connection port must be between 1 and 65535.");
  const common = { port, stateDir: getStateDirectory(values["state-dir"]) };
  if (values.help) return { ...common, kind: "help" };
  if (positionals.length !== 1 || !["repos", "create", "update", "wait"].includes(positionals[0]!))
    throw new Error(reviewHelp);
  if (positionals[0] === "wait") {
    if (!values.key) throw new Error("Use wait with --key, the key the review was created with.");
    const key = reviewKeySchema.safeParse(values.key);
    if (!key.success) throw new Error(key.error.issues[0]!.message);
    const session = (await sessions())[0]?.id;
    return { ...common, kind: "wait", wait: { key: key.data, ...(session ? { session } : {}) } };
  }
  if (positionals[0] === "update") {
    if (!values.key) throw new Error("Use update with --key, the key the review was created with.");
    if (!values.pr && !values.title && !values.session?.length)
      throw new Error("Supply --pr, --title, or --session.");
    const key = reviewKeySchema.safeParse(values.key);
    if (!key.success) throw new Error(key.error.issues[0]!.message);
    const found = await sessions();
    return {
      ...common,
      kind: "update",
      update: {
        key: key.data,
        ...(values.title ? { title: values.title } : {}),
        ...(values.pr ? { pullRequestUrl: values.pr } : {}),
        ...(found.length ? { sessions: found } : {}),
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
      values.key !== undefined ||
      targetOptions.some((value) => value !== undefined)
    )
      throw new Error("The repos command accepts only --port and --state-dir.");
    return { ...common, kind: "repos" };
  }
  let input: unknown;
  if (values.manifest !== undefined) {
    if (targetOptions.some((value) => value !== undefined))
      throw new Error("Use --manifest without --title, --repo, --base, --head, or --working.");
    try {
      input = JSON.parse(await readFile(resolve(values.manifest), "utf8"));
    } catch {
      throw new Error("Could not read the review manifest. Supply a readable JSON file.");
    }
  } else {
    if (!values.repo) throw new Error("Use --repo, or supply --manifest.");
    if (values.pr && values["no-pr"]) throw new Error("Use --pr without --no-pr.");
    if (
      values.working &&
      (values.base !== undefined || values.head !== undefined || values["merge-base"])
    )
      throw new Error("Use --working without --base, --head, or --merge-base.");
    if (!values.working && (!values.base || !values.head))
      throw new Error(
        "Supply both --base and --head, or use --working to capture current changes.",
      );
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
            ? { kind: "working" }
            : {
                kind: "range",
                base: values.base,
                head: values.head,
                ...(values["merge-base"] ? { mergeBase: true } : {}),
              },
        },
      ],
    };
  }
  if (values.brief !== undefined) {
    let brief: string;
    try {
      brief =
        values.brief === "-"
          ? await readStandardInput()
          : await readFile(resolve(values.brief), "utf8");
    } catch {
      throw new Error(
        "Could not read the brief. Supply a readable Markdown file, or - for standard input.",
      );
    }
    input = { ...(input as object), brief };
  }
  if (values.key !== undefined) input = { ...(input as object), key: values.key };
  const found = await sessions();
  if (found.length)
    input = {
      ...(input as object),
      sessions: [...((input as { sessions?: unknown[] }).sessions ?? []), ...found],
    };
  const result = reviewManifestSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues.some((issue) => issue.path[0] === "brief")
        ? `Invalid brief: ${result.error.issues.find((issue) => issue.path[0] === "brief")!.message}`
        : result.error.issues.some((issue) => issue.path[0] === "key")
          ? `Invalid key: ${result.error.issues.find((issue) => issue.path[0] === "key")!.message}`
          : "Invalid review manifest. Supply a title and 1–16 targets, each with repo and a Git comparison.",
    );
  const manifest = {
    ...result.data,
    targets: result.data.targets.map((target) => ({ ...target, repo: resolve(target.repo) })),
  };
  return {
    ...common,
    kind: "create",
    manifest,
    keepTitle: values.title !== undefined || values.manifest !== undefined,
    inferPullRequest: !values["no-pr"],
    open: !!values.open,
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
  } = {},
): Promise<void> {
  const command = await parseReviewCommand(args, options);
  const print = options.print ?? console.log;
  if (command.kind === "help") {
    print(reviewHelp);
    return;
  }
  const connection = await readConnection(command.stateDir, command.port);
  const fetcher = options.fetcher ?? fetch;
  if (command.kind === "wait") {
    await waitForMessage(command, connection, fetcher, print, options.retryDelay);
    return;
  }
  if (command.kind === "update") {
    const { key, ...details } = command.update!;
    const title = details.pullRequestUrl && (await pullRequestTitle(details.pullRequestUrl));
    const found = z
      .object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) })
      .parse(await request(connection, "/api/reviews/by-key", fetcher, { key }));
    await request(connection, `/api/reviews/${found.id}/details`, fetcher, {
      ...details,
      ...(title ? { pullRequestTitle: title } : {}),
    });
    await showReview(connection, found.id, false, fetcher, options.openUrl, true);
    print(`[Review changes here](${connection.origin}/review/${found.id})`);
    return;
  }
  const repositories = await request(connection, "/api/repositories", fetcher);
  if (command.kind === "repos") {
    print(JSON.stringify(repositories, null, 2));
    return;
  }
  const manifest = await reviewMetadata(
    command.manifest!,
    !!command.keepTitle,
    !!command.inferPullRequest,
  );
  const result = await request(connection, "/api/reviews", fetcher, manifest);
  const parsed = z
    .object({
      id: z.string().regex(/^[A-Za-z0-9_-]+$/),
      iterations: z.array(z.object({ number: z.number() })).optional(),
    })
    .safeParse(result);
  if (!parsed.success) throw new Error("Med returned an invalid review ID.");
  const iteration = parsed.data.iterations?.at(-1)?.number ?? 1;
  await showReview(
    connection,
    parsed.data.id,
    !!command.open,
    fetcher,
    options.openUrl,
    iteration > 1,
  );
  print(`[Review changes here](${connection.origin}/review/${parsed.data.id})`);
  if (iteration > 1) print(`Added iteration ${iteration} to the review with this key.`);
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
        .object({ message: z.string().nullable(), superseded: z.boolean().optional() })
        .parse(
          await request(connection, `/api/reviews/${id}/agent/wait`, fetcher, {
            ...(session ? { session } : {}),
          }),
        );
      failures = 0;
      if (result.message) {
        print(result.message);
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
