import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { RegisteredRepository } from "../shared/protocol";
import type { PullAddress, PullJob, PullStep } from "../shared/pull-workspace";
import type { SavedReview } from "../shared/saved-review";
import { HostError } from "./runtime/errors";
import { runProcess } from "./runtime/process";

/** What a pull request job needs from the host. */
export interface PullHost {
  repositories(): RegisteredRepository[];
  /** Lists a repository's worktrees again, so the host accepts a new one. */
  refresh(path: string): Promise<unknown>;
  /** Calls the host's own API, as the browser does. */
  api<T>(path: string, body?: unknown): Promise<T>;
  /** The GitHub CLI; tests give a fake one. */
  gh: { command: string; args: string[] };
  /** The folder for the worktrees that Med makes. */
  worktrees: string;
}

const QUIET = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };
const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().trim().min(1),
  url: z.string(),
  baseRefName: z.string().min(1),
  baseRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  headRefName: z.string().min(1),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
});

/** A Git remote address as host/owner/name, such as github.com/acme/trails. */
const remoteSlug = (address: string) =>
  address
    .toLowerCase()
    .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, "$1/")
    .replace(/^https?:\/\/(?:[^@/]+@)?/, "")
    .replace(/\.git$/, "");

/** A path as people read it, with ~ for the home folder. */
const shown = (path: string) =>
  path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path;

/**
 * Opens GitHub pull requests as workspaces. Each job finds the repository by
 * its remotes, reads the pull request with gh, checks it out in a worktree of
 * its own, saves the review, and starts an agent there if asked. The
 * repository's own checkout and branches stay as they are.
 */
export class PullJobs {
  private jobs = new Map<string, { job: PullJob; listeners: Set<() => void> }>();

  constructor(private host: PullHost) {}

  get(id: string) {
    return this.jobs.get(id)?.job;
  }

  subscribe(id: string, listener: () => void) {
    const entry = this.jobs.get(id);
    entry?.listeners.add(listener);
    return () => void entry?.listeners.delete(listener);
  }

  start(address: PullAddress, agent?: { id: string; name: string }): PullJob {
    // The same pull request twice at once shares one job, and one worktree.
    for (const { job } of this.jobs.values())
      if (job.url === address.url && job.status === "running") return job;
    const job: PullJob = {
      id: randomUUID(),
      url: address.url,
      slug: `${address.owner}/${address.name}`,
      number: address.number,
      status: "running",
      steps: [
        { id: "repository", label: `Find ${address.owner}/${address.name}`, state: "pending" },
        { id: "pull", label: `Read pull request #${address.number}`, state: "pending" },
        { id: "worktree", label: "Make a worktree", state: "pending" },
        { id: "checkout", label: "Check out the branch", state: "pending" },
        { id: "base", label: "Fetch the base branch", state: "pending" },
        { id: "review", label: "Save the review", state: "pending" },
        ...(agent
          ? [{ id: "agent" as const, label: `Start ${agent.name}`, state: "pending" as const }]
          : []),
      ],
    };
    this.jobs.set(job.id, { job, listeners: new Set() });
    // Finished jobs stay a while, so a page that reloads can read the result.
    const finished = [...this.jobs.values()].filter((entry) => entry.job.status !== "running");
    for (const entry of finished.slice(0, Math.max(0, this.jobs.size - 32)))
      this.jobs.delete(entry.job.id);
    void this.run(job, address, agent);
    return job;
  }

  private publish(job: PullJob, patch: Partial<PullJob>) {
    const entry = this.jobs.get(job.id);
    if (!entry) return;
    entry.job = { ...entry.job, ...patch };
    for (const listener of entry.listeners) listener();
  }

  private setStep(job: PullJob, id: PullStep["id"], patch: Partial<PullStep>) {
    const current = this.jobs.get(job.id)?.job ?? job;
    this.publish(job, {
      steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    });
  }

  private async step<T>(job: PullJob, id: PullStep["id"], work: () => Promise<T>) {
    this.setStep(job, id, { state: "running", startedAt: Date.now() });
    try {
      const result = await work();
      const step = this.jobs.get(job.id)?.job.steps.find((entry) => entry.id === id);
      if (step?.state === "running") this.setStep(job, id, { state: "done", endedAt: Date.now() });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The step failed.";
      this.setStep(job, id, { state: "failed", endedAt: Date.now() });
      this.publish(job, { status: "failed", error: message });
      throw error;
    }
  }

