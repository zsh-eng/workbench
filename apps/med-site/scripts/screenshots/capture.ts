// Records Med's live demo and captures the site's screenshots. A built Med
// serves the Trailhead fixture; a fixture transcript (session.ts) stands in
// for the agent: Med shows it in the Session pane, and `med review wait` takes
// the comments that Med sends. The recordings of Med's API answers go to
// public/demo: hero.json is a timeline, from the reviewer's message to the
// agent's next review; recording.json and vault.json are the state after it.
// Each screenshot is a scene of the live demo itself
// (apps/med/src/web/demo.ts), so a window's picture matches the Med that
// replaces it. The script writes AVIF and WebP files and src/screenshots.json.
//
//   MED_CLI=/path/to/apps/med/dist/cli.js bun run screenshots
//   bun run screenshots --demo    # the demo recording only
//   bun run screenshots --shots   # the captures only, from the recording there
//
// Med runs on MED_PORT (default 4310) with a temporary home, state, and
// repository; the vault's Med and the demo use the next two ports. It never
// uses the default service port or the user's state.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import sharp from "sharp";
import { comments, message, rounds } from "./fixture.ts";
import { applyRound, createRepository, write } from "./repo.ts";
import { sessionId, Transcript } from "./session.ts";
import { buildDemo } from "../demo.ts";
import { createVault, noteNames, vaultNote } from "./vault.ts";

const commitMessage =
  "Show active filters as chips\n\nThe search bar lists each filter as a chip, and the list announces\nchanges to screen readers.";

type Scheme = "light" | "dark";

const site = join(import.meta.dir, "../..");
const cli = process.env.MED_CLI ?? join(site, "../med/dist/cli.js");
const port = Number(process.env.MED_PORT ?? 4310);
if ([port, port + 1, port + 2].includes(6330))
  throw new Error("Port 6330 is the Med service. Use another.");
const origin = `http://127.0.0.1:${port}`;
const output = join(site, "public/screenshots");
const demoOnly = process.argv.includes("--demo");
const shotsOnly = process.argv.includes("--shots");

// The demo's scenes, at the size of Med in each window, and display widths
// for srcset. A shot captures at `scale` times its CSS size, 2 by default. A
// feature's scene shows only its part of Med; phones get the same part at
// 390 px, where Med lays it out again for the narrow window.
type Spec = {
  viewport: { width: number; height: number };
  widths: number[];
  scene?: string;
  scale?: number;
};
const feature = (width: number, height: number): Spec => ({
  viewport: { width, height },
  widths: [width, width * 2],
});
const phone = (scene: string, height: number): Spec => ({
  scene,
  viewport: { width: 390, height },
  scale: 3,
  widths: [780, 1170],
});
const shots: Record<string, Spec> = {
  // Med 10% larger than at 1440 by 900: the window shows less, and larger.
  review: {
    viewport: { width: 1309, height: 818 },
    scale: 2.2,
    // No 2240: the full-size capture is smaller as AVIF than a resample to it.
    widths: [720, 1120, 1680, 2880],
  },
  brief: feature(720, 420),
  comment: feature(720, 400),
  session: feature(720, 520),
  // Wider than the window, so the Commit tab keeps its files beside the diff.
  commit: feature(760, 460),
  notes: feature(720, 440),
  "brief-phone": phone("brief", 460),
  "comment-phone": phone("comment", 440),
  "session-phone": phone("session", 556),
  "commit-phone": phone("commit", 330),
  "notes-phone": phone("notes", 480),
};
type Shot = string;

