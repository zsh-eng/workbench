import { tmpdir } from "node:os";
import { z } from "zod";
import type { RegisteredRepository } from "../shared/protocol";
import {
  pullInboxSchema,
  type PullInbox,
  type PullInboxRow,
  type PullInboxWant,
} from "../shared/pull-inbox";
import { parseRemote } from "./open-in";
import { ProcessFailure, runProcess } from "./runtime/process";
import { readRecords, writeStateFile } from "./runtime/state-file";

// The pull requests page's read: two GitHub searches with the user's gh
// sign-in, review requests for you and your own open pull requests, in the
// GitHub repositories that Med's registered repositories push to, or in all
// of GitHub. A remote on another GitHub host, such as GitHub Enterprise, is
// searched on that host. Nothing here writes to GitHub.
//
// The host keeps the last answer for each scope, in memory and in a state
// file, so every window, a reload, and a restart open the page with it at
// once. A failed read keeps the last lists and says why.

/** An answer this new serves a page that asks for a fresh one. */
const FRESH_MS = 60_000;
/** GitHub's search takes a query of at most 256 characters. */
const MAX_QUERY = 250;
const SEARCH_SIZE = 50;

const SEARCH = `query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: ${SEARCH_SIZE}) {
    nodes {
      ... on PullRequest {
        url number title isDraft createdAt updatedAt additions deletions
        headRefName baseRefName reviewDecision mergeable
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } } }
        }
      }
    }
  }
}`;

const node = z.object({
  url: z.string(),
  number: z.number(),
  title: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  headRefName: z.string(),
  baseRefName: z.string(),
  reviewDecision: z.string().nullable(),
  mergeable: z.string().nullable(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: z.string() }).nullable(),
        }),
      }),
    ),
  }),
  reviewRequests: z.object({
    nodes: z.array(
      z.object({
        requestedReviewer: z
          .object({
            __typename: z.string(),
            login: z.string().optional(),
            slug: z.string().optional(),
            organization: z.object({ login: z.string() }).optional(),
          })
          .nullable(),
      }),
    ),
  }),
});
export type SearchNode = z.infer<typeof node>;
const answer = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }),
    search: z.object({ nodes: z.array(z.unknown()) }),
  }),
});

/** A Git remote address as host/owner/name, such as github.com/acme/trails. */
export const remoteSlug = (address: string) =>
  address
    .toLowerCase()
    .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, "$1/")
    .replace(/^https?:\/\/(?:[^@/]+@)?/, "")
    .replace(/\.git$/, "");

const checksOf = (entry: SearchNode): PullInboxRow["checks"] => {
  const state = entry.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return state === "SUCCESS"
    ? "pass"
    : state === "FAILURE" || state === "ERROR"
      ? "fail"
      : state === "PENDING" || state === "EXPECTED"
        ? "pending"
        : "none";
};
const reviewOf = (entry: SearchNode): PullInboxRow["review"] =>
  entry.reviewDecision === "APPROVED"
    ? "approved"
    : entry.reviewDecision === "CHANGES_REQUESTED"
      ? "changes-requested"
      : entry.reviewDecision === "REVIEW_REQUIRED"
        ? "required"
        : "none";

function row(entry: SearchNode, why?: string): PullInboxRow {
  return {
    url: entry.url,
    number: entry.number,
    title: entry.title,
    repository: entry.repository.nameWithOwner,
    author: entry.author?.login ?? "ghost",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    draft: entry.isDraft,
    review: reviewOf(entry),
    checks: checksOf(entry),
    conflicts: entry.mergeable === "CONFLICTING",
    additions: entry.additions,
    deletions: entry.deletions,
    ...(why ? { why } : {}),
  };
}

/** Why a review request is yours: you, or a team of yours. */
function requested(entry: SearchNode, viewer: string) {
  const reviewers = entry.reviewRequests.nodes.flatMap((request) =>
    request.requestedReviewer ? [request.requestedReviewer] : [],
  );
  if (reviewers.some((reviewer) => reviewer.login?.toLowerCase() === viewer.toLowerCase()))
    return "review requested";
  const team = reviewers.find((reviewer) => reviewer.__typename === "Team" && reviewer.slug);
  return team
    ? `review requested of ${team.organization ? `${team.organization.login}/` : ""}${team.slug}`
    : "review requested";
}

