// The view settings outlast a restart: the built Med and a browser with its
// own profile, closed and opened again with the server stopped and started on
// the same port (docs/USAGE.md, "View settings"). The first window has no
// stored settings, so it shows the defaults; each later one shows what the
// one before it chose. Set MED_VIEW_SETTINGS_SHOTS to a folder for screenshots.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { removeGitEnvironment } from "./git-environment.mjs";
import { useFakeGh } from "./fake-gh.mjs";

removeGitEnvironment();
// Med must never reach GitHub here: gh is a stand-in (scripts/fake-gh.mjs).
const fakeGh = useFakeGh();
// A run inside an agent session or a Med thread must not link them to the review.
for (const name of [
  "CLAUDE_CODE_SESSION_ID",
  "MED_SESSION",
  "MED_THREAD_KEY",
  "MED_THREAD_REPO",
  "MED_PORT",
  "MED_STATE_DIR",
])
  delete process.env[name];
const executable = process.env.MED_EXECUTABLE;
const command = executable ? resolve(executable) : process.execPath;
const cliArgs = executable ? [] : ["dist/cli.js"];
const shots = process.env.MED_VIEW_SETTINGS_SHOTS;
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-view-settings-")));
const repo = join(directory, "repo");
const home = join(directory, "home");
const stateDir = join(directory, "state");
const profile = join(directory, "profile");
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Med validation",
      GIT_AUTHOR_EMAIL: "validation@example.invalid",
      GIT_COMMITTER_NAME: "Med validation",
      GIT_COMMITTER_EMAIL: "validation@example.invalid",
    },
  }).trim();

let host;
async function stopHost() {
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
}
/** Starts Med; the same port again keeps the page's origin, and so its storage. */
async function launch(port = 0) {
  host = spawn(
    command,
    [...cliArgs, repo, "--no-open", "--port", String(port), "--state-dir", stateDir],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The session's transcript is in this home; the user's are not read.
        MED_HOME_DIR: home,
        MED_SEARCH_CACHE: join(directory, "search-cache"),
        MED_ZOEKT_BIN: join(directory, "no-search-binaries"),
      },
    },
  );
  let errors = "";
  host.stderr.on("data", (chunk) => (errors += chunk));
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Med did not start: ${errors}`)), 30000);
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Med exited ${code}: ${errors}`));
    });
  });
  const parsed = new URL(url);
  return { origin: parsed.origin, port: Number(parsed.port), hash: parsed.hash };
}