const scratch = mkdtempSync(join(tmpdir(), "med-site-"));
const repo = join(scratch, "trailhead");
const vault = join(scratch, "trailhead-notes");
const vaultState = join(scratch, "vault-state");
const staging = join(scratch, "screenshots");
const state = join(scratch, "state");
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: join(scratch, "home"),
  MED_HOME_DIR: join(scratch, "home"),
  MED_STATE_DIR: state,
  MED_SEARCH_CACHE: join(scratch, "cache"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function med(args: string[]): string {
  const result = Bun.spawnSync(["node", cli, ...args], { env });
  if (result.exitCode !== 0) {
    throw new Error(`med ${args[0]}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

async function startMed() {
  const server = Bun.spawn(
    [
      "node",
      cli,
      repo,
      "--port",
      String(port),
      "--no-open",
      "--state-dir",
      state,
    ],
    { env, stdout: "pipe", stderr: "inherit" },
  );
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const timeout = setTimeout(() => server.kill(), 30_000);
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Med did not start:\n${text}`);
    text += decoder.decode(value, { stream: true });
    const token = /#token=([\w-]+)/.exec(text)?.[1];
    if (token) {
      clearTimeout(timeout);
      // Keep reading, so Med never blocks on a full pipe.
      void (async () => {
        while (!(await reader.read()).done);
      })();
      return { server, token };
    }
  }
}

/** Creates the review's next iteration; returns its path and the printed link. */
function createReview(round: number) {
  const brief = join(scratch, `brief-${round}.md`);
  writeFileSync(brief, rounds[round]!.brief);
  const out = med([
    "review",
    "create",
    "--title",
    "Search filters",
    "--key",
    "demo",
    "--repo",
    repo,
    "--working",
    "--no-pr",
    "--session",
    `claude:${sessionId}`,
    "--brief",
    brief,
    "--state-dir",
    state,
    "--port",
    String(port),
  ]);
  const link = /\[[^\]]+\]\((http:\/\/[^)]+\/review\/[\w-]+)\)/.exec(out);
  if (!link) throw new Error(`No review link in:\n${out}`);
  return { path: new URL(link[1]!).pathname, link: link[0] };
}

/** The agent's `med review wait`: it ends when Med sends it a message. */
function wait() {
  return Bun.spawn(
    [
      "node",
      cli,
      "review",
      "wait",
      "--key",
      "demo",
      "--session",
      `claude:${sessionId}`,
      "--state-dir",
      state,
      "--port",
      String(port),
    ],
    { env, stdout: "pipe", stderr: "inherit" },
  );
}

/** Opens the Session pane beside the review and waits for the agent. */
async function showSession(page: Page) {
  const toggle = page.getByRole("button", { name: "Toggle agent session" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  const pane = page.getByRole("complementary", { name: "Agent session" });
  await pane.getByText("is waiting for your review").waitFor();
  await page.waitForTimeout(600);
  return pane;
}

/** Opens the review in Med, as the reviewer. */
async function open(browser: Browser, token: string, path: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Med trades the launch token for a cookie, then removes it from the URL.
  await page.goto(`${origin}/#token=${token}`);
  await page.waitForURL((url) => !url.hash.includes("token"));
  // Let the repository's own workspace open first. With the review as a
  // second workspace, the sidebar lists both, the same way in every capture.
  await page.getByText("History", { exact: true }).waitFor();
  await page.goto(`${origin}${path}`);
  await page.getByRole("tab", { name: "Notes" }).waitFor();
  await page.getByText("Workspaces", { exact: true }).waitFor();
  // Med keeps a live connection open, so wait for highlighting by time.
  await page.waitForTimeout(1000);
  return page;
}

/** Scrolls the Changes stream until the target renders, then centers it. */
async function reveal(page: Page, target: Locator) {
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width * 0.6, height * 0.6);
  for (let step = 0; step < 40 && !(await target.count()); step += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
  }
  await target.first().evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
}

async function addComment(
  page: Page,
  file: string,
  line: number,
  text: string,
) {
  await page.getByRole("tab", { name: "Changes" }).click();
  const diff = page.locator("diffs-container").filter({ hasText: file });
  const row = diff.locator(
    `[data-gutter] [data-line-type="change-addition"][data-column-number="${line}"]`,
  );
  await reveal(page, row);
  await row.click();
  await page.keyboard.press("c");
  await page.keyboard.type(text);
  await page.keyboard.press("Meta+Enter");
  await page.getByText(text).filter({ visible: true }).first().waitFor();
  // The card shows at once; Med saves it in the background.
  await page.waitForTimeout(1500);
}

/** Fails when a local path is on screen. */
async function checkPrivacy(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const secret of [scratch, homedir(), "/private/", "/Users/"]) {
    if (text.includes(secret))
      throw new Error(`A local path is on screen: ${secret}`);
  }
}