/** Your own pull request waits on you when a reviewer asked for changes or
 * its checks fail. */
function yourTurn(entry: SearchNode) {
  if (entry.reviewDecision === "CHANGES_REQUESTED") return "changes requested";
  if (checksOf(entry) === "fail") return "checks failing";
  if (entry.mergeable === "CONFLICTING") return "conflicts with its base";
  return undefined;
}

const newest = (a: PullInboxRow, b: PullInboxRow) => b.updatedAt.localeCompare(a.updatedAt);

/** One host's rows: review requests, your pull requests that wait on you,
 * and the rest of yours; a stack of yours is one row. */
function hostRows(viewer: string, requests: SearchNode[], authored: SearchNode[]) {
  const seen = new Set<string>();
  const waiting: PullInboxRow[] = [];
  for (const entry of requests)
    if (!seen.has(entry.url) && entry.author?.login.toLowerCase() !== viewer.toLowerCase()) {
      seen.add(entry.url);
      waiting.push(row(entry, requested(entry, viewer)));
    }
  waiting.sort(newest);
  // Your pull requests: one on another's head branch, in the same
  // repository, is the next layer of its stack.
  const own = authored.filter((entry) => !seen.has(entry.url));
  const key = (repository: string, branch: string) => `${repository}\0${branch}`;
  const byHead = new Map(
    own.map((entry) => [key(entry.repository.nameWithOwner, entry.headRefName), entry]),
  );
  const above = new Map<string, SearchNode>();
  for (const entry of own) {
    const below = byHead.get(key(entry.repository.nameWithOwner, entry.baseRefName));
    if (below && below !== entry && !above.has(below.url)) above.set(below.url, entry);
  }
  const layered = new Set([...above.values()].map((entry) => entry.url));
  const yours: PullInboxRow[] = [];
  const mine: PullInboxRow[] = [];
  for (const entry of own) {
    if (layered.has(entry.url)) continue;
    const stack: SearchNode[] = [];
    const visited = new Set([entry.url]);
    for (
      let next = above.get(entry.url);
      next && !visited.has(next.url);
      next = above.get(next.url)
    ) {
      visited.add(next.url);
      stack.push(next);
    }
    // A stack waits on you when any of its layers does.
    const why = [entry, ...stack].map(yourTurn).find(Boolean);
    const shown = {
      ...row(entry, why),
      ...(stack.length
        ? { stack: stack.map(({ url, number, title }) => ({ url, number, title })) }
        : {}),
    };
    (why ? mine : yours).push(shown);
  }
  return { requests: waiting, mine, yours };
}

/** The page's two lists from the hosts' rows: what waits on you first, review
 * requests and then your own, then the rest of yours, each newest first. */
function mergedRows(hosts: ReturnType<typeof hostRows>[]) {
  const all = (part: "requests" | "mine" | "yours") =>
    hosts.flatMap((rows) => rows[part]).sort(newest);
  return { waiting: [...all("requests"), ...all("mine")], yours: all("yours") };
}

/** The page's two lists from one host's searches: what waits on you first,
 * then your own pull requests; a stack of yours is one row. */
export function inboxRows(viewer: string, requests: SearchNode[], authored: SearchNode[]) {
  return mergedRows([hostRows(viewer, requests, authored)]);
}

/** `repo:` qualifiers in groups that keep each query under GitHub's limit. */
export function searchQueries(base: string, repositories: readonly string[]) {
  if (!repositories.length) return [base];
  const queries: string[] = [];
  let query = base;
  for (const repository of repositories) {
    const next = `${query} repo:${repository}`;
    if (next.length > MAX_QUERY && query !== base) {
      queries.push(query);
      query = `${base} repo:${repository}`;
    } else query = next;
  }
  queries.push(query);
  return queries;
}

