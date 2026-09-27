import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
const exec = promisify(execFile),
  dir = await mkdtemp(join(tmpdir(), "med-service-check-"));
const state = join(dir, "state"),
  vault = join(dir, "vault"),
  repo = join(dir, "repo");
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const app = resolve(import.meta.dirname, "..");
const binary = process.env.MED_EXECUTABLE,
  cli = join(app, "dist/cli.js");
const run = async (...args) =>
  (
    await exec(
      binary ? resolve(binary) : process.execPath,
      [...(binary ? [] : [cli]), ...args, "--state-dir", state, "--port", String(port)],
      { cwd: dir, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout.trim();
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Condition timed out");
};
let browser;
try {
  await mkdir(join(vault, ".obsidian"), { recursive: true });
  await mkdir(join(vault, "Assets"));
  await writeFile(
    join(vault, "Home.md"),
    "# Home\n\nA small vault for the service check.\n\n[[Target|Open target]]\n\n![[pixel.png|120]]\n\n`[[Not a link]]`\n",
  );
  await writeFile(join(vault, "Target.md"), "# Target\n\nThis is the linked note.\n");
  await writeFile(
    join(vault, "Assets", "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await mkdir(repo);
  await exec("git", ["init", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial",
  ]);
  const [addedText, url] = await Promise.all([
    run("add", vault, "--wait"),
    run("web", "--no-open"),
  ]);
  const added = JSON.parse(addedText).source;
  assert.match(url, /\/sources#token=/);
  const initial = JSON.parse(await run("status"));
  assert.equal(initial.sources.length, 1);
  await run("add", repo);
  assert.equal(JSON.parse(await run("status")).pid, initial.pid);
  const conn = JSON.parse(await readFile(join(state, "connections", `${port}.json`), "utf8"));
  const api = async (action, body = {}) => {
    const r = await fetch(`${conn.origin}/api/service/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    assert.equal(r.status, 200, JSON.stringify(data));
    return data;
  };
  const repositoryRequest = async (method, suffix = "", body) => {
    const response = await fetch(`${conn.origin}/api/repositories${suffix}`, {
      method,
      headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const registered = (await repositoryRequest("GET")).repositories[0];
  await repositoryRequest("DELETE", `?id=${registered.id}`);
  assert.equal((await api("status")).sources.length, 1);
  await repositoryRequest("POST", "", { path: repo });
  assert.equal((await api("status")).sources.length, 2);
  assert.equal((await api("backlinks", { id: added.id, path: "Target.md" })).backlinks.length, 1);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator(`a[href="/vault/${added.id}"]`).click();
  await page.getByRole("button", { name: "Home.md", exact: true }).click();
  const preview = page.getByRole("button", { name: "Toggle Markdown preview", exact: true });
  await preview.waitFor();
  if ((await preview.getAttribute("aria-pressed")) !== "true") await preview.click();
  await page.locator(".med-markdown").waitFor();
  await page.locator(".med-markdown img").waitFor();
  await until(() =>
    page.locator(".med-markdown img").evaluate((img) => img.complete && img.naturalWidth === 1),
  );
  await page.getByRole("link", { name: "Open target", exact: true }).click();
  await page
    .getByRole("region", { name: "Backlinks" })
    .getByRole("button", { name: /Home.md/ })
    .waitFor();
  await page
    .getByRole("region", { name: "Backlinks" })
    .getByRole("button", { name: /Home.md/ })
    .click();
  await page.locator(".med-markdown h1").filter({ hasText: "Home" }).waitFor();
  await page.keyboard.press("Meta+k");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Find vault note" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole("textbox", { name: "Find vault note" }).fill("Target");
  assert.equal(
    await page.getByRole("navigation", { name: "Vault notes" }).getByRole("button").count(),
    1,
  );
  await page.getByRole("textbox", { name: "Find vault note" }).fill("");
  const revision = (await api("status")).sources.find((s) => s.id === added.id).index.revision;
  await writeFile(join(vault, "Home.md"), "# Home\n\nNo outgoing links now.\n");
  await until(async () => {
    const s = (await api("status")).sources.find((s) => s.id === added.id);
    return s.index.state === "ready" && s.index.revision > revision;
  });
  assert.equal((await api("backlinks", { id: added.id, path: "Target.md" })).backlinks.length, 0);
  await page.getByRole("button", { name: "Target.md", exact: true }).first().click();
  await page.locator(".med-markdown h1").filter({ hasText: "Target" }).waitFor();
  await until(() =>
    page
      .getByRole("region", { name: "Backlinks" })
      .getByRole("button")
      .count()
      .then((n) => n === 0),
  );
  const output = join(app, ".benchmarks/service");
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, binary ? "standalone-vault.png" : "vault.png") });
  await run("remove", added.id);
  assert.equal((await api("status")).sources.length, 1);
  await stat(join(vault, "Home.md"));
  await browser.close();
  browser = undefined;
  await run("stop");
  assert.equal(JSON.parse(await run("status")).running, false);
  await run("web", "--no-open");
  assert.equal(JSON.parse(await run("status")).sources.length, 1);
  await run("stop");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      standalone: Boolean(binary),
      checks: [
        "concurrent-start",
        "single-owner",
        "registration",
        "wiki-links",
        "images",
        "backlinks",
        "watch-update",
        "commands",
        "remove-preserves-files",
        "stop",
        "restart",
      ],
      screenshot: join(output, binary ? "standalone-vault.png" : "vault.png"),
    }),
  );
} catch (error) {
  console.error(await readFile(join(state, "service.log"), "utf8").catch(() => ""));
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error((await page.locator("body").innerText()).slice(0, 4000));
      await page.screenshot({ path: "/private/tmp/med-service-failure.png" });
    }
  }
  throw error;
} finally {
  await browser?.close();
  await run("stop").catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