/** Lets the scene finish drawing. The pointer never enters the page, so no
 * hover state shows: a feature's part fills the whole window. */
async function settle(page: Page) {
  await page.waitForTimeout(600);
  await checkPrivacy(page);
}

/** Keeps a copy of each API answer in window.medRecording, with the time it
 * came, and each event of a stream with its own time. */
function recorder() {
  type Entry = Record<string, unknown> & {
    text: string;
    t: number;
    chunks?: { t: number; text: string }[];
  };
  const entries: Entry[] = [];
  Object.assign(window, { medRecording: entries });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    // Med opens each event stream by itself without the shared live stream,
    // as it does in the demo, so each stream records under its own path.
    if (url.pathname === "/api/live")
      return new Response(null, { status: 404 });
    const response = await realFetch(input, init);
    if (!url.pathname.startsWith("/api/")) return response;
    const type = response.headers.get("content-type") ?? "";
    const entry: Entry = {
      method: request.method,
      url: url.pathname + url.search,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
      status: response.status,
      type,
      text: "",
      t: performance.now(),
    };
    entries.push(entry);
    if (type.startsWith("text/event-stream") && response.body) {
      // Keep reading the copy for as long as the page is open.
      const [app, copy] = response.body.tee();
      const chunks: { t: number; text: string }[] = [];
      entry.chunks = chunks;
      void (async () => {
        const reader = copy.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push({
            t: performance.now(),
            text: decoder.decode(value, { stream: true }),
          });
        }
      })();
      return new Response(app, {
        status: response.status,
        headers: response.headers,
      });
    }
    if (/^(image|application\/octet-stream)/.test(type)) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      entry.text = btoa(String.fromCharCode(...bytes));
      entry.base64 = true;
    } else {
      entry.text = await response.clone().text();
    }
    return response;
  };
}

/** Opens each changed file from its header and closes it, as a visitor
 * would. The tree scrolls the stream to the file first. */
