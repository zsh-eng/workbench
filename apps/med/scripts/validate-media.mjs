// Real HTTP host, Git sources, native browser decoders, and video range transport.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  realpath,
  open,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
const root = await realpath(await mkdtemp(join(tmpdir(), "med-media-")));
const repo = join(root, "repo"),
  state = join(root, "state");
const output = process.env.MED_MEDIA_OUTPUT || "/private/tmp/med-media-results";
await mkdir(repo);
await mkdir(output, { recursive: true });
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Media Test",
      "-c",
      "user.email=media@example.invalid",
      ...args,
    ],
    { cwd: repo, encoding: "utf8" },
  ).trim();
const svg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" rx="32" fill="${color}"/><circle cx="765" cy="140" r="92" fill="#fff" opacity=".15"/><path d="M0 420 Q220 250 480 420 T960 420 V540 H0" fill="#fff" opacity=".12"/><text x="72" y="225" font-family="sans-serif" font-size="52" fill="white">A clearer picture</text><text x="75" y="280" font-family="sans-serif" font-size="24" fill="white">Small previews. Full detail when you need it.</text><script>fetch('/svg-script-ran')</script></svg>`;
let host, browser;
const results = {};
try {
  await cp("tests/fixtures/media", repo, { recursive: true });
  await writeFile(join(repo, "design.svg"), svg("#3b6a9e"));
  await writeFile(join(repo, "deleted.svg"), svg("#304050"));
  await writeFile(join(repo, "rename.svg"), svg("#507090"));
  git("init", "-qb", "main");
  git("add", ".");
  git("commit", "-qm", "Media before");
  const base = git("rev-parse", "HEAD");
  await writeFile(join(repo, "design.svg"), svg("#7960b8"));
  await rm(join(repo, "deleted.svg"));
  git("mv", "rename.svg", "renamed.svg");
  await writeFile(
    join(repo, "sample.png"),
    Buffer.concat([await readFile(join(repo, "sample.png")), Buffer.from("changed")]),
  );
  git("add", ".");
  git("commit", "-qm", "Media after");
  const head = git("rev-parse", "HEAD");
  await writeFile(join(repo, "README.md"), "# Images and code in one review\n");
  await writeFile(join(repo, "design.svg"), svg("#4b74ad"));
  for (const ext of ["jpg", "webp", "avif"])
    await cp(join(repo, `sample.${ext}`), join(repo, `added.${ext}`));
  for (let i = 0; i < 12; i++)
    await writeFile(join(repo, `offscreen-${String(i).padStart(2, "0")}.svg`), svg("#7366ed"));
  const huge = await open(join(repo, "large.webm"), "w");
  await huge.truncate(512 * 1024 * 1024);
  await huge.close();
  await symlink(join(repo, "design.svg"), join(repo, "linked.svg"));
  const executable = process.env.MED_EXECUTABLE;
  host = spawn(
    executable || process.execPath,
    [
      ...(executable ? [] : [resolve("dist/cli.js")]),
      repo,
      "--port",
      "0",
      "--no-open",
      "--state-dir",
      state,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const launch = await new Promise((ok, fail) => {
    let text = "";
    const timeout = setTimeout(() => fail(Error("Host timeout")), 30000);
    host.stdout.on("data", (d) => {
      text += d;
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timeout);
        ok(match[0]);
      }
    });
    host.once("exit", (c) => {
      clearTimeout(timeout);
      fail(Error("Host exited " + c));
    });
    host.once("error", fail);
  });
  const url = new URL(launch),
    origin = url.origin;
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const post = async (path, body) => {
    const r = await fetch(origin + path, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const source = { kind: "worktree", repo };
  const media = (file) =>
    origin +
    "/api/media?" +
    new URLSearchParams({
      source: JSON.stringify(file.source),
      path: file.path,
      identity: file.identity,
    });
  const rss = () =>
    Number(
      execFileSync("ps", ["-p", String(host.pid), "-o", "rss="], { encoding: "utf8" }).trim(),
    ) * 1024;
  const initialRss = rss(),
    start = performance.now();
  const large = await post("/api/browse/read", { source, path: "large.webm" });
  results.largeFile = {
    bytes: large.size,
    metadataBytes: Buffer.byteLength(JSON.stringify(large)),
    metadataMs: performance.now() - start,
  };
  assert.equal(large.kind, "video");
  assert.ok(JSON.stringify(large).length < 1500);
  const requestStart = performance.now();
  const range = await fetch(media(large), {
    headers: { ...headers, range: "bytes=536805376-536870911" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 65536);
  assert.equal(range.headers.get("content-range"), "bytes 536805376-536870911/536870912");
  results.largeFile.rangeBytes = 65536;
  results.largeFile.rangeMs = performance.now() - requestStart;
  results.largeFile.rssDeltaBytes = Math.max(0, rss() - initialRss);
  assert.ok(
    results.largeFile.rssDeltaBytes < 64 * 1024 * 1024,
    "A 512 MiB video must not be buffered",
  );
  const invalid = await fetch(media(large), { headers: { ...headers, range: "bytes=999999999-" } });
  assert.equal(invalid.status, 416);
  const suffix = await fetch(media(large), { headers: { ...headers, range: "bytes=-32" } });
  assert.equal((await suffix.arrayBuffer()).byteLength, 32);
  const headResponse = await fetch(media(large), { method: "HEAD", headers });
  assert.equal(headResponse.headers.get("content-length"), String(large.size));
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0);
  const noAuth = await fetch(media(large));
  assert.equal(noAuth.status, 401);
  const linked = await post("/api/browse/read", { source, path: "linked.svg" });
  assert.equal(linked.kind, "unsupported");
  const localDenied = await fetch(
    origin +
      "/api/media?" +
      new URLSearchParams({
        source: JSON.stringify({ kind: "local", path: join(repo, "design.svg") }),
        path: join(repo, "design.svg"),
      }),
    { headers },
  );
  assert.equal(localDenied.status, 403);
  const commitVideo = await post("/api/browse/read", {
    source: { kind: "commit", repo, oid: base },
    path: "sample.webm",
  });
  const gitRange = await fetch(media(commitVideo), {
    headers: { ...headers, range: "bytes=12-31" },
  });
  assert.equal(gitRange.status, 206);
  assert.deepEqual(
    Buffer.from(await gitRange.arrayBuffer()),
    (await readFile(join(repo, "sample.webm"))).subarray(12, 32),
  );
  const review = await post("/api/review", { repo, comparison: { kind: "range", base, head } });
  const imageUrl = (review, path, side) =>
    origin + "/api/review-image?" + new URLSearchParams({ reviewId: review.id, path, side });
  const before = await fetch(imageUrl(review, "design.svg", "old"), { headers }),
    after = await fetch(imageUrl(review, "design.svg", "new"), { headers });
  assert.match(await before.text(), /#3b6a9e/);
  assert.match(await after.text(), /#7960b8/);
  assert.equal((await fetch(imageUrl(review, "renamed.svg", "old"), { headers })).status, 200);
  assert.equal((await fetch(imageUrl(review, "deleted.svg", "new"), { headers })).status, 404);
  const pair = await post("/api/review", {
    repo,
    comparison: { kind: "files", oldPath: "design.svg", newPath: "renamed.svg" },
  });
  assert.equal((await fetch(imageUrl(pair, "renamed.svg", "old"), { headers })).status, 200);
  const working = await post("/api/review", { repo, comparison: { kind: "working" } });
  const saved = await post("/api/reviews", {
    title: "Image review",
    targets: [{ repo, comparison: { kind: "working" } }],
  });
  const frozenUrl =
    origin +
    "/api/review-image?" +
    new URLSearchParams({
      saved: saved.id,
      target: saved.targets[0].id,
      path: "design.svg",
      side: "new",
    });
  await writeFile(join(repo, "design.svg"), svg("#111111"));
  assert.match(await (await fetch(frozenUrl, { headers })).text(), /#4b74ad/);
  assert.equal((await fetch(imageUrl(working, "design.svg", "new"), { headers })).status, 409);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let scripted = 0;
  page.on("request", (r) => {
    if (r.url().includes("svg-script-ran")) scripted++;
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  await page.goto(launch);
  await page.goto(origin + "/review/" + saved.id);
  const card = page.locator('[data-media-diff="design.svg"]');
  await card.scrollIntoViewIfNeeded();
  await card.locator("img").first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-media-diff="design.svg"] img')].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  assert.ok((await card.boundingBox()).height <= 240);
  await card.screenshot({ path: join(output, "diff-images.png") });
  const offscreen = page.locator('[data-media-diff="offscreen-11.svg"]');
  assert.equal(await offscreen.locator("img").count(), 0);
  await offscreen.scrollIntoViewIfNeeded();
  await offscreen.locator("img").waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-media-diff="offscreen-11.svg"] img')?.naturalWidth > 0,
  );
  assert.equal(await card.locator("img").count(), 0, "Far images release their decoded elements");
  await card.scrollIntoViewIfNeeded();

  await card.getByRole("button", { name: "Collapse design.svg", exact: true }).click();
  assert.equal(await card.locator("img").count(), 0);
  await card.getByRole("button", { name: "Expand design.svg", exact: true }).click();
  const far = page.locator('[data-media-diff="added.webp"]');
  await far.scrollIntoViewIfNeeded();
  await far.locator("img").waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-media-diff="added.webp"] img')?.naturalWidth > 0,
  );
  await writeFile(join(repo, "design.svg"), svg("#4b74ad"));
  for (const ext of ["png", "jpg", "webp", "avif", "svg"]) {
    const path = ext === "svg" ? "design.svg" : `sample.${ext}`;
    await page.goto(origin + "/file?" + new URLSearchParams({ repo, path }));
    const img = page.locator(".med-media-stage img");
    await img.waitFor();
    await page.waitForFunction(
      () => document.querySelector(".med-media-stage img")?.naturalWidth > 0,
    );
    assert.equal(await page.locator(".cm-content").count(), 0);
    if (ext === "svg") {
      await page.keyboard.press("Meta+k");
      await page
        .getByRole("combobox", { name: "Search commands", exact: true })
        .fill("color theme");
      await page.keyboard.press("Enter");
      const themes = page.getByRole("combobox", { name: "Search themes" });
      await themes.waitFor();
      await themes.fill("Graphite Light");
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.screenshot({ path: join(output, "image-viewer.png") });
    }
  }
  await page.goto(origin + "/file" + repo + "/sample.webm");
  const video = page.locator("video");
  await video.waitFor();
  await video.evaluate(async (v) => {
    if (v.readyState < 1)
      await new Promise((ok, fail) => {
        v.onloadedmetadata = ok;
        v.onerror = fail;
      });
    await v.play();
  });
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.1);
  await video.evaluate((v) => {
    v.pause();
    v.currentTime = 1;
  });
  await page.waitForFunction(() => !document.querySelector("video")?.seeking);
  await page.screenshot({ path: join(output, "video-viewer.png") });
  assert.equal(await video.getAttribute("controls"), "");
  assert.equal(await video.getAttribute("preload"), "metadata");
  const beforeRequests = [];
  page.on("request", (r) => beforeRequests.push(r.url()));
  const data = await page.evaluateHandle(
    (bytes) => {
      const d = new DataTransfer();
      d.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
      return d;
    },
    [...(await readFile(join(repo, "sample.png")))],
  );
  await page.dispatchEvent("body", "drop", { dataTransfer: data });
  await page.waitForFunction(
    () => document.querySelector(".med-media-stage img")?.naturalWidth > 0,
  );
  assert.ok(
    !beforeRequests.some((u) => u.includes("/api/media")),
    "Dropped media stays in the browser",
  );
  assert.equal(scripted, 0);
  assert.deepEqual(errors, []);
  await context.tracing.stop({ path: join(output, "media-trace.zip") });
  results.checks = [
    "compact-before-after",
    "lazy-images-and-offscreen-release",
    "commit-rename-delete",
    "frozen-saved-images",
    "png-jpeg-webp-avif-svg",
    "native-video-play-and-seek",
    "git-video-range",
    "512-MiB-bounded-range",
    "authentication-and-file-grants",
    "symlink-rejection",
    "SVG-script-isolation",
    "browser-only-drops",
  ];
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const exit = once(host, "exit");
    host.kill("SIGTERM");
    await exit;
  }
  await rm(root, { recursive: true, force: true });
}
