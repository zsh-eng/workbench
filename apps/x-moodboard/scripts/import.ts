// Validate an X archive snapshot and adopt it as the app's library.
//
//   bun scripts/import.ts [--source DIR] [--library DIR] [--deep] [--force]
//
// The source folder is read-only. Output goes to the library folder:
//   snapshots/<version>/   immutable projection, details and media allowlist
//   derived/               rebuildable WebP thumbnails and video frames
//   current.json           pointer to the adopted snapshot (atomic rename)
// A failed validation keeps the current snapshot.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import {
  FORMATS,
  SCHEMA_VERSION,
  STATES,
  TOPICS,
  type ContentState,
  type Format,
  type ImageAsset,
  type ItemDetail,
  type LibraryItem,
  type LibraryProjection,
  type Media,
  type MediaRole,
  type TextState,
  type Topic,
  type VideoMedia,
} from "../shared/schema.ts";

const APP_DIR = resolve(import.meta.dir, "..");
const THUMB_WIDTHS = [320, 640, 960];
const FRAME_MAX_WIDTH = 1280;
const KEEP_SNAPSHOTS = 3;

// ---------------------------------------------------------------- arguments

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const libraryDir = resolve(arg("library") ?? process.env.XMB_LIBRARY ?? join(APP_DIR, "library.local"));
const deep = flag("deep");
const force = flag("force");
const concurrency = Math.max(1, Number(arg("concurrency") ?? 2));

async function resolveSource(): Promise<string> {
  const explicit = arg("source") ?? process.env.XMB_SOURCE;
  if (explicit) return resolve(explicit);
  const configPath = join(libraryDir, "config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { sourcePath?: string };
    if (config.sourcePath) return config.sourcePath;
  }
  throw new Error(
    "No source folder. Pass --source <folder containing dataset.json> (it is remembered for later refreshes).",
  );
}

// ---------------------------------------------------------------- source types

interface SourceMedia {
  kind: string;
  role: string;
  status: string;
  relative_path?: string;
  sha256?: string;
  bytes?: number;
  width?: number;
  height?: number;
  alt_text?: string;
  observed_url?: string;
  observed_source_url?: string;
  source_url?: string;
  source_post_url?: string;
  media_id?: string;
  duration?: number;
  reason?: string;
  probe?: { streams?: { codec_type?: string }[] };
  captions?: { relative_path?: string; sha256?: string; bytes?: number; language?: string; status?: string }[];
}

interface SourceItem {
  id: string;
  post_id: string;
  post_url: string;
  author: string;
  author_name?: string | null;
  post_date?: string | null;
  source_types: string[];
  provenance: { source_type: string; retrieval_order?: number }[];
  text: string;
  text_status: string;
  text_expansion_status?: string;
  text_completeness?: string;
  topics: string[];
  subtags: Record<string, string[]>;
  topic_confidence: string;
  topic_review_required: boolean;
  media: SourceMedia[];
  review_reasons: string[];
  article_content_status?: string;
  image_capture_status?: string;
  public_extraction?: { status?: string; extractor?: string };
  signed_in_review?: { retrieved_at?: string };
  snippet_summary?: { text: string; label: string; basis: string };
  topic_basis?: string;
  local_topic_review?: { basis?: string };
}

interface SourceDataset {
  schema_version: string;
  generated_at?: string;
  taxonomy: Record<string, string[]>;
  items: SourceItem[];
}

interface ManifestEntry {
  relative_path: string;
  kind: string;
  bytes: number;
  sha256: string;
}

// ---------------------------------------------------------------- helpers

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const rev = (sha256: string) => sha256.slice(0, 16);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
async function readOptionalJson<T>(path: string): Promise<T | null> {
  return existsSync(path) ? readJson<T>(path) : null;
}

async function writeAtomic(path: string, data: string | Uint8Array) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

