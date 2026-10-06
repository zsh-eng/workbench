// Rebuild detection and self-restart through the built CLI and a real browser.
// A copy of dist stands in for the build, so the check can change it safely.
// The copy stays inside the app so the server bundle resolves its packages.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const exec = promisify(execFile);
const app = resolve(import.meta.dirname, "..");
const output = join(app, ".benchmarks/restart");
await mkdir(output, { recursive: true });
const dir = await mkdtemp(join(output, "run-"));
const state = await mkdtemp(join(tmpdir(), "med-restart-state-")),
  dist = join(dir, "dist"),
  cli = join(dist, "cli.js");
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
// Status and stop use the real CLI; the copy is broken on purpose below.
const run = async (...args) =>
  (
    await exec(process.execPath, [...args, "--state-dir", state, "--port", String(port)], {
      cwd: dir,
      timeout: 30000,
    })
  ).stdout.trim();
const status = async () => JSON.parse(await run(join(app, "dist/cli.js"), "status"));
const until = async (condition, label) => {
  for (let i = 0; i < 150; i++) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const exited = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
};

let browser;
try {
  await cp(join(app, "dist/cli.js"), cli);
  await cp(join(app, "dist/assets"), join(dist, "assets"), { recursive: true });
  await cp(join(app, "dist/web"), join(dist, "web"), { recursive: true });
  const launch = await run(cli, "web", "--no-open");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(launch);
  await page.waitForLoadState("load");
  const notice = page.getByRole("status", { name: "Med update" });
  const check = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(800);
  assert.equal(await notice.count(), 0, "a current build shows no notice");

  // A newer page build on disk: the page offers Reload.
  const index = join(dist, "web/index.html");
  const html = await readFile(index, "utf8");
  const entry = /src="\/assets\/([^"]+)\.js"/.exec(html)[1];
  await cp(join(dist, "web/assets", `${entry}.js`), join(dist, "web/assets", `${entry}-next.js`));
  await writeFile(index, html.replace(`/assets/${entry}.js`, `/assets/${entry}-next.js`));
  await check();
  await notice.getByText("Med was updated.").waitFor();
  await page.screenshot({ path: join(output, "reload.png") });
  await Promise.all([
    page.waitForEvent("load"),
    notice.getByRole("button", { name: "Reload" }).click(),
  ]);
  await page.waitForTimeout(800);
  assert.equal(await notice.count(), 0, "the reloaded page is current");

  // A broken server build: Restart reports it and the server keeps running.
  const first = (await status()).pid;
  const good = await readFile(cli, "utf8");
  const [shebang, ...rest] = good.split("\n");
  await writeFile(cli, [shebang, 'throw new Error("broken build");', ...rest].join("\n"));
  await check();
  await notice.getByRole("button", { name: "Restart" }).click();
  await notice.getByText(/The new build does not start \(Error: broken build\)/).waitFor();
  await page.screenshot({ path: join(output, "failed.png") });
  assert.equal((await status()).pid, first, "a broken build keeps the current server");

  // A working server build: Try again replaces the server and reloads the page.
  await writeFile(cli, good);
  await appendFile(cli, "\n// rebuilt\n");
  await Promise.all([
    page.waitForEvent("load", { timeout: 30000 }),
    notice.getByRole("button", { name: "Try again" }).click(),
  ]);
  const second = (await status()).pid;
  assert.notEqual(second, first, "a new server process runs");
  await until(() => exited(first), "old server exits");
  await page.waitForTimeout(800);
  assert.equal(await notice.count(), 0, "the restarted server is current");

  // A second rebuild offers Restart directly.
  await appendFile(cli, "// rebuilt again\n");
  await check();
  await notice.getByText("Med was rebuilt.").waitFor();
  await page.screenshot({ path: join(output, "restart.png") });
  await Promise.all([
    page.waitForEvent("load", { timeout: 30000 }),
    notice.getByRole("button", { name: "Restart" }).click(),
  ]);
  const third = (await status()).pid;
  assert.notEqual(third, second);
  await until(() => exited(second), "second server exits");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: ["current", "page-reload", "broken-build-kept", "restart-after-fix", "restart"],
      pids: [first, second, third],
    }),
  );
} catch (error) {
  console.error(await readFile(join(state, "service.log"), "utf8").catch(() => ""));
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error(
      "Notice:",
      await page
        .getByRole("status")
        .allInnerTexts()
        .catch(() => []),
    );
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await run(join(app, "dist/cli.js"), "stop").catch(() => {});
  await rm(dir, { recursive: true, force: true });
  await rm(state, { recursive: true, force: true });
}
