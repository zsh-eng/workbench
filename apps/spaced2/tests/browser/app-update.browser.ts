// The app update waits for a safe moment, on the production service worker.
// Run after `bun run build`: `bun run test:update`. The test serves a copy of
// dist/ and publishes new versions into it, so the worker finds a real update.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const port = Number(process.env.SPACED_UPDATE_PORT ?? 5250);
const origin = `http://127.0.0.1:${port}`;
let root = "";
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser;
let page: Page;
let version = 1;

/** Resolves once `check` is true; fails after `timeout`. */
async function until(check: () => Promise<boolean>, timeout = 5_000) {
  for (const start = Date.now(); !(await check()); await Bun.sleep(100))
    if (Date.now() - start > timeout) throw new Error("Timed out");
}

const md5 = (text: string) => createHash("md5").update(text).digest("hex");

/** A new version: index.html changes, so its precache revision does too. */
function publishVersion(): string {
  version += 1;
  const label = `version ${version}`;
  const indexPath = path.join(root, "index.html");
  const before = readFileSync(indexPath, "utf8");
  const after = before.replace("</body>", `<!-- ${label} --></body>`);
  writeFileSync(indexPath, after);
  const swPath = path.join(root, "sw.js");
  const sw = readFileSync(swPath, "utf8");
  expect(sw).toContain(md5(before));
  writeFileSync(swPath, sw.replaceAll(md5(before), md5(after)));
  return label;
}

beforeAll(async () => {
  const dist = path.resolve(import.meta.dir, "../../dist");
  if (!existsSync(path.join(dist, "sw.js")))
    throw new Error("Build first: bun run build");
  root = mkdtempSync(path.join(tmpdir(), "spaced-update-"));
  cpSync(dist, root, { recursive: true });
  // Cloudflare's static assets: a file, else the app for a page.
  server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(request) {
      const file = path.join(root, new URL(request.url).pathname);
      if (existsSync(file) && statSync(file).isFile())
        return new Response(Bun.file(file));
      return new Response(Bun.file(path.join(root, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Signed out: no request reaches a real server.
  await context.route("https://api.zsheng.app/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  page = await context.newPage();
  await page.goto(`${origin}/create`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  if (root) rmSync(root, { recursive: true, force: true });
});

async function checkForUpdate() {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
    undefined,
    { timeout: 20_000 },
  );
}

/** Hides the page, moves the clock on by `ms`, and shows it again. */
async function awayFor(ms: number) {
  await page.evaluate((ms) => {
    const set = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set(true);
    const now = Date.now.bind(Date);
    Date.now = () => now() + ms;
    window.setTimeout(() => set(false), 50);
  }, ms);
  await page.waitForTimeout(100);
}

/** The page is that version. False while it reloads. */
const pageHas = (label: string) =>
  page
    .evaluate(
      (text) => document.documentElement.outerHTML.includes(text),
      label,
    )
    .catch(() => false);
const marked = () =>
  page.evaluate(() => (window as { __before?: boolean }).__before === true);
const restart = () => page.getByRole("button", { name: "Restart to update" });

test("an update waits while you review, then applies when you come back", async () => {
  for (const front of ["Capital of France?", "Capital of Spain?"]) {
    await page.getByPlaceholder("Enter the question").fill(front);
    await page.getByPlaceholder("Enter the answer").fill("A city");
    await page.getByRole("button", { name: /^Create/ }).click();
    await until(
      async () =>
        (await page.getByPlaceholder("Enter the question").inputValue()) === "",
    );
  }
  await page.getByRole("link", { name: "Review" }).click();
  const good = page.getByRole("button", { name: "Good", exact: true });
  await good.waitFor();
  await page.evaluate(() => {
    (window as { __before?: boolean }).__before = true;
  });

  const label = publishVersion();
  await checkForUpdate();
  // Mid-review: no pill, no reload, even after a long time away.
  await awayFor(10 * 60_000);
  await page.waitForTimeout(1_500);
  expect(await marked()).toBe(true);
  expect(await pageHas(label)).toBe(false);
  expect(await restart().count()).toBe(0);

  // The review ends. The update shows, and waits for the next moment.
  for (let card = 0; card < 4 && (await good.isVisible()); card++) {
    await good.click();
    await page.waitForTimeout(300);
  }
  await page.getByText("You're done for now!").waitFor();
  await restart().waitFor();
  expect(await marked()).toBe(true);

  const reloaded = page.waitForEvent("load");
  await awayFor(3 * 60_000);
  await reloaded;
  await until(() => pageHas(label));
  await page.getByText("Updated", { exact: true }).waitFor();
}, 60_000);

test("a tap on Restart applies it at once", async () => {
  await page.getByRole("link", { name: "Decks" }).click();
  await page.evaluate(() => {
    (window as { __before?: boolean }).__before = true;
  });
  const label = publishVersion();
  await checkForUpdate();
  await restart().waitFor();
  // Moving between pages is not a moment to switch.
  await page.getByRole("link", { name: "Saved" }).click();
  await page.waitForTimeout(500);
  expect(await marked()).toBe(true);

  const reloaded = page.waitForEvent("load");
  await restart().click();
  await reloaded;
  await until(() => pageHas(label));
  expect(new URL(page.url()).pathname).toBe("/saved");
  await page.getByText("Updated", { exact: true }).waitFor();
}, 60_000);

test("a waiting update applies at the next launch", async () => {
  await page.getByRole("link", { name: "Decks" }).click();
  const label = publishVersion();
  await checkForUpdate();
  await page.reload();
  await until(() => pageHas(label), 10_000);
}, 60_000);
