import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import type {
  GitHubBudget,
  LivePullRequest,
  PullRequestCheck,
  PullRequestCheckLog,
  PullRequestCheckOutcome,
  PullRequestReviewer,
} from "../../shared/protocol";
import { HostError } from "../runtime/errors";
import { ProcessFailure } from "../runtime/process";
import { gh, ghApi, graphQl, pullRequestPlace, sharedReads } from "./pull-request";

// A pull request as GitHub has it now, for the Pull request tab. Each read is
// a GET with gh, on the reader's sign-in; this file writes nothing to GitHub.
// gh prints what GitHub's API gives, so GitHub's words stay plain strings: a
// new value shows as itself and does not break the tab.

const FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "body",
  "author",
  "baseRefName",
  "headRefName",
  "headRepositoryOwner",
  "isCrossRepository",
  "labels",
  "latestReviews",
  "reviewRequests",
  "reviewDecision",
  "mergeable",
  "mergeStateStatus",
  "mergedBy",
  "mergedAt",
  "closedAt",
].join(",");

const person = z.object({ login: z.string() }).nullish();
const view = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  body: z.string().nullish(),
  author: person,
  baseRefName: z.string(),
  headRefName: z.string(),
  headRepositoryOwner: person,
  isCrossRepository: z.boolean().nullish(),
  labels: z.array(z.object({ name: z.string(), color: z.string().nullish() })).nullish(),
  latestReviews: z.array(z.object({ author: person, state: z.string() })).nullish(),
  reviewRequests: z
    .array(
      z.object({
        __typename: z.string().nullish(),
        login: z.string().nullish(),
        slug: z.string().nullish(),
        name: z.string().nullish(),
      }),
    )
    .nullish(),
  reviewDecision: z.string().nullish(),
  mergeable: z.string().nullish(),
  mergeStateStatus: z.string().nullish(),
  mergedBy: person,
  mergedAt: z.string().nullish(),
  closedAt: z.string().nullish(),
});

const CHECK_FIELDS = "name,workflow,event,state,startedAt,completedAt,link";
// A check run, or a commit status that another service set: gh gives both the
// same fields, and leaves out what a run of the same check replaced, as
// GitHub does. A status has no workflow, and no end.
const checkList = z.array(
  z.object({
    name: z.string(),
    workflow: z.string().nullish(),
    event: z.string().nullish(),
    state: z.string(),
    startedAt: z.string().nullish(),
    completedAt: z.string().nullish(),
    link: z.string().nullish(),
  }),
);
type CheckEntry = z.infer<typeof checkList>[number];

/** gh prints a time that GitHub left empty as Go's zero time. */
const timeOf = (value: string | null | undefined) =>
  value && !value.startsWith("0001-") ? value : null;
/** A service can link anything from its status; only web links are links. */
const webLink = (value: string | null | undefined) =>
  value && /^https?:\/\//i.test(value) ? value : undefined;

function outcomeOf(state: string): PullRequestCheckOutcome {
  switch (state) {
    case "SUCCESS":
      return "passed";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipped";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failed";
    case "CANCELLED":
    case "STALE":
      return "cancelled";
    default:
      return "pending";
  }
}

const ORDER: PullRequestCheckOutcome[] = ["failed", "pending", "cancelled", "passed", "skipped"];

function toCheck(entry: CheckEntry, jobLink: RegExp, twin: boolean): PullRequestCheck {
  const { name, state } = entry;
  const workflow = entry.workflow || undefined;
  const outcome = outcomeOf(state);
  const url = webLink(entry.link);
  const job = outcome === "failed" ? jobLink.exec(url ?? "")?.[1] : undefined;
  return {
    // The link tells a check run from a status of the same name, and a new run
    // of a job from the one before it.
    id: `${workflow ?? ""}/${name}/${entry.event ?? ""}/${entry.link ?? ""}`,
    name,
    ...(workflow ? { workflow } : {}),
    ...(twin && entry.event ? { event: entry.event } : {}),
    outcome,
    state,
    startedAt: timeOf(entry.startedAt),
    completedAt: timeOf(entry.completedAt),
    ...(url ? { url } : {}),
    ...(job ? { job: Number(job) } : {}),
  };
}

/** Failures first, and each group keeps one order from read to read. A check
 * that runs for two triggers, as a push and a pull request, is two rows, each
 * with its trigger, so a pass does not hide a failure. */