export interface PullInboxHost {
  repositories(): RegisteredRepository[];
  gh: { command: string; args: string[] };
  /** Whether a remote's host is GitHub: github.com is; another host is when
   * Settings' Open in says so, or when it answers as GitHub does. */
  isGitHub(host: string): Promise<boolean>;
  /** The state file that keeps the last answer for each scope. */
  file: string;
}

/** Why gh could not read a host, as the page says it; other failures throw. */
function unreadable(error: unknown) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT")
    return "Install the GitHub CLI (gh) and run gh auth login to list pull requests.";
  if (error instanceof ProcessFailure && error.code === "command-failed")
    return (
      error.stderr.trim().split("\n").at(-1)?.replace(/^gh: /, "") || "gh could not search GitHub."
    );
  if (error instanceof ProcessFailure && error.code === "timeout")
    return "GitHub did not answer in 30 seconds.";
  throw error;
}

/** No GitHub host could be read: the answer when Med has no lists to keep. */
class ReadFailure extends Error {
  constructor(readonly answer: PullInbox) {
    super(answer.unavailable);
  }
}

type Scope = PullInbox["scope"];
/** When Med last asked GitHub for an answer, whether or not the read failed. */
const checkedAt = (answer: PullInbox) => Date.parse(answer.failed?.at ?? answer.readAt);

/** Each value, once every search has ended: a host's failed search does not
 * leave its other searches running past the read. The first failure throws. */
