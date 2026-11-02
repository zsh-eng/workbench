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
  "statusCheckRollup",
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
  // A check run, or a commit status that another service set.
  statusCheckRollup: z
    .array(
      z.object({
        __typename: z.string().nullish(),
        name: z.string().nullish(),
        workflowName: z.string().nullish(),
        status: z.string().nullish(),
        conclusion: z.string().nullish(),
        startedAt: z.string().nullish(),
        completedAt: z.string().nullish(),
        detailsUrl: z.string().nullish(),
        context: z.string().nullish(),
        state: z.string().nullish(),
        targetUrl: z.string().nullish(),
      }),
    )
    .nullish(),
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
type Rollup = NonNullable<z.infer<typeof view>["statusCheckRollup"]>[number];

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

function toCheck(entry: Rollup, jobLink: RegExp): PullRequestCheck {
  const name = entry.name || entry.context || "Check";
  const workflow = entry.workflowName || undefined;
  // A check run ends with a conclusion; a commit status has only its state.
  const state =
    entry.state || (entry.status === "COMPLETED" ? entry.conclusion : entry.status) || "PENDING";
  const outcome = outcomeOf(state);
  const url = webLink(entry.detailsUrl ?? entry.targetUrl);
  const job = outcome === "failed" ? jobLink.exec(url ?? "")?.[1] : undefined;
  return {
    id: `${workflow ?? ""}/${name}`,
    name,
    ...(workflow ? { workflow } : {}),
    outcome,
    state,
    startedAt: timeOf(entry.startedAt),
    completedAt: timeOf(entry.completedAt),
    ...(url ? { url } : {}),
    ...(job ? { job: Number(job) } : {}),
  };
}

/**
 * A workflow that a label or a new trigger starts again adds its checks once
 * more for the same commit, so GitHub's list can hold one check many times.
 * The last run is the one that counts; a run that has not started is the last.
 * Failures come first, and each group keeps one order from read to read.
 */
function latestChecks(checks: PullRequestCheck[]) {
  const started = (check: PullRequestCheck) =>
    check.startedAt ? Date.parse(check.startedAt) : Number.POSITIVE_INFINITY;
  const latest = new Map<string, PullRequestCheck>();
  for (const check of checks) {
    const kept = latest.get(check.id);
    if (!kept || started(check) >= started(kept)) latest.set(check.id, check);
  }
  return [...latest.values()].sort(
    (a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || a.id.localeCompare(b.id),
  );
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
  return ghApi(host, ["rate_limit", "--jq", ".resources | {core, graphql}"]).then(
    (text) => {
      const { core, graphql } = rateLimit.parse(JSON.parse(text));
      const low = core.remaining / core.limit <= graphql.remaining / graphql.limit ? core : graphql;
      return { remaining: low.remaining, limit: low.limit, resetAt: low.reset * 1000 };
    },
    // A GitHub Enterprise server can have no limits.
    () => undefined,
  );
}

async function load(url: string): Promise<LivePullRequest> {
  const { host, owner, repo } = pullRequestPlace(url);
  const base = `repos/${owner}/${repo}`;
  const [data, budget] = await Promise.all([
    gh(["pr", "view", url, "--json", FIELDS], { timeoutMs: 30_000 }).then((text) =>
      view.parse(JSON.parse(text)),
    ),
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
    checks: latestChecks((data.statusCheckRollup ?? []).map((entry) => toCheck(entry, jobLink))),
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
  const target = link && URL.canParse(link) ? new URL(link) : undefined;
  if (
    target?.protocol !== "https:" ||
    !(target.hostname === host || /(?:^|\.)githubusercontent\.com$/.test(target.hostname))
  )
    throw new HostError("invalid-image", "The description has no such image.", 404);
  const response = await fetch(target, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
  const mime = response?.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!response?.ok || !IMAGE_TYPES.test(mime))
    throw new HostError("image-unavailable", "GitHub did not give this image.", 502);
  const tooLarge = () => new HostError("image-too-large", "This image is too large for Med.", 413);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw tooLarge();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw tooLarge();
  return { bytes, mime };
}
