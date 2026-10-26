import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  pullRequestUrlSchema,
  type PartInput,
  type PartShape,
  type SavedReviewCreate,
} from "../shared/saved-review";

// `med review create --stack` and `--set` (docs/STACKS.md): pull requests and
// branches become the parts of one thread. Pull requests are read with gh; a
// missing head is fetched as refs/pull/<n>/head. Nothing is checked out.

const exec = promisify(execFile);
const quiet = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };

async function run(repo: string, command: string, args: string[]) {
  try {
    const { stdout } = await exec(command, args, {
      cwd: repo,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, ...quiet },
    });
    return stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        command === "gh"
          ? "Install the GitHub CLI (gh) and sign in with gh auth login, or name branches in place of pull requests."
          : `Install ${command} and retry.`,
      );
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(stderr || `${command} ${args.join(" ")} failed.`);
  }
}

const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().trim().min(1),
  url: pullRequestUrlSchema,
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  baseRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
});
type Pull = z.infer<typeof pullSchema>;

/** A pull request number (`12`, `#12`) or URL; anything else is a branch or ref. */
export const isPullRequest = (item: string) =>
  /^#?\d+$/.test(item) || pullRequestUrlSchema.safeParse(item).success;

async function hasCommit(repo: string, oid: string) {
  return run(repo, "git", ["cat-file", "-e", `${oid}^{commit}`]).then(
    () => true,
    () => false,
  );
}

/** The local remote for a GitHub repository URL, or the URL itself. */
export async function remoteFor(repo: string, pullRequestUrl: string) {
  const url = new URL(pullRequestUrl);
  const [, owner, name] = url.pathname.split("/");
  const slug = `${url.host}/${owner}/${name}`.toLowerCase();
  const remotes = await run(repo, "git", ["remote", "-v"]).catch(() => "");
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

/** Reads a pull request, and fetches its head and base when they are not local. */
async function readPull(repo: string, item: string): Promise<Pull> {
  const pull = pullSchema.parse(
    JSON.parse(
      await run(repo, "gh", [
        "pr",
        "view",
        item.replace(/^#/, ""),
        "--json",
        "number,title,url,baseRefName,headRefName,baseRefOid,headRefOid,state,isDraft",
      ]),
    ),
  );
  if (!(await hasCommit(repo, pull.headRefOid))) {
    const remote = await remoteFor(repo, pull.url);
    await run(repo, "git", ["fetch", "--no-tags", remote, `refs/pull/${pull.number}/head`]);
    if (!(await hasCommit(repo, pull.headRefOid)))
      throw new Error(`Could not fetch the head of pull request #${pull.number}.`);
  }
  if (!(await hasCommit(repo, pull.baseRefOid))) {
    const remote = await remoteFor(repo, pull.url);
    await run(repo, "git", ["fetch", "--no-tags", remote, pull.baseRefName]);
    if (!(await hasCommit(repo, pull.baseRefOid)))
      pull.baseRefOid = await run(repo, "git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  }
  return pull;
}

const pullState = (pull: Pull): PartInput["state"] =>
  pull.state === "MERGED"
    ? "merged"
    : pull.state === "CLOSED"
      ? "closed"
      : pull.isDraft
        ? "draft"
        : pull.state === "OPEN"
          ? "open"
          : undefined;

/**
 * The comparisons and parts of a stack or a set, in the given order (a
 * stack's bottom first). A pull request is its own diff: from the merge base
 * with its base commit. A branch of a stack is its changes since the layer
 * below; the bottom branch, and each branch of a set, since `base`.
 */
export async function resolveParts(
  repo: string,
  shape: PartShape,
  items: readonly string[],
  base: string,
): Promise<{ targets: SavedReviewCreate["targets"]; parts: PartInput[] }> {
  if (items.length < 2)
    throw new Error(`Name two or more pull requests or branches after --${shape}.`);
  const targets: SavedReviewCreate["targets"] = [];
  const parts: PartInput[] = [];
  let below: { ref: string; name: string } = { ref: base, name: base };
  for (const item of items) {
    if (isPullRequest(item)) {
      const pull = await readPull(repo, item);
      targets.push({
        repo,
        comparison: {
          kind: "range",
          base: pull.baseRefOid,
          head: pull.headRefOid,
          mergeBase: true,
        },
      });
      const state = pullState(pull);
      parts.push({
        key: pull.url,
        title: pull.title,
        pullRequestUrl: pull.url,
        pullRequestTitle: pull.title,
        ...(state ? { state } : {}),
        base: pull.baseRefName,
        head: pull.headRefName,
      });
      below = { ref: pull.headRefOid, name: pull.headRefName };
      continue;
    }
    const head = await run(repo, "git", [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${item}^{commit}`,
    ]).catch(() => {
      throw new Error(`${item} is not a pull request number, a pull request URL, or a branch.`);
    });
    const from = shape === "stack" ? below : { ref: base, name: base };
    targets.push({
      repo,
      comparison: { kind: "range", base: from.ref, head: item, mergeBase: true },
    });
    parts.push({ key: item, title: item, base: from.name, head: item });
    below = { ref: head, name: item };
  }
  return { targets, parts };
}
