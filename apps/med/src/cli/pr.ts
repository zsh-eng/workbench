import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { DEFAULT_PORT, getStateDirectory } from "../host/runtime/connection";
import { pullRequestUrlSchema, type SavedReviewCreate } from "../shared/saved-review";
import { openBrowser, request, showReview } from "./review";

const exec = promisify(execFile);

export const pullRequestHelp = `Usage: med pr checkout <number|url|branch> [gh options] [--port <port>] [--state-dir <dir>] [--no-open]

Check out a GitHub pull request with gh, then open its review in Med: the
changes from the merge base with the pull request's base branch to its head.
Run it inside the repository. gh must be installed and signed in.
Other options pass through to gh pr checkout, for example --force, --detach,
--branch <name>, or --repo <owner/repo>.
Med starts its background server if needed and registers the repository.`;

/** gh pr checkout options that take a value. */
const valueOptions = new Set(["-b", "--branch", "-R", "--repo"]);

export interface PullRequestCommand {
  kind: "help" | "checkout";
  selector?: string;
  gh: string[];
  repoOption: string[];
  port: number;
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
    port: DEFAULT_PORT,
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
  const number = port === undefined ? DEFAULT_PORT : Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error("Choose a port from 1 to 65535.");
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
/** The local remote for a GitHub repository URL, or the URL itself. */
async function remoteFor(repo: string, pullRequestUrl: string) {
  const url = new URL(pullRequestUrl);
  const [, owner, name] = url.pathname.split("/");
  const slug = `${url.host}/${owner}/${name}`.toLowerCase();
  const remotes = await output("git", ["remote", "-v"], repo);
  for (const line of remotes.split("\n")) {
    const [remote, address] = line.split(/\s+/);
    if (!remote || !address) continue;
    const normalized = address
      .toLowerCase()
      .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, "$1/")
      .replace(/^https?:\/\/(?:[^@/]+@)?/, "")
      .replace(/\.git$/, "");
    if (normalized === slug) return remote;
  }
  return `${url.origin}/${owner}/${name}.git`;
}

export async function runPullRequestCommand(
  args: string[],
  options: {
    cwd?: string;
    fetcher?: typeof fetch;
    print?: (text: string) => void;
    openUrl?: (url: string) => void;
  } = {},
): Promise<void> {
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
  const connection = await ensureService(command.stateDir, command.port);
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
