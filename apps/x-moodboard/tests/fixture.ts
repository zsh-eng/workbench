// A small synthetic archive in the same shape as the real source folder.
// It covers each card state once; no personal data is involved.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const FIXTURE_DIR = resolve(import.meta.dirname, ".fixture.local");
export const SOURCE = join(FIXTURE_DIR, "source");
export const LIBRARY = join(FIXTURE_DIR, "library");
export const PORT = 5297;

const run = (cmd: string, args: string[]) => {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr}`);
  return result.stdout;
};

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

interface Asset {
  relative_path: string;
  kind: "image" | "video" | "caption";
  width?: number;
  height?: number;
  duration?: number;
}

function image(name: string, w: number, h: number, from: string, to: string): Asset {
  const relative = `assets/${name}`;
  run("magick", ["-size", `${w}x${h}`, `gradient:${from}-${to}`, join(SOURCE, relative)]);
  return { relative_path: relative, kind: "image", width: w, height: h };
}

function video(name: string, opts: { audio: boolean; seconds: number }): Asset {
  const relative = `videos/${name}`;
  const args = ["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=24`];
  if (opts.audio) args.push("-f", "lavfi", "-i", "sine=frequency=330");
  args.push("-t", String(opts.seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (opts.audio) args.push("-c:a", "aac", "-shortest");
  args.push("-y", join(SOURCE, relative));
  run("ffmpeg", args);
  return { relative_path: relative, kind: "video", width: 640, height: 360, duration: opts.seconds };
}

function media(asset: Asset, extra: Record<string, unknown>) {
  const path = join(SOURCE, asset.relative_path);
  return {
    kind: asset.kind,
    status: "downloaded",
    relative_path: asset.relative_path,
    sha256: sha(path),
    bytes: statSync(path).size,
    width: asset.width,
    height: asset.height,
    ...extra,
  };
}

function item(n: number, fields: Record<string, unknown>) {
  const postId = String(1_900_000_000_000_000_000n + BigInt(n));
  const handle = (fields.handle as string) ?? `maker${n}`;
  return {
    id: `fixture${String(n).padStart(8, "0")}`,
    post_id: postId,
    post_url: `https://x.com/${handle}/status/${postId}`,
    author: `@${handle}`,
    author_name: `Maker ${n}`,
    post_date: `2026-09-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`,
    saved_dates: [],
    bookmark_saved_at: null,
    source_types: ["x-bookmarks"],
    provenance: [{ source_type: "x-bookmarks", post_id: postId, retrieval_order: n }],
    text_status: "visible-post-text",
    text_expansion_status: "not-needed",
    topics: [],
    subtags: {},
    topic_confidence: "medium",
    topic_review_required: false,
    media: [],
    review_reasons: [],
    image_capture_status: "observed-image-urls-downloaded",
    public_extraction: { status: "public-metadata-recovered", extractor: "fixture" },
    ...fields,
  };
}

export const POSTS = {
  photo: "1900000000000000001",
  carousel: "1900000000000000002",
  video: "1900000000000000003",
  gif: "1900000000000000004",
  poster: "1900000000000000005",
  link: "1900000000000000006",
  truncated: "1900000000000000007",
  article: "1900000000000000008",
  missing: "1900000000000000009",
  telegramOnly: "1900000000000000010",
  overlap: "1900000000000000011",
  gone: "1900000000000000012",
};

export function buildFixture() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const dir of ["assets", "videos", "captions"]) mkdirSync(join(SOURCE, dir), { recursive: true });
  mkdirSync(LIBRARY, { recursive: true });

  const photo = image("photo1.jpg", 1200, 800, "#c96a3c", "#2e3b55");
  const c1 = image("carousel1.jpg", 900, 1200, "#7a8c5c", "#e8e1d0");
  const c2 = image("carousel2.png", 1000, 1000, "#334455", "#ddccbb");
  const quoted = image("quoted.jpg", 800, 600, "#aa3355", "#f0e0d0");
  const poster = image("poster.jpg", 640, 360, "#202020", "#606060");
  const posterOnly = image("poster-only.jpg", 240, 240, "#ff5533", "#ffffff");
  const link = image("link.jpg", 1200, 628, "#225588", "#99bbdd");
  const clip = video("2000000000000000003.mp4", { audio: true, seconds: 2 });
  const gif = video("2000000000000000004.mp4", { audio: false, seconds: 1.5 });
  writeFileSync(join(SOURCE, "captions/2000000000000000003.en.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.500\nFixture caption\n");
  const caption: Asset = { relative_path: "captions/2000000000000000003.en.vtt", kind: "caption" };
  // Listed in the manifest but absent from disk.
  const gone: Asset = { relative_path: "assets/gone.jpg", kind: "image", width: 600, height: 400 };

  const items = [
    item(1, {
      text: "Quiet typography study for a reading app. Lowercase marginalia everywhere.",
      topics: ["Design inspiration"],
      subtags: { "Design inspiration": ["typography"] },
      media: [media(photo, { role: "post-image", alt_text: "A warm gradient study", format: "jpg" })],
    }),
    item(2, {
      text: "Three plates from the bindery visit, with the quoted chart.",
      topics: ["Design inspiration", "Engineering"],
      subtags: { Engineering: ["architecture"] },
      media: [
        media(c1, { role: "post-image" }),
        media(c2, { role: "post-image" }),
        media(quoted, { role: "quoted-post-image", source_post_url: "https://x.com/quoted_author/status/900" }),
      ],
    }),
    item(3, {
      text: "Render loop profiling walkthrough with captions.",
      topics: ["Engineering"],
      subtags: { Engineering: ["performance"] },
      media: [
        media(poster, { role: "video-poster", observed_url: "https://pbs.twimg.com/amplify_video_thumb/2000000000000000003/img/x.jpg" }),
        {
          ...media(clip, { role: "post-attachment-or-quote", media_id: "2000000000000000003", duration: 2 }),
          observed_source_url: "https://video.twimg.com/amplify_video/2000000000000000003/vid/x.mp4",
          probe: { streams: [{ codec_type: "video" }, { codec_type: "audio" }] },
          captions: [{ ...media(caption, {}), language: "en" }],
        },
      ],
    }),
    item(4, {
      text: "Looping agent cursor animation, no sound.",
      topics: ["AI practice"],
      media: [
        {
          ...media(gif, { role: "post-attachment-or-quote", media_id: "2000000000000000004", duration: 1.5 }),
          observed_source_url: "https://video.twimg.com/tweet_video/FixtureGifKey.mp4",
          probe: { streams: [{ codec_type: "video" }] },
          captions: [],
        },
      ],
    }),
    item(5, {
      text: "Button press motion study — the clip itself was not saved.",
      topics: ["Tools & products"],
      media: [media(posterOnly, { role: "video-poster", observed_url: "https://pbs.twimg.com/amplify_video_thumb/7777/img/y.jpg" })],
    }),
    item(6, {
      text: "An essay on slow software worth rereading\nOn slow software\nFrom example.com",
      topics: ["Ideas & culture"],
      media: [media(link, { role: "link-preview" })],
    }),
    item(7, {
      text: "Notes on keeping a commonplace book: start small, write by hand, return weekly, and let the index grow from what you",
      text_status: "timeline-truncated",
      topics: ["Life & thinking"],
      review_reasons: ["timeline-text-truncated"],
    }),
    item(8, {
      text: "Article\nOn Craft and Patience\nA preview of an article about patience in craft. The rest lives on X...",
      article_content_status: "Native X article preview observed; full article body not extracted",
      topics: ["Career & work"],
    }),
    item(9, {
      text: "Desk setup photo that the archive could not keep.",
      topic_review_required: true,
      review_reasons: ["visual-or-short-post-needs-topic-review"],
      media: [{ kind: "image", role: "post-attachment", status: "blocked-browser-tool-unavailable", reason: "Photo observed but not saved." }],
    }),
    item(10, {
      text: "Telegram-only record that must never appear.",
      source_types: ["telegram-saved-messages"],
      provenance: [{ source_type: "telegram-saved-messages", message_id: "SECRET-TG-1" }],
      topics: ["Engineering"],
    }),
    item(11, {
      text: "Overlap post kept because it was also bookmarked on X.",
      source_types: ["telegram-saved-messages", "x-bookmarks"],
      saved_dates: ["2026-09-01"],
      provenance: [
        { source_type: "telegram-saved-messages", message_id: "SECRET-TG-2", saved_date: "2026-09-01" },
        { source_type: "x-bookmarks", post_id: "1900000000000000011", retrieval_order: 11 },
      ],
      topics: ["Engineering"],
    }),
    item(12, {
      text: "Photo whose file went missing after the manifest was written.",
      topics: ["Design inspiration"],
      media: [{ kind: "image", role: "post-image", status: "downloaded", relative_path: gone.relative_path, sha256: "0".repeat(64), bytes: 1234, width: 600, height: 400 }],
    }),
  ];

  const assets = [photo, c1, c2, quoted, poster, posterOnly, link, clip, gif, caption].map((a) => {
    const path = join(SOURCE, a.relative_path);
    return { relative_path: a.relative_path, kind: a.kind, bytes: statSync(path).size, sha256: sha(path) };
  });
  assets.push({ relative_path: gone.relative_path, kind: "image", bytes: 1234, sha256: "0".repeat(64) });

  writeDataset(items, assets);
  return items;
}