async function openFiles(page: Page) {
  const status = Bun.spawnSync(["git", "-C", repo, "status", "--porcelain"]);
  const files = status.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    await page.getByRole("treeitem", { name, exact: true }).click();
    await page.waitForTimeout(600);
    await page.getByRole("link", { name: file, exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Close file" }).click();
    await page.waitForTimeout(300);
  }
}

/** Records the review for the live demo: every API answer while a visitor
 * would look around, and the app's own layout settings. */
async function record(browser: Browser, token: string, path: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(recorder);
  const page = await context.newPage();
  await page.goto(`${origin}/#token=${token}`);
  await page.waitForURL((url) => !url.hash.includes("token"));
  await page.getByText("History", { exact: true }).waitFor();
  await page.goto(`${origin}${path}`);
  await page.getByRole("tab", { name: "Notes" }).waitFor();
  await page.waitForTimeout(1000);
  const pane = await showSession(page);
  // The session's turns, for its Turns menu.
  await pane.getByRole("button", { name: "Turns" }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Changes" }).click();
  // Load every file in the stream, then come back to the comment.
  await page.mouse.move(800, 500);
  for (const delta of [700, -700]) {
    for (let step = 0; step < 30; step += 1) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
    }
  }
  await reveal(
    page,
    page.getByText(comments[1]!.text).filter({ visible: true }),
  );
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.waitForTimeout(1500);
  await checkPrivacy(page);
  // A visitor's first clicks: each changed file, each commit, and the
  // Commit tab.
  await openFiles(page);
  const commits = page.locator("button[role=option]").filter({ visible: true });
  for (let index = 0; index < (await commits.count()); index += 1) {
    await commits.nth(index).click();
    await page.waitForTimeout(800);
  }
  await page.getByText("Working changes", { exact: true }).first().click();
  // The commit: Med keeps the message as a draft, which the demo's commit
  // scene types out. The scene stages the files itself, so none stay staged.
  await page.getByRole("tab", { name: "Commit" }).click();
  await page.getByRole("button", { name: "Stage all", exact: true }).click();
  await page.getByRole("button", { name: "Unstage all" }).waitFor();
  await page.getByRole("button").filter({ hasText: "Commit…" }).first().click();
  const [summary, ...body] = commitMessage.split("\n\n");
  await page.getByRole("textbox", { name: "Commit summary" }).fill(summary!);
  await page
    .getByRole("textbox", { name: "Commit description" })
    .fill(body.join("\n\n"));
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Unstage all" }).click();
  await page.getByRole("button", { name: "Stage all", exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.waitForTimeout(800);
  await save(page, "recording.json", path);
  await context.close();
}

/** Records the hero's timeline: the review with the reviewer's comment on
 * the first file and the agent waiting, then the reviewer's message, and the
 * agent's answer as it happens (`answer`). Times count from the message. */
async function recordHero(
  browser: Browser,
  token: string,
  path: string,
  answer: () => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: shots.review!.viewport,
    reducedMotion: "reduce",
  });
  await context.addInitScript(recorder);
  const page = await context.newPage();
  await page.goto(`${origin}/#token=${token}`);
  await page.waitForURL((url) => !url.hash.includes("token"));
  await page.getByText("History", { exact: true }).waitFor();
  await page.goto(`${origin}${path}`);
  await page.getByRole("tab", { name: "Notes" }).waitFor();
  await page.waitForTimeout(1000);
  const pane = await showSession(page);
  await page.getByRole("tab", { name: "Changes" }).click();
  // Load every file in the stream, then come back to the first.
  await page.mouse.move(600, 450);
  for (const delta of [700, -700]) {
    for (let step = 0; step < 30; step += 1) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(1500);
  await checkPrivacy(page);
  await pane.getByPlaceholder(/^Message/).fill(message);
  await page.evaluate(() =>
    Object.assign(window, { medRecordingZero: performance.now() }),
  );
  await pane.getByRole("button", { name: "Send" }).click();
  await answer();
  // Med follows the agent to its new review, then the agent waits again.
  await page.waitForTimeout(4000);
  await openFiles(page);
  await checkPrivacy(page);
  await save(page, "hero.json", path);
  await context.close();
}

/** Records the vault's answers: the note and its neighbours, as a visitor
 * opens them in the Notes scene. */
async function recordVault(browser: Browser) {
  const context = await browser.newContext({
    viewport: shots.notes.viewport,
    reducedMotion: "reduce",
  });
  await context.addInitScript(recorder);
  const page = await context.newPage();
  await page.goto(vaultUrl);
  await page.waitForURL((url) => !url.hash.includes("token"));
  await page.locator(`a[href="/vault/${vaultId}"]`).click();
  const tree = page.getByRole("complementary", { name: "Vault files" });
  const openNote = async (name: string) => {
    await tree.getByRole("treeitem", { name, exact: true }).dblclick();
    await page.waitForTimeout(800);
  };
  for (const name of noteNames.filter((name) => name !== vaultNote))
    await openNote(name);
  await openNote(vaultNote);
  // A note opens rendered.
  await page.locator(".med-md-prose .med-md-block").first().waitFor();
  await page.waitForTimeout(1500);
  await save(page, "vault.json", `/vault/${vaultId}`);
  await context.close();
}

type Entry = {
  method: string;
  url: string;
  body?: string;
  status: number;
  type: string;
  text: string;
  t: number;
  chunks?: { t: number; text: string }[];
};

/** Writes a page's recording to public/demo: its API answers, and the app's
 * local settings without the theme, which follows the visitor. A page that
 * set window.medRecordingZero keeps a timeline: each answer and event with
 * its time from then. Other pages keep the answers whole, and the demo gives
 * the last answer to each request. */
async function save(page: Page, name: string, path: string) {
  const recorded = await page.evaluate(() => ({
    storage: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => !key.includes("theme")),
    ),
    entries: (window as unknown as { medRecording: Entry[] }).medRecording,
    zero: (window as unknown as { medRecordingZero?: number }).medRecordingZero,
    // The wall-clock time at the page's start, for the timeline's start.
    origin: Date.now() - performance.now(),
  }));
  const { storage, zero } = recorded;
  const ms = (time: number) => Math.round(time - zero!);
  const entries = recorded.entries.map(({ t, chunks, ...entry }) =>
    zero === undefined
      ? {
          ...entry,
          ...(chunks
            ? { text: chunks.map((chunk) => chunk.text).join("") }
            : {}),
        }
      : {
          ...entry,
          at: ms(t),
          ...(chunks
            ? {
                chunks: chunks.map((chunk) => ({
                  at: ms(chunk.t),
                  text: chunk.text,
                })),
              }
            : {}),
        },
  );
  // The fixture lives in a temporary folder; the demo shows it at /work.
  let json = JSON.stringify({
    path,
    // A timeline's clock starts with it.
    recordedAt:
      zero === undefined ? Date.now() : Math.round(recorded.origin + zero),
    storage,
    entries,
  });
  for (const local of [realpathSync(scratch), scratch]) {
    for (const form of [local, encodeURIComponent(local)]) {
      json = json.replaceAll(form, form === local ? "/work" : "%2Fwork");
    }
  }
  for (const secret of [scratch, homedir(), "/private/", "/Users/"]) {
    if (json.includes(secret))
      throw new Error(`A local path is in the recording: ${secret}`);
  }
  mkdirSync(join(site, "public/demo"), { recursive: true });
  writeFileSync(join(site, "public/demo", name), json);
  console.log(
    `${name}: ${entries.length} answers, ${(json.length / 1024).toFixed(0)} KB`,
  );
}