function handleFromUrl(url: string | undefined | null): string | null {
  const match = url?.match(/x\.com\/([^/]+)\/status\//i) ?? url?.match(/twitter\.com\/([^/]+)\/status\//i);
  return match ? match[1] : null;
}
function samePost(a: string | undefined | null, b: string | undefined | null) {
  return !!a && !!b && a.toLowerCase().replace(/\/$/, "") === b.toLowerCase().replace(/\/$/, "");
}

/** Run tasks with a fixed limit, so the machine stays usable. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function run(cmd: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, stdout, stderr };
}

let progressLine = "";
function progress(label: string, done: number, total: number) {
  const line = `${label} ${done}/${total}`;
  if (line === progressLine) return;
  progressLine = line;
  if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
  else if (done === total || done % 200 === 0) console.log(line);
  if (done === total && process.stdout.isTTY) process.stdout.write("\n");
}

// ---------------------------------------------------------------- validation

class ValidationError extends Error {}

async function readSourceStable(source: string) {
  const datasetPath = join(source, "dataset.json");
  const manifestPath = join(source, "assets-manifest.json");
  for (const path of [datasetPath, manifestPath]) {
    if (!existsSync(path)) throw new ValidationError(`Missing ${basename(path)} in ${source}`);
  }
  const before = await Promise.all([stat(datasetPath), stat(manifestPath)]);
  const [dataset, manifest] = await Promise.all([
    readJson<SourceDataset>(datasetPath),
    readJson<{ assets: ManifestEntry[] }>(manifestPath),
  ]);
  const after = await Promise.all([stat(datasetPath), stat(manifestPath)]);
  for (let i = 0; i < before.length; i++) {
    if (before[i].mtimeMs !== after[i].mtimeMs || before[i].size !== after[i].size) {
      throw new ValidationError("The source changed while it was read. Wait for the writer to finish, then import again.");
    }
  }
  // A writer that has just replaced the files may still be updating siblings.
  const settledFor = Date.now() - Math.max(before[0].mtimeMs, before[1].mtimeMs);
  if (settledFor < 5_000) {
    throw new ValidationError("The source changed less than 5 seconds ago. Import again when it is stable.");
  }
  const unresolved = (await readOptionalJson<Record<string, string[]>>(join(source, "unresolved-cases.json"))) ?? {};
  const validation = await readOptionalJson<Record<string, unknown>>(join(source, "validation.json"));
  const signedIn =
    (await readOptionalJson<
      { post_url: string; text?: string; text_complete?: boolean; quoted_texts?: string[]; quotes?: { post_url: string; text: string }[] }[]
    >(join(source, "signed-in-evidence.json"))) ?? [];
  const articleReview =
    (await readOptionalJson<{ post_url: string; summary?: string; reason?: string }[]>(
      join(source, "native-article-review.json"),
    )) ?? [];
  return { dataset, manifest, unresolved, validation, signedIn, articleReview, datasetMtime: before[0].mtime };
}

function validateDataset(dataset: SourceDataset, validation: Record<string, unknown> | null) {
  const problems: string[] = [];
  if (!dataset || !Array.isArray(dataset.items)) problems.push("dataset.json has no items array");
  if (validation) {
    for (const key of ["stable_catalogue_ids_preserved", "private_telegram_utilities_excluded"]) {
      if (validation[key] === false) problems.push(`validation.json reports ${key} = false`);
    }
  }
  const ids = new Set<string>();
  const postIds = new Set<string>();
  for (const item of dataset.items ?? []) {
    if (!item.id || !item.post_id || !item.post_url) problems.push(`Item without id/post_id/post_url: ${item.id}`);
    if (ids.has(item.id)) problems.push(`Duplicate id ${item.id}`);
    if (postIds.has(item.post_id)) problems.push(`Duplicate post_id ${item.post_id}`);
    ids.add(item.id);
    postIds.add(item.post_id);
  }
  const bookmarks = (dataset.items ?? []).filter((item) => item.source_types?.includes("x-bookmarks"));
  if (bookmarks.length === 0) problems.push("No item has source type x-bookmarks");
  if (problems.length) throw new ValidationError(problems.slice(0, 12).join("\n"));
  return bookmarks;
}

// ---------------------------------------------------------------- assets

interface AssetCheck {
  ok: boolean;
  reason?: string;
}

async function checkFiles(source: string, manifest: ManifestEntry[], referenced: Set<string>) {
  const byPath = new Map(manifest.map((entry) => [entry.relative_path, entry]));
  const results = new Map<string, AssetCheck>();
  const paths = [...referenced];
  let done = 0;
  await pool(
    paths.map((relative) => async () => {
      const entry = byPath.get(relative);
      const absolute = safeJoin(source, relative);
      let result: AssetCheck = { ok: true };
      if (!entry) result = { ok: false, reason: "Not listed in the validated asset manifest" };
      else if (!absolute || !existsSync(absolute)) result = { ok: false, reason: "File is missing from the local archive" };
      else {
        const info = await stat(absolute);
        if (info.size !== entry.bytes) result = { ok: false, reason: "File size does not match the manifest" };
        else if (entry.kind !== "video" || deep) {
          const digest = createHash("sha256");
          for await (const chunk of Bun.file(absolute).stream()) digest.update(chunk);
          if (digest.digest("hex") !== entry.sha256) result = { ok: false, reason: "File hash does not match the manifest" };
        }
      }
      results.set(relative, result);
      progress("Checking files", ++done, paths.length);
    }),
    4,
  );
  return { results, byPath };
}

function safeJoin(root: string, relative: string): string | null {
  if (isAbsolute(relative) || relative.includes("\0")) return null;
  const full = normalize(join(root, relative));
  return full.startsWith(normalize(root) + "/") ? full : null;
}

// ---------------------------------------------------------------- projection

function textState(item: SourceItem, sets: Record<string, Set<string>>, verified: Set<string>): TextState {
  if (item.article_content_status) return "article";
  if (sets.timeline_text_still_truncated?.has(item.post_url) || item.text_status === "timeline-truncated") return "truncated";
  if (sets.long_post_completeness_unverified?.has(item.post_url)) return "unverified";
  if (item.text_expansion_status === "signed-in-detail-view-complete" || verified.has(item.post_url)) return "verified";
  return "captured";
}

const TEXT_SOURCE: Record<string, string> = {
  "visible-post-text": "Post text as shown in X bookmarks",
  "public-extractor-text": "Public post metadata, read without signing in",
  "signed-in-post-text": "Signed-in post view",
  "timeline-truncated": "X bookmarks timeline, which cut the text short",
};

const REVIEW_REASON: Record<string, string> = {
  "timeline-text-truncated": "Long text may be incomplete",
  "visual-or-short-post-needs-topic-review": "Short or visual post; topics need review",
  "insufficient-post-topic-context": "Not enough text to choose topics confidently",
};

interface BuildContext {
  source: string;
  checks: Map<string, AssetCheck>;
  manifest: Map<string, ManifestEntry>;
  unresolved: Record<string, Set<string>>;
  verified: Set<string>;
  quotedTexts: Map<string, { url: string | null; text: string }[]>;
  articleReview: Map<string, { summary?: string; reason?: string }>;
  frames: Map<string, string>;
}

function imageAsset(media: SourceMedia, ctx: BuildContext): ImageAsset | null {
  const path = media.relative_path;
  if (!path || media.status !== "downloaded" || !ctx.checks.get(path)?.ok) return null;
  const entry = ctx.manifest.get(path)!;
  return {
    path,
    rev: rev(entry.sha256),
    w: media.width ?? 0,
    h: media.height ?? 0,
    thumbs: [],
    tone: null,
  };
}

/** Key that links a poster image to its video, from X media URLs. */
function videoKey(url: string | undefined): string | null {
  if (!url) return null;
  const match =
    url.match(/(?:amplify_video_thumb|ext_tw_video_thumb|amplify_video|ext_tw_video)\/(\d+)/) ??
    url.match(/tweet_video(?:_thumb)?\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function projectItem(item: SourceItem, ctx: BuildContext) {
  const notes: string[] = [];
  const role = (m: SourceMedia): MediaRole =>
    m.role === "quoted-post-image" ? "quoted" : m.role === "link-preview" ? "link-preview" : "post";
  const sourcePost = (m: SourceMedia) =>
    m.source_post_url && !samePost(m.source_post_url, item.post_url) ? m.source_post_url : null;

  // Pair video files with their posters. A poster alone never counts as a video.
  const videos = new Map<string, VideoMedia>();
  const slots: { media: Media; key?: string }[] = [];
  const pendingPosters: { media: SourceMedia; key: string | null }[] = [];
  let resolvedPlaceholders = 0;
  const hasDownloadedImage = item.media.some((m) => m.kind === "image" && m.status === "downloaded");
  const photoReviewOpen = ctx.unresolved.photo_capture_review?.has(item.post_url) ?? false;

  for (const m of item.media) {
    if (m.kind === "video") {
      const path = m.relative_path;
      const check = path ? ctx.checks.get(path) : undefined;
      if (m.status !== "downloaded" || !path || !check?.ok) {
        slots.push({
          media: {
            kind: "missing",
            role: role(m),
            expected: "video",
            reason: check?.reason ?? m.reason ?? "The video was not saved locally",
          },
        });
        continue;
      }
      const entry = ctx.manifest.get(path)!;
      const audio = m.probe?.streams?.some((s) => s.codec_type === "audio") ?? true;
      const gif = /tweet_video\//.test(m.observed_source_url ?? "");
      const captions = (m.captions ?? [])
        .filter((c) => c.relative_path && c.status !== "failed" && ctx.checks.get(c.relative_path)?.ok)
        .map((c) => ({
          lang: c.language ?? "en",
          path: c.relative_path!,
          rev: rev(ctx.manifest.get(c.relative_path!)!.sha256),
        }));
      const media: VideoMedia = {
        kind: "video",
        role: role(m),
        video: {
          path,
          rev: rev(entry.sha256),
          w: m.width ?? 0,
          h: m.height ?? 0,
          duration: m.duration ?? 0,
          audio,
          gif,
          bytes: entry.bytes,
          captions,
        },
        poster: null,
        sourcePost: sourcePost(m),
      };
      const key = videoKey(m.observed_source_url) ?? m.media_id ?? null;
      if (key) videos.set(key, media);
      slots.push({ media, key: key ?? undefined });
    } else if (m.role === "video-poster") {
      pendingPosters.push({ media: m, key: videoKey(m.observed_url ?? m.observed_source_url) });
    } else if (m.status !== "downloaded") {
      // An early capture recorded a placeholder for a photo it could not save.
      // A later signed-in pass saved the observed photo set; the placeholder is then resolved.
      if (
        item.image_capture_status === "signed-in-observed-photo-set-downloaded" &&
        hasDownloadedImage &&
        !photoReviewOpen
      ) {
        resolvedPlaceholders++;
        continue;
      }
      slots.push({
        media: { kind: "missing", role: role(m), expected: "photo", reason: m.reason ?? "The photo was not saved locally" },
      });
    } else {
      const image = imageAsset(m, ctx);
      if (!image) {
        slots.push({
          media: {
            kind: "missing",
            role: role(m),
            expected: "photo",
            reason: ctx.checks.get(m.relative_path ?? "")?.reason ?? "The photo was not saved locally",
          },
        });
        continue;
      }
      const alt = m.alt_text && m.alt_text !== "Image" ? m.alt_text : null;
      slots.push({ media: { kind: "photo", role: role(m), image, alt, sourcePost: sourcePost(m) } });
    }
  }

  // Attach posters. An unmatched poster pairs with the only unmatched video, if there is one.
  const unmatched = () => [...videos.values()].filter((v) => !v.poster);
  for (const { media, key } of pendingPosters) {
    const poster = imageAsset(media, ctx);
    let target = key ? videos.get(key) : undefined;
    if (!target && unmatched().length === 1 && pendingPosters.length === 1) target = unmatched()[0];
    if (target && !target.poster) {
      target.poster = poster;
      continue;
    }
    slots.push({ media: { kind: "video", role: role(media), video: null, poster, sourcePost: sourcePost(media) } });
  }
  for (const video of videos.values()) {
    if (!video.poster && video.video) {
      const frame = ctx.frames.get(video.video.rev);
      if (frame) {
        video.poster = { path: frame, rev: video.video.rev, w: video.video.w, h: video.video.h, thumbs: [], tone: null, derivedFrame: true };
        notes.push("The video thumbnail is a frame taken from the saved video.");
      }
    }
  }
  if (resolvedPlaceholders) {
    notes.push(
      resolvedPlaceholders === 1
        ? "An early photo placeholder was resolved when the signed-in review saved the photo set."
        : `${resolvedPlaceholders} early photo placeholders were resolved when the signed-in review saved the photo set.`,
    );
  }

  // Post media first, then quoted media, then link previews.
  const order: Record<MediaRole, number> = { post: 0, quoted: 1, "link-preview": 2 };
  const media = slots.map((s) => s.media).sort((a, b) => order[a.role] - order[b.role]);

  const visual = media.filter((m) => m.kind !== "missing" && m.role !== "link-preview");
  const formats = new Set<Format>();
  if (media.some((m) => m.kind === "photo" && m.role !== "link-preview")) formats.add("photo");
  if (visual.length >= 2) formats.add("carousel");
  if (media.some((m) => m.kind === "video" && m.video)) formats.add("video");
  if (media.some((m) => m.kind === "video" && !m.video)) formats.add("video-preview");
  if (media.some((m) => m.role === "link-preview" && m.kind !== "missing")) formats.add("link");
  if (!media.some((m) => m.kind !== "missing")) formats.add("text");

  const state = textState(item, ctx.unresolved, ctx.verified);
  const states = new Set<ContentState>();
  if (state === "truncated") states.add("truncated");
  if (state === "unverified") states.add("unverified");
  if (state === "article") states.add("article");
  if (media.some((m) => m.kind === "missing")) states.add("missing-media");
  if (item.topic_review_required) states.add("topic-review");

  const topics = item.topics.filter((t): t is Topic => (TOPICS as readonly string[]).includes(t));
  const subtags: Partial<Record<Topic, string[]>> = {};
  for (const topic of topics) if (item.subtags?.[topic]?.length) subtags[topic] = [...item.subtags[topic]];

  let articleTitle: string | null = null;
  if (state === "article") {
    const lines = item.text.split("\n");
    if (lines[0].trim() === "Article" && lines[1]) articleTitle = lines[1].trim();
  }

  const quotedImage = media.find((m) => m.role === "quoted" && m.kind !== "missing" && "sourcePost" in m && m.sourcePost);
  const quotedUrl = quotedImage && "sourcePost" in quotedImage ? quotedImage.sourcePost : null;
  const quoteTexts = ctx.quotedTexts.get(item.post_url) ?? [];
  const quoteEvidence = quoteTexts.length === 1 ? quoteTexts[0] : null;
  const quote =
    quotedUrl || quoteEvidence
      ? {
          url: quotedUrl ?? quoteEvidence?.url ?? null,
          handle: handleFromUrl(quotedUrl ?? quoteEvidence?.url),
          text: quoteEvidence?.text ?? null,
        }
      : null;

  const order0 = item.provenance.find((p) => p.source_type === "x-bookmarks")?.retrieval_order ?? Number.MAX_SAFE_INTEGER;

  const projected: Omit<LibraryItem, "rev"> = {
    id: item.id,
    postId: item.post_id,
    url: item.post_url,
    handle: item.author.replace(/^@/, ""),
    name: item.author_name ?? null,
    postedAt: item.post_date ?? null,
    order: order0,
    text: item.text,
    textState: state,
    articleTitle,
    topics,
    subtags,
    topicConfidence: item.topic_confidence,
    topicReview: item.topic_review_required,
    formats: FORMATS.filter((f) => formats.has(f)),
    states: STATES.filter((s) => states.has(s)),
    media,
    quote,
  };

  const review = ctx.articleReview.get(item.post_url);
  const detail: ItemDetail = {
    id: item.id,
    bookmarkOrder: order0,
    textSource: TEXT_SOURCE[item.text_status] ?? item.text_status,
    textNote: item.text_completeness ?? null,
    articleNote: item.article_content_status ?? null,
    extraction: item.public_extraction
      ? { status: item.public_extraction.status ?? "unknown", extractor: item.public_extraction.extractor ?? null }
      : null,
    signedInReview: item.signed_in_review
      ? { retrievedAt: item.signed_in_review.retrieved_at ?? null, textComplete: ctx.verified.has(item.post_url) || null }
      : null,
    snippetSummary: item.snippet_summary
      ? { text: item.snippet_summary.text, label: item.snippet_summary.label, basis: item.snippet_summary.basis }
      : null,
    articleSummary: review?.summary ? { text: review.summary, reason: review.reason ?? "" } : null,
    topicBasis: item.topic_basis ?? item.local_topic_review?.basis ?? null,
    topicConfidence: item.topic_confidence,
    reviewReasons: item.review_reasons.map((r) => REVIEW_REASON[r] ?? r),
    mediaNotes: notes,
  };
  return { projected, detail };
}

// ---------------------------------------------------------------- derivatives

async function makeDerivatives(
  source: string,
  derivedDir: string,
  items: SourceItem[],
  ctx: BuildContext,
) {
  await mkdir(derivedDir, { recursive: true });
  const existing = new Set(await readdir(derivedDir));

  // Frames for videos that have no poster image.
  const frameJobs: (() => Promise<void>)[] = [];
  for (const item of items) {
    const posterKeys = new Set(
      item.media.filter((m) => m.role === "video-poster").map((m) => videoKey(m.observed_url ?? m.observed_source_url)),
    );
    const posters = item.media.filter((m) => m.role === "video-poster").length;
    const videos = item.media.filter((m) => m.kind === "video" && m.status === "downloaded" && m.relative_path);
    for (const v of videos) {
      const key = videoKey(v.observed_source_url) ?? v.media_id ?? null;
      const covered = (key && posterKeys.has(key)) || (videos.length === 1 && posters === 1);
      if (covered || !ctx.checks.get(v.relative_path!)?.ok) continue;
      const videoRev = rev(ctx.manifest.get(v.relative_path!)!.sha256);
      const name = `${videoRev}-frame.jpg`;
      ctx.frames.set(videoRev, name);
      if (existing.has(name)) continue;
      existing.add(name);
      const at = Math.min(4, (v.duration ?? 0) * 0.08).toFixed(2);
      frameJobs.push(async () => {
        const out = join(derivedDir, name);
        const result = await run([
          "ffmpeg", "-v", "error", "-ss", at, "-i", join(source, v.relative_path!), "-frames:v", "1",
          "-vf", `scale='min(${FRAME_MAX_WIDTH},iw)':-2`, "-q:v", "3", "-y", `${out}.tmp.jpg`,
        ]);
        if (result.ok) await rename(`${out}.tmp.jpg`, out);
        else {
          ctx.frames.delete(videoRev);
          console.warn(`\nFrame failed for ${v.relative_path}: ${result.stderr.trim().slice(0, 200)}`);
        }
      });
    }
  }
  let done = 0;
  await pool(frameJobs.map((job) => async () => { await job(); progress("Video frames", ++done, frameJobs.length); }), concurrency);

  return existing;
}

async function makeThumbs(source: string, derivedDir: string, images: ImageAsset[], existing: Set<string>) {
  const jobs: (() => Promise<void>)[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = `${image.rev}:${image.derivedFrame ? "f" : "o"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const input = image.derivedFrame ? join(derivedDir, image.path) : join(source, image.path);
    const png = image.path.endsWith(".png");
    for (const width of THUMB_WIDTHS) {
      if (image.w && image.w <= width * 1.15) continue; // too close to the original to be worth a copy
      const name = `${image.rev}-${width}.webp`;
      if (existing.has(name)) continue;
      existing.add(name);
      jobs.push(async () => {
        const out = join(derivedDir, name);
        const cmd = ["cwebp", "-quiet", "-metadata", "none", "-q", width <= 320 ? "76" : "80", "-resize", String(width), "0"];
        if (png) cmd.push("-sharp_yuv");
        const result = await run([...cmd, input, "-o", `${out}.tmp`]);
        if (result.ok) await rename(`${out}.tmp`, out);
        else console.warn(`\nThumbnail failed for ${image.path}: ${result.stderr.trim().slice(0, 200)}`);
      });
    }
  }
  let done = 0;
  await pool(jobs.map((job) => async () => { await job(); progress("Thumbnails", ++done, jobs.length); }), concurrency + 1);
}

async function measureTones(source: string, derivedDir: string, images: ImageAsset[], cachePath: string) {
  const cache: Record<string, string> = existsSync(cachePath) ? await readJson(cachePath) : {};
  const todo = new Map<string, string>();
  for (const image of images) {
    if (cache[image.rev] || todo.has(image.rev)) continue;
    const thumb = join(derivedDir, `${image.rev}-320.webp`);
    todo.set(image.rev, existsSync(thumb) ? thumb : image.derivedFrame ? join(derivedDir, image.path) : join(source, image.path));
  }
  const entries = [...todo.entries()];
  const batches: [string, string][][] = [];
  for (let i = 0; i < entries.length; i += 60) batches.push(entries.slice(i, i + 60));
  let done = 0;
  await pool(
    batches.map((batch) => async () => {
      const result = await run([
        "magick", ...batch.map(([, file]) => file),
        "-background", "#f3f0ea", "-alpha", "remove", "-alpha", "off",
        "-resize", "1x1!", "-format", "%[hex:p{0,0}]\n", "info:",
      ]);
      const lines = result.stdout.trim().split("\n");
      if (lines.length === batch.length) batch.forEach(([key], i) => (cache[key] = `#${lines[i].slice(0, 6).toLowerCase()}`));
      done += batch.length;
      progress("Tones", done, entries.length);
    }),
    concurrency,
  );
  await writeAtomic(cachePath, JSON.stringify(cache));
  return cache;
}

// ---------------------------------------------------------------- main

async function main() {
  const started = performance.now();
  const source = await resolveSource();
  console.log(`Source:  ${source}`);
  console.log(`Library: ${libraryDir}`);
  await mkdir(join(libraryDir, "snapshots"), { recursive: true });
  await chmod(libraryDir, 0o700); // private: snapshots hold post text and media paths

  const { dataset, manifest, unresolved, validation, signedIn, articleReview } = await readSourceStable(source);
  const bookmarks = validateDataset(dataset, validation);
  const excluded = dataset.items.length - bookmarks.length;
  console.log(`Posts: ${dataset.items.length}; X bookmarks: ${bookmarks.length}; excluded (not X bookmarks): ${excluded}`);

  const referenced = new Set<string>();
  for (const item of bookmarks) {
    for (const m of item.media) {
      if (m.relative_path && m.status === "downloaded") referenced.add(m.relative_path);
      for (const c of m.captions ?? []) if (c.relative_path) referenced.add(c.relative_path);
    }
  }
  const { results: checks, byPath } = await checkFiles(source, manifest.assets, referenced);
  const failed = [...checks.entries()].filter(([, c]) => !c.ok);
  if (failed.length) console.warn(`${failed.length} referenced files failed checks; their posts stay, with missing media shown.`);

  const unresolvedSets: Record<string, Set<string>> = {};
  for (const [key, value] of Object.entries(unresolved)) if (Array.isArray(value)) unresolvedSets[key] = new Set(value);
  const verified = new Set(signedIn.filter((e) => e.text_complete === true && e.text).map((e) => e.post_url));
  const quotedTexts = new Map<string, { url: string | null; text: string }[]>();
  for (const e of signedIn) {
    const list = [
      ...(e.quotes ?? []).map((q) => ({ url: q.post_url, text: q.text })),
      ...(e.quoted_texts ?? []).map((text) => ({ url: null, text })),
    ];
    if (list.length) quotedTexts.set(e.post_url, list);
  }
  const ctx: BuildContext = {
    source,
    checks,
    manifest: byPath,
    unresolved: unresolvedSets,
    verified,
    quotedTexts,
    articleReview: new Map(articleReview.map((r) => [r.post_url, r])),
    frames: new Map(),
  };

  const derivedDir = join(libraryDir, "derived");
  const existing = await makeDerivatives(source, derivedDir, bookmarks, ctx);

  const projected = bookmarks.map((item) => projectItem(item, ctx));
  const images: ImageAsset[] = [];
  for (const { projected: p } of projected) {
    for (const m of p.media) {
      if (m.kind === "photo") images.push(m.image);
      if (m.kind === "video" && m.poster) images.push(m.poster);
    }
  }
  await makeThumbs(source, derivedDir, images, existing);
  const tones = await measureTones(source, derivedDir, images, join(libraryDir, "tones.json"));
  const derivedNow = new Set(await readdir(derivedDir));
  for (const image of images) {
    image.thumbs = THUMB_WIDTHS.filter((w) => derivedNow.has(`${image.rev}-${w}.webp`));
    image.tone = tones[image.rev] ?? null;
  }

  // Media allowlist: only these source paths are served.
  const allow: Record<string, { rev: string; bytes: number }> = {};
  const items: LibraryItem[] = projected.map(({ projected: p }) => {
    for (const m of p.media) {
      if (m.kind === "photo" && !m.image.derivedFrame) allow[m.image.path] = { rev: m.image.rev, bytes: byPath.get(m.image.path)!.bytes };
      if (m.kind === "video") {
        if (m.poster && !m.poster.derivedFrame) allow[m.poster.path] = { rev: m.poster.rev, bytes: byPath.get(m.poster.path)!.bytes };
        if (m.video) {
          allow[m.video.path] = { rev: m.video.rev, bytes: m.video.bytes };
          for (const c of m.video.captions) allow[c.path] = { rev: c.rev, bytes: byPath.get(c.path)!.bytes };
        }
      }
    }
    return { ...p, rev: sha(JSON.stringify(p)).slice(0, 12) };
  });
  items.sort((a, b) => a.order - b.order);
  const details = Object.fromEntries(projected.map(({ detail }) => [detail.id, detail]));

  const taxonomy = Object.fromEntries(TOPICS.map((t) => [t, dataset.taxonomy?.[t] ?? []])) as Record<Topic, string[]>;
  const contentHash = sha(JSON.stringify({ items, details, taxonomy, schema: SCHEMA_VERSION })).slice(0, 10);

  const currentPath = join(libraryDir, "current.json");
  const current = existsSync(currentPath) ? await readJson<{ version: string; contentHash?: string }>(currentPath) : null;
  if (current?.contentHash === contentHash && !force) {
    await writeAtomic(join(libraryDir, "config.json"), JSON.stringify({ sourcePath: source }, null, 2));
    console.log(`Library unchanged (${current.version}). Nothing to adopt.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const version = `${stamp}-${contentHash}`;
  const adoptedAt = new Date().toISOString();
  const projection: LibraryProjection = {
    schema: SCHEMA_VERSION,
    version,
    adoptedAt,
    source: {
      generatedAt: dataset.generated_at ?? null,
      label: basename(source),
      posts: items.length,
      excludedNonBookmarks: excluded,
    },
    taxonomy,
    items,
  };

  const snapshotDir = join(libraryDir, "snapshots", version);
  const tempDir = `${snapshotDir}.tmp`;
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  const report = {
    version,
    adoptedAt,
    source,
    counts: {
      items: items.length,
      excluded,
      formats: Object.fromEntries(FORMATS.map((f) => [f, items.filter((i) => i.formats.includes(f)).length])),
      states: Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.states.includes(s)).length])),
      topics: Object.fromEntries(TOPICS.map((t) => [t, items.filter((i) => i.topics.includes(t)).length])),
      noTopic: items.filter((i) => i.topics.length === 0).length,
      derivedFrames: ctx.frames.size,
      failedFiles: failed.map(([path, c]) => ({ path, reason: c.reason })),
    },
  };
  await Promise.all([
    writeFile(join(tempDir, "library.json"), JSON.stringify(projection)),
    writeFile(join(tempDir, "details.json"), JSON.stringify(details)),
    writeFile(join(tempDir, "media.json"), JSON.stringify({ sourcePath: source, allow })),
    writeFile(join(tempDir, "report.json"), JSON.stringify(report, null, 2)),
  ]);
  await rename(tempDir, snapshotDir);
  await writeAtomic(currentPath, JSON.stringify({ version, adoptedAt, contentHash }, null, 2));
  await writeAtomic(join(libraryDir, "config.json"), JSON.stringify({ sourcePath: source }, null, 2));

  // Keep a few earlier snapshots for rollback; derived files are shared and kept.
  const snapshots = (await readdir(join(libraryDir, "snapshots"))).filter((n) => !n.endsWith(".tmp")).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - KEEP_SNAPSHOTS))) {
    await rm(join(libraryDir, "snapshots", old), { recursive: true, force: true });
  }

  console.log(`Adopted ${version} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(report.counts, (k, v) => (k === "failedFiles" ? v.length : v), 2));
}

main().catch((error) => {
  if (error instanceof ValidationError) {
    console.error(`\nImport stopped; the current library is unchanged.\n${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
