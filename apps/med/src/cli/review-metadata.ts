import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { pullRequestUrlSchema, type SavedReviewCreate } from "../shared/saved-review";

const exec = promisify(execFile);
const prSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: pullRequestUrlSchema,
  headRefOid: z.string(),
});

/** Optional CLI-only lookup. Review rendering never waits for GitHub. */
export async function reviewMetadata(
  input: SavedReviewCreate,
  keepTitle: boolean,
  infer: boolean,
): Promise<SavedReviewCreate> {
  if (input.pullRequestUrl && keepTitle) return input;
  if (!input.pullRequestUrl && (!infer || input.targets.length !== 1)) return input;
  const target = input.targets[0]!;
  const run = (command: string, args: string[]) =>
    exec(command, args, {
      cwd: target.repo,
      timeout: 2500,
      maxBuffer: 64 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    }).then(({ stdout }) => stdout.trim());
  try {
    let args: string[];
    let expectedHead: string | undefined;
    if (input.pullRequestUrl) args = [input.pullRequestUrl];
    else {
      const remote = await run("git", ["remote", "get-url", "origin"]);
      const github =
        /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(
          remote,
        );
      if (!github) return input;
      const comparison = target.comparison;
      if (comparison.kind !== "range" && comparison.kind !== "commit") return input;
      const ref = comparison.kind === "range" ? comparison.head : comparison.commit;
      expectedHead = await run("git", [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
      ]);
      // A SHA alone does not identify a PR. Use its branch only when it is HEAD.
      let branch = await run("git", [
        "rev-parse",
        "--abbrev-ref",
        "--verify",
        "--end-of-options",
        ref,
      ]);
      if (!branch || branch === "HEAD" || /^[a-f0-9]{40,64}$/i.test(branch)) {
        const head = await run("git", ["rev-parse", "HEAD"]);
        if (expectedHead !== head) return input;
        branch = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      }
      args = [branch, "--repo", github[1]!];
    }
    const result = prSchema.parse(
      JSON.parse(await run("gh", ["pr", "view", ...args, "--json", "title,url,headRefOid"])),
    );
    // Never attach a branch's current PR to an older/different reviewed commit.
    if (expectedHead && result.headRefOid !== expectedHead) return input;
    // Pin an inferred PR's head so a moving local branch cannot change the
    // comparison between this check and the host's capture.
    const comparison = target.comparison;
    const targets =
      expectedHead && (comparison.kind === "range" || comparison.kind === "commit")
        ? [
            {
              ...target,
              comparison:
                comparison.kind === "range"
                  ? { ...comparison, head: expectedHead }
                  : { ...comparison, commit: expectedHead },
            },
          ]
        : input.targets;
    return {
      ...input,
      targets,
      title: keepTitle ? input.title : result.title,
      pullRequestUrl: result.url,
    };
  } catch {
    // Missing gh, no PR, offline, authentication, and timeouts keep local review usable.
    return input;
  }
}