/** Serves a build of the demo beside the new recordings. */
function serveDemo() {
  const root = join(scratch, "demo");
  buildDemo(root);
  cpSync(join(site, "public/demo"), root, { recursive: true });
  return Bun.serve({
    hostname: "127.0.0.1",
    port: port + 2,
    fetch(request) {
      const path = join(root, normalize(new URL(request.url).pathname));
      if (
        !path.startsWith(root) ||
        !existsSync(path) ||
        statSync(path).isDirectory()
      )
        return new Response("Not found", { status: 404 });
      return new Response(Bun.file(path));
    },
  });
}

/** Opens a scene of the demo at its window's size, ready to capture. */
async function scene(browser: Browser, shot: Shot, scheme: Scheme) {
  const spec = shots[shot]!;
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: spec.scale ?? 2,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(
    `http://127.0.0.1:${port + 2}/demo.html?scene=${spec.scene ?? shot}&still`,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.demo === "ready",
    null,
    { timeout: 30_000 },
  );
  await settle(page);
  return page;
}

async function encode(shot: Shot, scheme: Scheme, png: Buffer) {
  const image = sharp(png);
  const { width = 0, height = 0 } = await image.metadata();
  const { widths, scale = 2 } = shots[shot]!;
  for (const target of widths) {
    const resized = image.clone().resize({ width: target });
    const base = join(staging, `${shot}-${scheme}-${target}`);
    await resized
      .clone()
      .avif({ quality: 58, effort: 5 })
      .toFile(`${base}.avif`);
    await resized
      .clone()
      .webp({ quality: 82, effort: 5 })
      .toFile(`${base}.webp`);
  }
  return {
    width: Math.round(width / scale),
    height: Math.round(height / scale),
  };
}