async function settled<T>(work: Promise<T>[]) {
  const results = await Promise.allSettled(work);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

export class PullInboxReader {
  /** The last answer for each scope, from the state file at first. */
  private kept: Promise<Map<Scope, PullInbox>> | undefined;
  /** The read of GitHub that runs for each scope, and when it started;
   * requests share it. */
  private reading = new Map<Scope, { at: number; answer: Promise<PullInbox> }>();
  /** Writes of the state file, one at a time. */
  private writing = Promise.resolve();
  constructor(private host: PullInboxHost) {}

  /** The page's pull requests, as `want` asks for them. */
  async read(all: boolean, want: PullInboxWant) {
    const scope: Scope = all ? "all" : "registered";
    const asked = Date.now();
    const last = (await this.answers()).get(scope);
    if (last && (want === "kept" || (want === "fresh" && Date.now() - checkedAt(last) < FRESH_MS)))
      return last;
    // A new read shares only a read that started after it was asked for; it
    // waits for an older one to end.
    for (let running = this.reading.get(scope); running; running = this.reading.get(scope)) {
      if (want !== "new" || running.at >= asked) return running.answer;
      await running.answer.catch(() => {});
    }
    const answer = this.refresh(all).finally(() => {
      if (this.reading.get(scope)?.answer === answer) this.reading.delete(scope);
    });
    this.reading.set(scope, { at: Date.now(), answer });
    return answer;
  }

  private answers() {
    return (this.kept ??= readRecords(this.host.file, (scope, value) => {
      const answer = pullInboxSchema.safeParse(value).data;
      return answer?.scope === scope ? answer : undefined;
    }).then(
      (records) => new Map(Object.entries(records ?? {}) as [Scope, PullInbox][]),
      () => new Map<Scope, PullInbox>(),
    ));
  }

  /** Reads GitHub and keeps the answer. A failed read keeps the last lists,
   * with the time and the reason. */
  private async refresh(all: boolean) {
    const scope: Scope = all ? "all" : "registered";
    const answers = await this.answers();
    let answer: PullInbox;
    try {
      answer = await this.load(all);
    } catch (error) {
      const last = answers.get(scope);
      if (last && !last.unavailable) {
        const reason =
          error instanceof ReadFailure ? error.message : "Med could not read gh's answer.";
        answer = { ...last, failed: { at: new Date().toISOString(), reason } };
      } else if (error instanceof ReadFailure) answer = error.answer;
      else throw error;
    }
    answers.set(scope, answer);
    const text = JSON.stringify(Object.fromEntries(answers));
    // The answer is on disk before the page has it; a failed write costs
    // only the next start's list.
    this.writing = this.writing.then(() => writeStateFile(this.host.file, text)).catch(() => {});
    await this.writing;
    return answer;
  }

  private async run(command: string, args: string[], cwd: string) {
    const { stdout } = await runProcess(command, args, {
      cwd,
      timeoutMs: 30_000,
      maxBytes: 16 * 1024 * 1024,
      env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
    });
    return stdout.toString("utf8");
  }

  /** owner/name of each registered repository's GitHub remotes, by host. */
  private async gitHubRepositories() {
    const byHost = new Map<string, Set<string>>();
    const verdicts = new Map<string, Promise<boolean>>();
    const isGitHub = (host: string) => {
      let verdict = verdicts.get(host);
      if (!verdict) {
        verdict = this.host.isGitHub(host).catch(() => false);
        verdicts.set(host, verdict);
      }
      return verdict;
    };
    await Promise.all(
      this.host.repositories().map(async (repository) => {
        const remotes = await this.run("git", ["remote", "-v"], repository.path).catch(() => "");
        for (const line of remotes.split("\n")) {
          const remote = parseRemote(line.split(/\s+/)[1] ?? "");
          if (!remote || !(await isGitHub(remote.host))) continue;
          const names = byHost.get(remote.host) ?? new Set();
          names.add(`${remote.owner}/${remote.repo}`.toLowerCase());
          byHost.set(remote.host, names);
        }
      }),
    );
    return new Map(
      [...byHost]
        .sort(([a], [b]) => (a === "github.com" ? -1 : b === "github.com" ? 1 : a.localeCompare(b)))
        .map(([host, names]) => [host, [...names].sort()]),
    );
  }

  private async search(host: string, query: string) {
    const { command, args } = this.host.gh;
    const output = await this.run(
      command,
      [
        ...args,
        "api",
        "graphql",
        ...(host === "github.com" ? [] : ["--hostname", host]),
        "-f",
        `query=${SEARCH}`,
        "-f",
        `q=${query}`,
      ],
      tmpdir(),
    );
    const { data } = answer.parse(JSON.parse(output));
    // An issue in the results has none of a pull request's fields.
    const nodes = data.search.nodes.flatMap((entry) => {
      const parsed = node.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    return { viewer: data.viewer.login, nodes };
  }

  private async load(all: boolean): Promise<PullInbox> {
    const scope = all ? "all" : "registered";
    const readAt = new Date().toISOString();
    const byHost = await this.gitHubRepositories();
    // All of GitHub: github.com, and each other GitHub host that a remote
    // names, with no repository qualifiers.
    const searched: [string, string[]][] = all
      ? [
          ["github.com", []],
          ...[...byHost.keys()]
            .filter((host) => host !== "github.com")
            .map((host): [string, string[]] => [host, []]),
        ]
      : [...byHost];
    const repositories = all
      ? []
      : searched.flatMap(([host, names]) =>
          names.map((name) => (host === "github.com" ? name : `${host}/${name}`)),
        );
    const empty: PullInbox = { viewer: "", scope, repositories, waiting: [], yours: [], readAt };
    if (!all && !repositories.length)
      return {
        ...empty,
        unavailable: "No registered repository has a GitHub remote. Show all of GitHub instead.",
      };
    const base = "is:pr is:open archived:false";
    const read = async (host: string, names: string[]) => {
      const each = (qualifier: string) =>
        settled(
          searchQueries(`${base} ${qualifier}`, names).map((query) => this.search(host, query)),
        );
      const [requests, authored] = await settled([
        each("review-requested:@me"),
        each("author:@me"),
      ]);
      const viewer = requests[0]?.viewer ?? authored[0]?.viewer ?? "";
      return {
        viewer,
        rows: hostRows(
          viewer,
          requests.flatMap((result) => result.nodes),
          authored.flatMap((result) => result.nodes),
        ),
      };
    };
    const results = await Promise.allSettled(searched.map(([host, names]) => read(host, names)));
    const skipped = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ host: searched[index]![0], reason: unreadable(result.reason) }]
        : [],
    );
    const done = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (!done.length) throw new ReadFailure({ ...empty, unavailable: skipped[0]!.reason });
    return {
      ...empty,
      viewer: done[0]!.viewer,
      ...mergedRows(done.map((entry) => entry.rows)),
      ...(skipped.length ? { skipped } : {}),
    };
  }
}