function checksOf(entries: CheckEntry[], jobLink: RegExp) {
  const place = (entry: CheckEntry) => `${entry.workflow ?? ""}/${entry.name}`;
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(place(entry), (counts.get(place(entry)) ?? 0) + 1);
  return entries
    .map((entry) => toCheck(entry, jobLink, counts.get(place(entry))! > 1))
    .sort(
      (a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || a.id.localeCompare(b.id),
    );
}

/** A branch with no checks is an error to gh, and to Med a list with none. */
async function readChecks(url: string) {
  const text = await gh(["pr", "checks", url, "--json", CHECK_FIELDS], {
    timeoutMs: 30_000,
  }).catch((error: unknown) => {
    if (error instanceof Error && /no checks reported/.test(error.message)) return "[]";
    throw error;
  });
  return checkList.parse(JSON.parse(text));
}

/** Whom it asks for a review, then who gave one. A review that it asks for
 * again counts as asked: GitHub shows it the same way. */
function reviewersOf(data: z.infer<typeof view>) {
  const reviewers: PullRequestReviewer[] = (data.reviewRequests ?? []).flatMap((entry) => {
    const team = entry.__typename === "Team";
    const name = team ? entry.slug || entry.name : entry.login;
    return name ? [{ name, state: "REQUESTED", ...(team ? { team } : {}) }] : [];
  });
  const asked = new Set(reviewers.map((reviewer) => reviewer.name));
  for (const review of data.latestReviews ?? []) {
    const name = review.author?.login;
    if (name && !asked.has(name) && review.state !== "PENDING")
      reviewers.push({ name, state: review.state });
  }
  return reviewers;
}

const refPath = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

/** The base's commits that the head lacks. Only GitHub's own comparison can
 * say: its merge state says BEHIND only where a branch rule asks for that. */
async function behindBy(host: string, base: string, data: z.infer<typeof view>) {
  const owner = data.headRepositoryOwner?.login;
  if (data.state !== "OPEN" || !owner) return undefined;
  const path = `${base}/compare/${refPath(data.baseRefName)}...${encodeURIComponent(owner)}:${refPath(data.headRefName)}?per_page=1`;
  return ghApi(host, [path, "--jq", ".behind_by"]).then(
    (text) => Number(text.trim()),
    // A deleted branch or fork: the rest of the pull request still reads.
    () => undefined,
  );
}

const rateLimit = z.object({
  core: z.object({ limit: z.number(), remaining: z.number(), reset: z.number() }),
  graphql: z.object({ limit: z.number(), remaining: z.number(), reset: z.number() }),
});

/** What the sign-in has left of GitHub's limits. Asking uses none of them. */
async function budgetOf(host: string): Promise<GitHubBudget | undefined> {
  return (
    ghApi(host, ["rate_limit", "--jq", ".resources | {core, graphql}"])
      .then((text) => {
        const { core, graphql } = rateLimit.parse(JSON.parse(text));
        const low =
          core.remaining / core.limit <= graphql.remaining / graphql.limit ? core : graphql;
        return { remaining: low.remaining, limit: low.limit, resetAt: low.reset * 1000 };
      })
      // A GitHub Enterprise server can have no limits, or other ones.
      .catch(() => undefined)
  );
}

async function load(url: string): Promise<LivePullRequest> {
  const { host, owner, repo } = pullRequestPlace(url);
  const base = `repos/${owner}/${repo}`;
  const [data, checks, budget] = await Promise.all([
    gh(["pr", "view", url, "--json", FIELDS], { timeoutMs: 30_000 }).then((text) =>
      view.parse(JSON.parse(text)),
    ),
    readChecks(url),
    budgetOf(host),
  ]);
  const behind = await behindBy(host, base, data);
  const merged = data.state === "MERGED";
  const closed = data.state === "CLOSED";
  const jobLink = new RegExp(
    `^https://${host.replace(/\./g, "\\.")}/${owner}/${repo}/actions/runs/\\d+/job/(\\d+)`,
    "i",
  );
  return {
    url: data.url,
    number: data.number,
    title: data.title,
    author: data.author?.login || "ghost",
    state: merged ? "merged" : closed ? "closed" : data.isDraft ? "draft" : "open",
    body: data.body ?? "",
    base: data.baseRefName,
    head:
      data.isCrossRepository && data.headRepositoryOwner
        ? `${data.headRepositoryOwner.login}:${data.headRefName}`
        : data.headRefName,
    labels: (data.labels ?? []).map(({ name, color }) => ({
      name,
      ...(color && /^[0-9a-f]{6}$/i.test(color) ? { color } : {}),
    })),
    checks: checksOf(checks, jobLink),
    reviewers: reviewersOf(data),
    merge: {
      mergeable: data.mergeable || "UNKNOWN",
      status: data.mergeStateStatus || "UNKNOWN",
      decision: data.reviewDecision || null,
      ...(behind !== undefined && !Number.isNaN(behind) ? { behindBy: behind } : {}),
      ...(data.mergedBy?.login ? { mergedBy: data.mergedBy.login } : {}),
      ...(merged && data.mergedAt ? { endedAt: data.mergedAt } : {}),
      ...(closed && data.closedAt ? { endedAt: data.closedAt } : {}),
    },
    ...(budget ? { budget } : {}),
    fetchedAt: Date.now(),
  };
}

/** A pull request as GitHub has it, read again after 30 seconds or on request. */
export const loadLivePullRequest = sharedReads(load);

const LOG_LINES = 200;
const STAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;

/**
 * The end of a failed job's log, for one that the reader opens. gh prints
 * `job<TAB>step<TAB>time text`. It downloads the run's logs to do that, so
 * Med asks only on request.
 */
export async function readCheckLog(url: string, job: number): Promise<PullRequestCheckLog> {
  const { host, owner, repo } = pullRequestPlace(url);
  const log = await gh(
    ["run", "view", "--job", String(job), "--log-failed", "-R", `${host}/${owner}/${repo}`],
    { timeoutMs: 90_000, maxBytes: 64 * 1024 * 1024 },
  ).catch((error: unknown) => {
    const text = error instanceof Error ? error.message : "";
    if (/still in progress/i.test(text))
      throw new HostError("log-not-ready", "GitHub gives this log when the job ends.", 409);
    if (/HTTP 410/.test(text))
      throw new HostError("log-gone", "GitHub no longer has this log.", 410);
    if (error instanceof ProcessFailure && error.code === "output-too-large")
      throw new HostError("log-too-long", "This log is too long for Med. Open it on GitHub.", 413);
    throw error;
  });
  const lines = log
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      return stripVTControlCharacters(
        fields.length > 2 ? fields.slice(2).join("\t") : line,
      ).replace(STAMP, "");
    });
  const skipped = Math.max(0, lines.length - LOG_LINES);
  return { text: lines.slice(skipped).join("\n"), skipped };
}