export function writeDataset(items: unknown[], assets?: unknown[]) {
  const dataset = {
    schema_version: "1.0",
    generated_at: "2026-10-01T00:00:00Z",
    taxonomy: {
      "AI practice": ["skills", "prompts", "workflows", "agents"],
      "Design inspiration": ["layout", "typography", "motion", "interaction", "visual-style"],
      Engineering: ["architecture", "implementation", "performance"],
      "Career & work": ["career", "work-practice"],
      "Life & thinking": ["personal-growth", "relationships", "wellbeing"],
      "Ideas & culture": ["society", "reading-writing", "science", "arts"],
      "Tools & products": ["apps", "products"],
    },
    items,
    limitations: [],
  };
  writeFileSync(join(SOURCE, "dataset.json"), JSON.stringify(dataset, null, 1));
  if (assets) writeFileSync(join(SOURCE, "assets-manifest.json"), JSON.stringify({ assets }, null, 1));
  writeFileSync(
    join(SOURCE, "unresolved-cases.json"),
    JSON.stringify({ timeline_text_still_truncated: [(items[6] as { post_url: string }).post_url], photo_capture_review: [] }),
  );
  writeFileSync(join(SOURCE, "validation.json"), JSON.stringify({ stable_catalogue_ids_preserved: true, private_telegram_utilities_excluded: true }));
  // The importer refuses files changed in the last few seconds; age them.
  const past = new Date(Date.now() - 60_000);
  for (const file of ["dataset.json", "assets-manifest.json"]) utimesSync(join(SOURCE, file), past, past);
}

export function runImport() {
  return run("bun", [resolve(import.meta.dirname, "../scripts/import.ts"), "--source", SOURCE, "--library", LIBRARY]);
}
