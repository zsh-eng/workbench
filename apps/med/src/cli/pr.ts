import { execFile, spawn } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { MAX_PROMPT_IMAGE_BYTES } from "../shared/agent-inbox";
import {
  clientPort,
  getStateDirectory,
  givenPort,
  readConnection,
  servicePort,
} from "../host/runtime/connection";
import { imageHrefs, MAX_PR_DRAFT_IMAGES, type PrDraftInput } from "../host/pr-drafts";
import {
  pullRequestUrlSchema,
  savedReviewSchema,
  type SavedReviewCreate,
} from "../shared/saved-review";
import { openBrowser, readStandardInput, request, showReview } from "./review";
import { remoteFor } from "./review-parts";

const exec = promisify(execFile);

export const pullRequestHelp = `Usage: med pr checkout <number|url|branch> [gh options] [--port <port>] [--state-dir <dir>] [--no-open]
       med pr template [--repo <path>]
       med pr draft --key <key> --file <path|-> [--title <title>] [--base <branch>] [--repo <path>]

checkout checks out a GitHub pull request with gh, then opens its review in
Med: the changes from the merge base with the pull request's base branch to
its head. Run it inside the repository. gh must be installed and signed in.
Other options pass through to gh pr checkout, for example --force, --detach,
--branch <name>, or --repo <owner/repo>.
Med starts its background server if needed and registers the repository.

template prints the repository's pull request templates, such as
.github/pull_request_template.md, each under its path.

draft attaches a pull request description to the review with that key (in a
Med thread, MED_THREAD_KEY), as its next revision. Write it in Markdown from
the template: a first line "# <title>" is the title, unless --title gives one.
Images can be local files, relative to the file, or https links; Med keeps a
copy of each local one. The user reads the draft first in the review's Notes
and comments on it; the comments come back like other review comments. Revise
the file and run draft again. Only the user opens the pull request, with
Create in Med, which runs gh pr create from the checkout's branch; never run
gh pr create yourself. --base names the branch to merge into (gh's default
otherwise), and --repo the checkout (default: MED_THREAD_REPO, or this one).`;

/** gh pr checkout options that take a value. */
const valueOptions = new Set(["-b", "--branch", "-R", "--repo"]);

export interface PullRequestCommand {
  kind: "help" | "checkout";
  selector?: string;
  gh: string[];
  repoOption: string[];
  /** --port or MED_PORT. Without them, the port that servicePort gives. */
  port?: number;
  stateDir: string;
  open: boolean;
}

export function parsePullRequestCommand(args: string[]): PullRequestCommand {
  const [action, ...rest] = args;
  let port: string | undefined;
  let stateDir: string | undefined;
  let open = true;
  let selector: string | undefined;
  const gh: string[] = [];
  const repoOption: string[] = [];
  const help = () => ({
    kind: "help" as const,
    gh,
    repoOption,
    stateDir: getStateDirectory(),
    open,
  });
  if (!action || ["help", "-h", "--help"].includes(action)) return help();
  if (action !== "checkout") throw new Error(pullRequestHelp);
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    const [name, inline] = arg.startsWith("--") ? arg.split(/=(.*)/s, 2) : [arg];
    const value = () => {
      const next = inline ?? rest[++index];
      if (next === undefined) throw new Error(`Supply a value for ${name}.`);
      return next;
    };
    if (name === "-h" || name === "--help") return help();
    else if (name === "--port") port = value();
    else if (name === "--state-dir") stateDir = value();
    else if (name === "--no-open") open = false;
    else if (valueOptions.has(name!)) {
      const option = value();
      gh.push(name!, option);
      if (name === "-R" || name === "--repo") repoOption.push("--repo", option);
    } else if (!arg.startsWith("-") && selector === undefined) selector = arg;
    else gh.push(arg);
  }
  if (!selector) throw new Error("Choose a pull request: med pr checkout <number|url|branch>.");
  const number = givenPort(port);
  return {
    kind: "checkout",
    selector,
    gh,
    repoOption,
    port: number,
    stateDir: getStateDirectory(stateDir),
    open,
  };
}

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().trim().min(1),
  url: pullRequestUrlSchema,
  baseRefName: z.string().min(1),
  baseRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
});