// Images in a description. Med's page loads images only from itself, and
// GitHub keeps attachments behind sign-in, so a browser cannot show them from
// the Markdown's own URLs. GitHub's rendered description holds a link for
// each image: a signed one for an attachment, good for 5 minutes, and its
// own proxy for an image on any other site. The host fetches that link.
const IMAGE_FRESH_MS = 4 * 60_000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)$/;
/** The ID in an attachment's URL, which the signed link also holds. */
const ASSET = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
const bodyHtml = z.object({
  repository: z.object({ pullRequest: z.object({ bodyHTML: z.string() }) }),
});
const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&amp;/g, "&");

const descriptionImages = sharedReads(async (url) => {
  const { host, owner, repo, number } = pullRequestPlace(url);
  const html = bodyHtml.parse(
    await graphQl(
      host,
      "query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { bodyHTML } } }",
      { owner, repo, number: Number(number) },
    ),
  ).repository.pullRequest.bodyHTML;
  const links = new Map<string, string>();
  for (const [tag] of html.matchAll(/<img\s[^>]*>/g)) {
    const src = attribute(tag, "src");
    if (!src) continue;
    links.set(src, src);
    const canonical = attribute(tag, "data-canonical-src");
    if (canonical) links.set(canonical, src);
    const asset = ASSET.exec(src)?.[0];
    if (asset) links.set(asset.toLowerCase(), src);
  }
  return links;
}, IMAGE_FRESH_MS);

const signedLink = (links: Map<string, string>, src: string) =>
  links.get(src) ?? links.get(ASSET.exec(src)?.[0]?.toLowerCase() ?? "");

/** A link as a URL, when it is on GitHub. */
function githubLink(link: string, host: string) {
  const target = URL.canParse(link) ? new URL(link) : undefined;
  return target?.protocol === "https:" &&
    (target.hostname === host || /(?:^|\.)githubusercontent\.com$/.test(target.hostname))
    ? target
    : undefined;
}

/** A link on github.com can redirect, as a raw file does; each step stays on GitHub. */
async function fetchImage(target: URL, host: string, redirects = 3): Promise<Response | undefined> {
  const response = await fetch(target, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
  const location = response?.headers.get("location");
  if (!response || response.status < 300 || response.status >= 400 || !location) return response;
  await response.body?.cancel();
  const next = URL.canParse(location, target) && new URL(location, target);
  const allowed = next && githubLink(next.href, host);
  return redirects && allowed ? fetchImage(allowed, host, redirects - 1) : undefined;
}

/**
 * An image that the pull request's description shows, by the URL in its
 * Markdown. Med fetches only what GitHub rendered, and only from GitHub, so
 * this route cannot read another address for a page.
 */
export async function loadDescriptionImage(url: string, src: string) {
  const { host } = pullRequestPlace(url);
  const link =
    signedLink(await descriptionImages(url), src) ??
    // The description can have changed since the last read.
    signedLink(await descriptionImages(url, true), src);
  const target = link ? githubLink(link, host) : undefined;
  if (!target) throw new HostError("invalid-image", "The description has no such image.", 404);
  const response = await fetchImage(target, host);
  const mime = response?.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!response?.ok || !IMAGE_TYPES.test(mime))
    throw new HostError("image-unavailable", "GitHub did not give this image.", 502);
  const tooLarge = () => new HostError("image-too-large", "This image is too large for Med.", 413);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw tooLarge();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw tooLarge();
  return { bytes, mime };
}
