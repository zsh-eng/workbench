import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { pullRequestUrlSchema } from "../shared/saved-review";
import { runProcess } from "./runtime/process";

// A thread links its pull request when `med review create` finds one, or when
// the agent passes `--pr`. An agent often opens the pull request later, after
// it pushes its branch. This finds the open pull request of a tab's branch
// and links it, so the Review header and Changes show its comments.
//
// The host stays cheap: it asks gh only for tabs without a pull request (not
// for history), never when gh is missing or has no sign-in, at most once at a
// time, and for each tab when its refs changed and then held still (a commit
// or a push), or else at most every 5 minutes.

/** A tab is asked about again after this long without a change to its refs. */
const PERIOD_MS = 5 * 60_000;
/** A tab's refs are read this often. A lookup waits for refs that changed to
 * hold still for one read, so a push and the `gh pr create` after it give
 * one lookup. */
const POLL_MS = 15_000;
/** After gh was missing, it is looked for again after this long. */
const MISSING_MS = 10 * 60_000;
/** A tab that the thread list did not name for this long is forgotten. */
const FORGET_MS = 60 * 60_000;

const pullsSchema = z
  .array(
    z.object({
      url: pullRequestUrlSchema,
      title: z.string().trim().min(1).max(200),
      number: z.number().int().positive(),
      headRefOid: z.string(),
    }),
  )
  .max(1);

/**
 * Whether gh has a sign-in, from its token variables or its hosts file, so
 * that Med starts no gh process that can only fail. The token itself can be
 * in the system keychain; the hosts file names the host either way.
 */
export async function ghSignedIn(env: NodeJS.ProcessEnv = process.env) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN || env.GH_ENTERPRISE_TOKEN || env.GITHUB_ENTERPRISE_TOKEN)
    return true;
  const folder =
    env.GH_CONFIG_DIR ||
    (process.platform === "win32" && env.AppData
      ? join(env.AppData, "GitHub CLI")
      : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh"));
  const hosts = await readFile(join(folder, "hosts.yml"), "utf8").catch(() => "");
  return /^[^\s#]/m.test(hosts);
}

interface Entry {
  checkout: string;
  branch: string;
  /** When the thread list last named the tab. */
  listed: number;
  /** The refs token at the last read, and when that was. */
  seen?: string;
  polled: number;
  /** The refs token at the last lookup, and when that was. */
  asked?: string;
  looked: number;
}

export function createPullRequestLinks(options: {
  gh: { command: string; args: string[] };
  /** A token that changes with the checkout's refs and HEAD; undefined when
   * there is none (repository/cache.ts). */
  refs(checkout: string): Promise<string | undefined>;
  /** Links the pull request to the thread's saved review. */
  link(reviewId: string, pull: { url: string; title: string }): Promise<void>;
  signedIn?: () => Promise<boolean>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const signedIn = options.signedIn ?? (() => ghSignedIn());
  const entries = new Map<string, Entry>();
  const abort = new AbortController();
  let running: Promise<void> | undefined;
  let missingUntil = 0;

  const lookup = async (entry: Entry) => {
    const { stdout } = await runProcess(
      options.gh.command,
      [
        ...options.gh.args,
        "pr",
        "list",
        "--head",
        entry.branch,
        "--state",
        "open",
        "--json",
        "url,title,number,headRefOid",
        "--limit",
        "1",
      ],
      {
        cwd: entry.checkout,
        signal: abort.signal,
        timeoutMs: 15_000,
        maxBytes: 256 * 1024,
        env: { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" },
      },
    );
    return pullsSchema.parse(JSON.parse(stdout.toString("utf8")))[0];
  };

  const pump = async () => {
    for (const [id, entry] of entries) {
      if (abort.signal.aborted) return;
      const time = now();
      if (time - entry.listed > FORGET_MS) {
        entries.delete(id);
        continue;
      }
      // Only tabs that the last lists named; a closed tab waits.
      if (time - entry.listed > POLL_MS || time - entry.polled < POLL_MS) continue;
      entry.polled = time;
      const token = await options.refs(entry.checkout).catch(() => undefined);
      const settled = token === entry.seen;
      entry.seen = token;
      const due =
        !entry.looked ||
        time - entry.looked >= PERIOD_MS ||
        (settled && token !== undefined && token !== entry.asked);
      if (!due || time < missingUntil || !(await signedIn().catch(() => false))) continue;
      entry.asked = token;
      entry.looked = time;
      try {
        const pull = await lookup(entry);
        if (pull && entries.get(id) === entry) {
          await options.link(id, { url: pull.url, title: pull.title });
          entries.delete(id);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") missingUntil = now() + MISSING_MS;
        // Offline, a failed sign-in, or a repository that is not on GitHub:
        // the next change or period asks again.
      }
    }
  };

  return {
    /**
     * A tab of a saved review without a pull request, on `branch` in
     * `checkout`, as the thread list reads it. Starts a lookup in the
     * background when one is due; it never waits for gh.
     */
    check(reviewId: string, checkout: string, branch: string) {
      const time = now();
      const entry = entries.get(reviewId);
      if (entry && entry.checkout === checkout && entry.branch === branch) entry.listed = time;
      else entries.set(reviewId, { checkout, branch, listed: time, polled: 0, looked: 0 });
      running ??= pump().finally(() => {
        running = undefined;
      });
    },
    /** Waits for the lookup that runs, for tests. */
    settle: () => running ?? Promise.resolve(),
    close() {
      abort.abort();
    },
  };
}