const quiet = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };
async function output(command: string, args: string[], cwd: string) {
  try {
    const { stdout } = await exec(command, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...quiet },
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(failure(command, error));
  }
}
function failure(command: string, error: unknown) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT")
    return command === "gh"
      ? "Install the GitHub CLI (gh), then sign in with gh auth login."
      : `Install ${command} and retry.`;
  const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
  return stderr || (error instanceof Error ? error.message : `${command} failed.`);
}
/** Runs gh in the terminal so its progress and prompts reach the user. */
function interactive(command: string, args: string[], cwd: string) {
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", (error) => fail(new Error(failure(command, error))));
    child.once("exit", (code, signal) =>
      code === 0
        ? done()
        : fail(
            new Error(signal ? `${command} stopped (${signal}).` : `${command} exited ${code}.`),
          ),
    );
  });
}
async function hasCommit(repo: string, oid: string) {
  try {
    await exec("git", ["cat-file", "-e", `${oid}^{commit}`], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}
type CommandOptions = {
  cwd?: string;
  fetcher?: typeof fetch;
  print?: (text: string) => void;
  warn?: (text: string) => void;
  openUrl?: (url: string) => void;
  environment?: NodeJS.ProcessEnv;
};

/** Pull request templates, case aside: in the root, .github, and docs, and
 * each Markdown file of .github/PULL_REQUEST_TEMPLATE/. */
async function templates(root: string) {
  const found: string[] = [];
  const names = async (folder: string) =>
    (await readdir(join(root, folder), { withFileTypes: true }).catch(() => [])).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  for (const folder of ["", ".github", "docs"])
    for (const entry of await names(folder)) {
      const path = join(folder, entry.name);
      if (entry.isFile() && /^pull_request_template\.md$/i.test(entry.name)) found.push(path);
      if (entry.isDirectory() && /^pull_request_template$/i.test(entry.name))
        for (const file of await names(path))
          if (file.isFile() && /\.md$/i.test(file.name)) found.push(join(path, file.name));
    }
  return found;
}

async function runTemplateCommand(args: string[], options: CommandOptions) {
  // --port and --state-dir are welcome, as on Med's other commands; it reads only files.
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      port: { type: "string" },
      "state-dir": { type: "string" },
    },
  });
  const cwd = resolve(options.cwd ?? process.cwd(), values.repo ?? ".");
  const root = await output("git", ["rev-parse", "--show-toplevel"], cwd).catch(() => {
    throw new Error("Run med pr template inside a Git repository, or pass --repo.");
  });
  const print = options.print ?? console.log;
  const found = await templates(root);
  if (!found.length) {
    print(
      `${root} has no pull request template. Write the description with why, what changed, and how you checked it.`,
    );
    return;
  }
  for (const path of found)
    print(`## ${path}\n\n${(await readFile(join(root, path), "utf8")).trim()}\n`);
}

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function runDraftCommand(args: string[], options: CommandOptions) {
  const { values } = parseArgs({
    args,
    options: {
      key: { type: "string" },
      file: { type: "string" },
      title: { type: "string" },
      base: { type: "string" },
      repo: { type: "string" },
      port: { type: "string" },
      "state-dir": { type: "string" },
    },
  });
  const environment = options.environment ?? process.env;
  const print = options.print ?? console.log;
  const warn = options.warn ?? console.error;
  const key = values.key ?? (environment.MED_THREAD_KEY || undefined);
  if (!key) throw new Error("Use --key, the key of the task's review.");
  if (!values.file) throw new Error("Use --file <path|->: the description in Markdown.");
  const cwd = resolve(options.cwd ?? process.cwd());
  const path = values.file === "-" ? undefined : resolve(cwd, values.file);
  const markdown = path ? await readFile(path, "utf8") : await readStandardInput();
  let title = values.title?.trim();
  let body = markdown.trim();
  const heading = /^#[ \t]+(.+)(?:\n|$)/.exec(body);
  if (!title && heading) {
    title = heading[1]!.trim();
    body = body.slice(heading[0].length).trim();
  }
  if (!title) throw new Error('Start the file with a "# <title>" line, or pass --title.');
  // Med keeps a copy of each local image; links stay links.
  const folder = path ? dirname(path) : cwd;
  const images: NonNullable<PrDraftInput["images"]> = [];
  for (const href of new Set(imageHrefs(body))) {
    if (/^(?:[a-z][\w+.-]*:)/i.test(href)) continue;
    let file: string;
    try {
      file = decodeURIComponent(href);
    } catch {
      file = href;
    }
    file = isAbsolute(file) ? file : resolve(folder, file);
    const mimeType = IMAGE_TYPES[extname(file).toLowerCase()];
    const bytes = mimeType ? await readFile(file).catch(() => undefined) : undefined;
    if (!mimeType) warn(`${href}: Med keeps PNG, JPEG, GIF, and WebP images; it shows no other.`);
    else if (!bytes) warn(`${href}: there is no such file.`);
    else if (bytes.length > MAX_PROMPT_IMAGE_BYTES) warn(`${href}: an image can be up to 5 MB.`);
    else images.push({ href, mimeType, data: bytes.toString("base64") });
  }
  if (images.length > MAX_PR_DRAFT_IMAGES)
    throw new Error(`A draft can show up to ${MAX_PR_DRAFT_IMAGES} local images.`);
  const repo = values.repo
    ? resolve(cwd, values.repo)
    : environment.MED_THREAD_REPO ||
      (await output("git", ["rev-parse", "--show-toplevel"], cwd).catch(() => undefined));
  const stateDir = getStateDirectory(values["state-dir"]);
  const connection = await readConnection(
    stateDir,
    await clientPort(stateDir, values.port, environment),
  );
  const fetcher = options.fetcher ?? fetch;
  // A key, or the review's ID (r_…), as med review update takes.
  const { id } = z
    .object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) })
    .parse(
      await request(connection, "/api/reviews/by-key", fetcher, { key }).catch((error: unknown) =>
        /^r_[a-z0-9]+$/.test(key) ? { id: key } : Promise.reject(error),
      ),
    );
  const input: PrDraftInput = {
    title,
    body,
    ...(repo ? { repo } : {}),
    ...(values.base ? { base: values.base } : {}),
    images,
  };
  const saved = savedReviewSchema.parse(
    await request(connection, `/api/reviews/${id}/pr-draft`, fetcher, input),
  );
  // Open windows read the review again.
  await showReview(connection, id, false, fetcher, options.openUrl, true);
  print(
    `[Pull request draft](${connection.origin}/review/${id}), revision ${saved.prDraft?.revision ?? 1}${images.length ? `, with ${images.length} ${images.length === 1 ? "image" : "images"}` : ""}.`,
  );
  print(
    "The user reads it in the review's Notes and comments on it. Revise the file and run med pr draft again; the user opens the pull request with Create in Med.",
  );
}