  private async run(job: PullJob, address: PullAddress, agent?: { id: string; name: string }) {
    const { host } = this;
    const git = (cwd: string, args: string[], timeoutMs?: number) =>
      this.command("git", args, cwd, timeoutMs);
    const gh = (cwd: string, args: string[], timeoutMs?: number) =>
      this.command(host.gh.command, [...host.gh.args, ...args], cwd, timeoutMs, "gh");
    const hasCommit = (repo: string, oid: string) =>
      git(repo, ["cat-file", "-e", `${oid}^{commit}`]).then(
        () => true,
        () => false,
      );
    try {
      const { repository, remote } = await this.step(job, "repository", async () => {
        const slug = `${address.host}/${address.owner}/${address.name}`.toLowerCase();
        for (const repository of host.repositories()) {
          const remotes = await git(repository.path, ["remote", "-v"]).catch(() => "");
          for (const line of remotes.split("\n")) {
            const [remote, url] = line.split(/\s+/);
            if (remote && url && remoteSlug(url) === slug) {
              this.setStep(job, "repository", { detail: shown(repository.path) });
              return { repository, remote };
            }
          }
        }
        throw new HostError(
          "repository-not-found",
          `Add a clone of ${address.owner}/${address.name} to Med, then open the link again.`,
          404,
        );
      });

      const pull = await this.step(job, "pull", async () => {
        const fields = "number,title,url,baseRefName,baseRefOid,headRefName,headRefOid";
        const pull = pullRequestSchema.parse(
          JSON.parse(await gh(repository.path, ["pr", "view", address.url, "--json", fields])),
        );
        this.publish(job, { title: pull.title });
        this.setStep(job, "pull", { detail: pull.title });
        this.setStep(job, "checkout", { label: `Check out ${pull.headRefName}` });
        this.setStep(job, "base", { label: `Fetch ${pull.baseRefName}` });
        return pull;
      });

      const worktree = await this.step(job, "worktree", async () => {
        const folder = join(host.worktrees, `${repository.name}-${repository.id.slice(0, 8)}`);
        await mkdir(folder, { recursive: true });
        const path = join(await realpath(folder), `pr-${pull.number}`);
        await git(repository.path, ["worktree", "prune"]);
        const listed = await git(repository.path, ["worktree", "list", "--porcelain"]);
        if (listed.split("\n").includes(`worktree ${path}`))
          this.setStep(job, "worktree", { label: "Use the worktree", detail: shown(path) });
        else {
          await git(repository.path, ["worktree", "add", "--detach", path], 300_000);
          this.setStep(job, "worktree", { detail: shown(path) });
        }
        return path;
      });

      await this.step(job, "checkout", async () => {
        const repo = `${address.host}/${job.slug}`;
        const target = ["pr", "checkout", String(pull.number), "--repo", repo];
        try {
          await gh(worktree, target, 600_000);
          this.setStep(job, "checkout", { detail: pull.headRefName });
        } catch {
          // The branch can be checked out in another worktree, or differ from
          // the pull request. Its commit then opens without a branch.
          await gh(worktree, [...target, "--detach"], 600_000);
          this.setStep(job, "checkout", { detail: `${pull.headRefOid.slice(0, 8)}, no branch` });
        }
        if (!(await hasCommit(repository.path, pull.headRefOid)))
          throw new Error(`gh did not fetch the pull request head ${pull.headRefOid}.`);
      });

      const base = await this.step(job, "base", async () => {
        if (await hasCommit(repository.path, pull.baseRefOid)) {
          this.setStep(job, "base", {
            state: "skipped",
            detail: "Already here",
            endedAt: Date.now(),
          });
          return pull.baseRefOid;
        }
        await git(repository.path, ["fetch", "--no-tags", remote, pull.baseRefName], 600_000);
        if (await hasCommit(repository.path, pull.baseRefOid)) return pull.baseRefOid;
        return git(repository.path, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
      });

      const review = await this.step(job, "review", async () => {
        await host.refresh(repository.path);
        const key = `${address.host}/${address.owner}/${address.name}#${pull.number}`;
        const known = await host
          .api<SavedReview>("/api/reviews/by-key", { key })
          .catch(() => undefined);
        const latest = known?.iterations?.at(-1)?.targetIds ?? known?.targets.map((t) => t.id);
        if (
          known &&
          known.targets.some(
            (target) => latest?.includes(target.id) && target.head === pull.headRefOid,
          )
        ) {
          this.setStep(job, "review", { detail: "Up to date" });
          return known;
        }
        return host.api<SavedReview>("/api/reviews", {
          key,
          title: `#${pull.number} ${pull.title}`.slice(0, 200),
          pullRequestUrl: address.url,
          pullRequestTitle: pull.title,
          targets: [
            {
              repo: worktree,
              comparison: { kind: "range", base, head: pull.headRefOid, mergeBase: true },
            },
          ],
        });
      });
      this.publish(job, { reviewId: review.id, worktree });

      if (agent)
        await this.step(job, "agent", async () => {
          const started = await host.api<{ state: { sessionId: string } }>(
            `/api/reviews/${review.id}/owned`,
            { preset: agent.id },
          );
          await host.api(`/api/reviews/${review.id}/owned/${started.state.sessionId}`, {
            action: "prompt",
            text: reviewPrompt(pull, base),
          });
        });
      this.publish(job, { status: "done" });
    } catch {
      /* The failed step and the job's error say what went wrong. */
    }
  }

  private async command(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs = 60_000,
    name = command,
  ) {
    try {
      const { stdout } = await runProcess(command, args, { cwd, timeoutMs, env: QUIET });
      return stdout.toString("utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          name === "gh"
            ? "Install the GitHub CLI (gh), then sign in with gh auth login."
            : `Install ${name}, then try again.`,
          { cause: error },
        );
      const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
      throw new Error(stderr.split("\n").slice(-3).join("\n") || `${name} failed.`, {
        cause: error,
      });
    }
  }
}

/** What the agent first reads in the pull request's worktree. */
function reviewPrompt(pull: z.infer<typeof pullRequestSchema>, base: string) {
  return [
    `Review pull request #${pull.number}, "${pull.title}" (${pull.url}).`,
    `Its head is checked out in this directory. The changes are \`git diff ${base.slice(0, 12)}...HEAD\`, from the merge base with ${pull.baseRefName}.`,
    "Report bugs, risky changes, and missing tests, each with a file path and line. Do not edit, commit, or push.",
  ].join("\n");
}