let context;
const pageErrors = [];
/** Opens the review in a new browser on the one profile, as after a restart. */
async function open(server) {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 2200, height: 1000 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.origin}/review/${reviewId}${server.hash}`);
  await page.locator("[data-diff-type]").first().waitFor();
  await page.waitForTimeout(500);
  return page;
}
async function palette(page, label) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox", { name: "Search commands" }).fill(label);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
}
/** What the diff shows, read from the page. */
async function diffView(page) {
  const diff = page.locator("[data-diff-type]").first();
  // Pierre names a unified diff "single".
  const type = await diff.getAttribute("data-diff-type");
  return {
    layout: type === "single" ? "unified" : type,
    wrap: (await diff.getAttribute("data-overflow")) === "wrap",
  };
}
/** Whether the review's View menu shows comments (quiet chrome's ⋯ → View). */
async function commentsShown(page) {
  await page
    .getByRole("button", { name: "More actions" })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  const item = page.getByRole("menuitemcheckbox", { name: "Show comments" });
  const shown = (await item.getAttribute("aria-checked")) === "true";
  return shown;
}
const closeMenus = async (page) => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // The menu and its View submenu close together.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="menu"]')].every((menu) => !menu.checkVisibility()),
  );
};
const sidebar = (page) => page.locator('nav[aria-label="Threads"]');
const sessionPane = (page) => page.locator("[data-session-panel]").filter({ visible: true });
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const resizer = (page, name) =>
  page.getByRole("separator", { name }).filter({ visible: true }).first();
async function restart(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
  await context.close();
  context = undefined;
  const port = server.port;
  await stopHost();
  server = await launch(port);
  assert.equal(server.port, port);
}

let server;
let reviewId;
try {
  if (shots) await mkdir(shots, { recursive: true });
  await mkdir(repo);
  git("init", "-b", "main");
  git("config", "commit.gpgsign", "false");
  const line = (words) => `export const note = "${words}";\n`;
  await writeFile(join(repo, "notes.ts"), line("short"));
  git("add", ".");
  git("commit", "-m", "baseline");
  // A long line, so that wrapping shows.
  await writeFile(
    join(repo, "notes.ts"),
    line("a long line that runs past the edge of the diff when it does not wrap ".repeat(6).trim()),
  );
  // A session for the thread: one prompt and one reply.
  const sessionId = "4f9a1c2e-8b7d-4e3f-9a10-2b3c4d5e6f70";
  const project = join(home, ".claude", "projects", repo.replace(/[^A-Za-z0-9-]/g, "-"));
  await mkdir(project, { recursive: true });
  const at = (second) => `2026-10-01T09:00:0${second}.000Z`;
  await writeFile(
    join(project, `${sessionId}.jsonl`),
    [
      {
        type: "user",
        uuid: "u1",
        timestamp: at(1),
        message: { role: "user", content: "Wrap the note." },
      },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: at(2),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The note is one long line now." }],
          stop_reason: "end_turn",
        },
      },
    ]
      .map((entry) => JSON.stringify({ ...entry, cwd: repo, sessionId }))
      .join("\n") + "\n",
  );
  server = await launch();
  const link = execFileSync(
    command,
    [
      ...cliArgs,
      ...["review", "create", "--repo", repo, "--working", "--title", "View settings"],
      ...["--key", "view-settings", "--session", `claude:${sessionId}`, "--no-pr"],
      ...["--port", String(server.port), "--state-dir", stateDir],
    ],
    // The CLI reads the session's transcript from the fixture home too.
    { encoding: "utf8", env: { ...process.env, MED_HOME_DIR: home } },
  );
  reviewId = /\/review\/(r_[a-z0-9]+)/.exec(link)[1];

  // 1. A new profile: nothing stored, so each setting has its default.
  let page = await open(server);
  assert.deepEqual(await diffView(page), { layout: "split", wrap: false });
  assert.equal(await commentsShown(page), true);
  await closeMenus(page);
  await sidebar(page).waitFor();
  await sessionPane(page).waitFor();
  const firstTheme = await theme(page);
  const sidebarWidth = Number(await resizer(page, "Resize sidebar").getAttribute("aria-valuenow"));
  const gutter = resizer(page, /^Resize .*session/i);
  const firstShare = Number(await gutter.getAttribute("aria-valuenow"));

  // A second window on the same profile, to see which choices follow.
  const other = await context.newPage();
  other.on("pageerror", (error) => pageErrors.push(error.message));
  await other.goto(`${server.origin}/review/${reviewId}${server.hash}`);
  await other.locator("[data-diff-type]").first().waitFor();

  // The reader changes them. A shared setting reaches the other window at once.
  await page.bringToFront();
  await palette(page, "Wrap lines in diffs");
  await other.locator('[data-diff-type][data-overflow="wrap"]').first().waitFor();
  await palette(page, "Use unified diff layout");
  await palette(page, "Hide comments");
  assert.deepEqual(await diffView(page), { layout: "unified", wrap: true });
  await palette(page, "Change theme");
  await page.getByRole("combobox", { name: "Search themes" }).fill("Paper Light");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "paper-light");
  assert.notEqual(firstTheme, "paper-light");
  await resizer(page, "Resize sidebar").focus();
  for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
  await gutter.focus();
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowRight");
  const share = Number(await gutter.getAttribute("aria-valuenow"));
  assert.notEqual(share, firstShare);
  const width = Number(await resizer(page, "Resize sidebar").getAttribute("aria-valuenow"));
  assert.equal(width, sidebarWidth + 48);
  await page.keyboard.press("ControlOrMeta+b");
  await sidebar(page).waitFor({ state: "hidden" });
  // Each window keeps its own sidebar until it opens again.
  await page.waitForTimeout(300);
  assert.equal(await sidebar(other).isVisible(), true);
  await other.close();
  // The sidebar's width and the panes are saved after a short pause.
  await page.waitForTimeout(600);
  await restart(page, "1-changed");

  // 2. Closed and opened again, with a new server: the choices are back.
  page = await open(server);
  assert.deepEqual(await diffView(page), { layout: "unified", wrap: true });
  assert.equal(await commentsShown(page), false);
  if (shots) await page.screenshot({ path: join(shots, "2-reopened-view-menu.png") });
  await closeMenus(page);
  assert.equal(await theme(page), "paper-light");
  await sidebar(page).waitFor({ state: "hidden" });
  assert.equal(
    Number(await resizer(page, /^Resize .*session/i).getAttribute("aria-valuenow")),
    share,
  );
  await page.keyboard.press("ControlOrMeta+b");
  await sidebar(page).waitFor();
  assert.equal(
    Number(await resizer(page, "Resize sidebar").getAttribute("aria-valuenow")),
    sidebarWidth + 48,
  );
  // More choices for the next restart: the session pane and the full chrome.
  await page.keyboard.press("ControlOrMeta+Shift+b");
  await sessionPane(page).waitFor({ state: "hidden" });
  await palette(page, "Use full chrome");
  await page.getByRole("button", { name: "View options" }).waitFor();
  await page.waitForTimeout(600);
  await restart(page, "2-changed-again");

  // 3. Opened again: the session pane stays hidden, and the chrome is full.
  page = await open(server);
  await page.getByRole("button", { name: "View options" }).waitFor();
  assert.equal(await sessionPane(page).count(), 0);
  await sidebar(page).waitFor();
  assert.deepEqual(await diffView(page), { layout: "unified", wrap: true });
  if (shots) await page.screenshot({ path: join(shots, "3-reopened.png") });

  assert.deepEqual(pageErrors, []);
  fakeGh.check();
  console.log(
    JSON.stringify({
      checks:
        "defaults in a new profile; a second window follows wrap at once and keeps its own sidebar; diff wrap, layout, comments, theme, sidebar hidden and width, and pane share after closing the browser and restarting Med; session pane hidden and full chrome after a second restart",
      restarts: 2,
      pageErrors,
    }),
  );
} finally {
  await context?.close();
  await stopHost();
  await rm(directory, { recursive: true, force: true });
}
