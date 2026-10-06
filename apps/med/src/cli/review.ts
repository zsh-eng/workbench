import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { savedReviewCreateSchema } from "../shared/saved-review";
import {
  DEFAULT_PORT,
  getStateDirectory,
  readConnection,
  type RunningConnection,
} from "../host/runtime/connection";

import { reviewMetadata } from "./review-metadata";

export const reviewManifestSchema = savedReviewCreateSchema.strict();
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;

export const reviewHelp = `Usage: med-diff review create --title <title> --repo <path> --base <ref> --head <ref>
       med-diff review create --title <title> --repo <path> --working
       med-diff review create --manifest <json-path>
       med-diff review repos

--title sets the review and browser tab title. Without it, use the matching PR title or a comparison label.
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
  kind: "help" | "repos" | "create";
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

export async function parseReviewCommand(args: string[]): Promise<ReviewCommand> {
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
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Review connection port must be between 1 and 65535.");
  const common = { port, stateDir: getStateDirectory(values["state-dir"]) };
  if (values.help) return { ...common, kind: "help" };
  if (positionals.length !== 1 || !["repos", "create"].includes(positionals[0]!))
    throw new Error(reviewHelp);
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
  const result = reviewManifestSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues.some((issue) => issue.path[0] === "brief")
        ? `Invalid brief: ${result.error.issues.find((issue) => issue.path[0] === "brief")!.message}`
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
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(data);
    const detail = parsed.success
      ? parsed.data.error.message.replaceAll(connection.token, "[credential]")
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
  } = {},
): Promise<void> {
  const command = await parseReviewCommand(args);
  const print = options.print ?? console.log;
  if (command.kind === "help") {
    print(reviewHelp);
    return;
  }
  const connection = await readConnection(command.stateDir, command.port);
  const fetcher = options.fetcher ?? fetch;
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
  const parsed = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) }).safeParse(result);
  if (!parsed.success) throw new Error("Med returned an invalid review ID.");
  await showReview(connection, parsed.data.id, !!command.open, fetcher, options.openUrl);
  print(`[Review changes here](${connection.origin}/review/${parsed.data.id})`);
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
) {
  // An older server has no window channel; the link still works.
  const windows = await request(connection, "/api/windows/review", fetcher, { id, open })
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