export async function runPullRequestCommand(
  args: string[],
  options: CommandOptions = {},
): Promise<void> {
  if (args[0] === "template") return runTemplateCommand(args.slice(1), options);
  if (args[0] === "draft") return runDraftCommand(args.slice(1), options);
  const command = parsePullRequestCommand(args);
  const print = options.print ?? console.log;
  if (command.kind === "help") {
    print(pullRequestHelp);
    return;
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  let repo: string;
  try {
    repo = await realpath(await output("git", ["rev-parse", "--show-toplevel"], cwd));
  } catch {
    throw new Error("Run med pr checkout inside a Git repository.");
  }
  await interactive("gh", ["pr", "checkout", command.selector!, ...command.gh], cwd);
  const pullRequest = pullRequestSchema.parse(
    JSON.parse(
      await output(
        "gh",
        [
          "pr",
          "view",
          command.selector!,
          ...command.repoOption,
          "--json",
          "number,title,url,baseRefName,baseRefOid,headRefOid",
        ],
        cwd,
      ),
    ),
  );
  // gh fetches the head. The base branch can be missing or stale locally.
  let base = pullRequest.baseRefOid;
  if (!(await hasCommit(repo, base))) {
    const remote = await remoteFor(repo, pullRequest.url);
    await output("git", ["fetch", "--no-tags", remote, pullRequest.baseRefName], repo);
    if (!(await hasCommit(repo, base)))
      base = await output("git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], repo);
  }
  if (!(await hasCommit(repo, pullRequest.headRefOid)))
    throw new Error(`gh did not fetch the pull request head ${pullRequest.headRefOid}.`);

  const { ensureService } = await import("./service");
  const connection = await ensureService(
    command.stateDir,
    command.port ?? (await servicePort(command.stateDir, undefined)).port,
  );
  const fetcher = options.fetcher ?? fetch;
  const known = z
    .object({
      repositories: z.array(
        z.object({ path: z.string(), worktrees: z.array(z.object({ path: z.string() })) }),
      ),
    })
    .parse(await request(connection, "/api/repositories", fetcher));
  // Registering a linked worktree would replace its repository's path, so add
  // only a repository that Med does not know yet.
  if (
    !known.repositories.some(
      (entry) => entry.path === repo || entry.worktrees.some((tree) => tree.path === repo),
    )
  )
    await request(connection, "/api/repositories", fetcher, { path: repo });
  const manifest: SavedReviewCreate = {
    title: `#${pullRequest.number} ${pullRequest.title}`.slice(0, 200),
    pullRequestUrl: pullRequest.url,
    targets: [
      {
        repo,
        comparison: { kind: "range", base, head: pullRequest.headRefOid, mergeBase: true },
      },
    ],
  };
  const created = z
    .object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) })
    .parse(await request(connection, "/api/reviews", fetcher, manifest));
  const url = `${connection.origin}/review/${created.id}`;
  const launch = `${url}#token=${connection.token}`;
  if (command.open) {
    // An open Med window shows the review; otherwise the browser opens it.
    await showReview(connection, created.id, true, fetcher, options.openUrl ?? openBrowser);
    print(`Med review of #${pullRequest.number}: ${url}`);
  }
  // --no-open asks for a launch URL, as med web --no-open does. Open windows
  // still list the review, unread.
  else {
    await showReview(connection, created.id, false, fetcher);
    print(launch);
  }
}