// The vault's source and its Med's address, once `med add` registers it.
let vaultId = "";
let vaultUrl = "";

/** Records the demo: the hero's timeline, the review, and the vault, from a
 * real Med on the fixture. */
async function recordDemo(browser: Browser) {
  createRepository(repo);
  applyRound(repo, 0);
  createVault(vault);
  const transcript = new Transcript(env.HOME, repo);
  transcript.start();
  const { server, token } = await startMed();
  // The vault runs on a second Med server, as `med add` starts one: the Notes
  // screenshot opens it there.
  const vaultServer = ["--port", String(port + 1), "--state-dir", vaultState];
  let waiter: ReturnType<typeof wait> | undefined;
  try {
    vaultId = (
      JSON.parse(med(["add", vault, "--wait", ...vaultServer])) as {
        source: { id: string };
      }
    ).source.id;
    vaultUrl = med(["web", "--no-open", ...vaultServer]).trim();

    // Round one: the agent hands over the review and waits; the reviewer
    // comments on the first file.
    let review = createReview(0);
    transcript.first(review.link);
    waiter = wait();
    let page = await open(browser, token, review.path);
    const first = comments[0]!;
    await addComment(page, first.file, first.line, first.text);
    await page.context().close();

    // The hero: the reviewer sends the comment, and round two answers it while
    // Med records, one file at a time, and hands over the next review.
    await recordHero(browser, token, review.path, async () => {
      await waiter!.exited;
      await transcript.second({
        pause: (ms) => Bun.sleep(ms),
        write: (files) => write(repo, files),
        handoff: () => {
          review = createReview(1);
          return review.link;
        },
      });
      waiter = wait();
    });

    // The reviewer comments on round two, for the other windows.
    const { path } = review;
    page = await open(browser, token, path);
    const second = comments[1]!;
    await addComment(page, second.file, second.line, second.text);
    await page.context().close();

    await record(browser, token, path);
    await recordVault(browser);
  } finally {
    waiter?.kill();
    server.kill();
    await server.exited;
    try {
      med(["stop", ...vaultServer]);
    } catch {
      // The vault server did not start.
    }
  }
}

/** Captures each scene of the demo in both schemes. The captures replace
 * public/screenshots only when all of them succeed. */
async function captureScenes(browser: Browser) {
  const version = med(["--version"]).trim();
  const demo = serveDemo();
  try {
    mkdirSync(staging);
    const manifest: Record<string, unknown> = { med: version };
    for (const shot of Object.keys(shots) as Shot[]) {
      for (const scheme of ["dark", "light"] as const) {
        const page = await scene(browser, shot, scheme);
        // Set SCREENSHOT_PNGS to a directory to keep the full-size captures.
        const keep = (name: string, png: Buffer) => {
          const dir = process.env.SCREENSHOT_PNGS;
          if (dir)
            writeFileSync(join(dir, `${shot}-${scheme}${name}.png`), png);
        };
        const png = await page.screenshot({ animations: "disabled" });
        keep("", png);
        await page.context().close();
        const size = await encode(shot, scheme, png);
        manifest[shot] = { ...size, widths: shots[shot]!.widths };
        console.log(`${shot} ${scheme}: ${size.width}x${size.height}`);
      }
    }
    rmSync(output, { recursive: true, force: true });
    cpSync(staging, output, { recursive: true });
    writeFileSync(
      join(site, "src/screenshots.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await demo.stop(true);
  }
}

// Image work stays on one thread, so other work on the machine keeps its share.
sharp.concurrency(1);
const browser = await chromium.launch();
try {
  if (!shotsOnly) await recordDemo(browser);
  if (!demoOnly) await captureScenes(browser);
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
