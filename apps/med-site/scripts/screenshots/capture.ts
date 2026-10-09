// Captures the site's screenshots from a built Med and the Trailhead fixture,
// then writes AVIF and WebP files and src/screenshots.json.
//
//   MED_CLI=/path/to/apps/med/dist/cli.js bun run screenshots
//
// Med runs on MED_PORT (default 4310) with a temporary home, state, and
// repository. It never uses the default service port or the user's state.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import sharp from "sharp";
import { comments, rounds } from "./fixture.ts";
import { applyRound, createRepository } from "./repo.ts";

type Scheme = "light" | "dark";

const site = join(import.meta.dir, "../..");
const cli = process.env.MED_CLI ?? join(site, "../med/dist/cli.js");
const port = Number(process.env.MED_PORT ?? 4310);
if (port === 4173)
  throw new Error("Port 4173 is the Med service. Use another.");
const origin = `http://127.0.0.1:${port}`;
const output = join(site, "public/screenshots");

// Display widths for srcset. The capture is twice the CSS size.
const shots = {
  review: {
    viewport: { width: 1440, height: 900 },
    widths: [720, 1120, 1680, 2240],
  },
  brief: { viewport: { width: 1280, height: 800 }, widths: [560, 1120] },
  search: { viewport: { width: 720, height: 480 }, widths: [560, 1120] },
};
type Shot = keyof typeof shots;

const scratch = mkdtempSync(join(tmpdir(), "med-site-"));
const repo = join(scratch, "trailhead");
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

function createReview(round: number): string {
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
    "--no-session",
    "--brief",
    brief,
    "--state-dir",
    state,
    "--port",
    String(port),
  ]);
  const link = /\((http:\/\/[^)]+\/review\/[\w-]+)\)/.exec(out)?.[1];
  if (!link) throw new Error(`No review link in:\n${out}`);
  return new URL(link).pathname;
}

async function open(
  browser: Browser,
  token: string,
  path: string,
  scheme: Scheme,
  shot: Shot,
) {
  const context = await browser.newContext({
    viewport: shots[shot].viewport,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  await context.addInitScript((theme) => {
    localStorage.setItem("med:theme:v1", theme);
  }, `graphite-${scheme}`);
  const page = await context.newPage();
  // Med trades the launch token for a cookie, then removes it from the URL.
  await page.goto(`${origin}/#token=${token}`);
  await page.waitForURL((url) => !url.hash.includes("token"));
  // Let the repository's own workspace open first. With the review as a
  // second workspace, the sidebar lists both, the same way in every capture.
  await page.getByText("History", { exact: true }).waitFor();
  await page.goto(`${origin}${path}`);
  await page.getByRole("tab", { name: "Brief" }).waitFor();
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

/** Parks the pointer in the status bar, so no hover state shows. */
async function settle(page: Page) {
  await page.mouse.move(2, page.viewportSize()!.height - 2);
  await page.waitForTimeout(600);
  await checkPrivacy(page);
}

const capture: Record<Shot, (page: Page) => Promise<Buffer>> = {
  // The diff stream at iteration 2, with the reviewer's comment in view.
  async review(page) {
    await page.getByRole("tab", { name: "Changes" }).click();
    await reveal(
      page,
      page.getByText(comments[1]!.text).filter({ visible: true }),
    );
    await settle(page);
    return page.screenshot({ animations: "disabled" });
  },
  // The brief's header, its first paragraph, and the first cited diff.
  async brief(page) {
    await page.getByRole("tab", { name: "Brief" }).click();
    const header = page.getByText(/^Cites \d+ of \d+ changed files$/);
    await header.waitFor();
    await settle(page);
    const top = (await header.boundingBox())!;
    const cards = await page.locator("diffs-container").all();
    let card = null;
    for (const candidate of cards) {
      const box = await candidate.boundingBox();
      if (box && box.y > top.y) {
        card = box;
        break;
      }
    }
    if (!card) throw new Error("No cited diff in the brief.");
    const x = card.x - 28;
    const y = top.y - 32;
    return page.screenshot({
      animations: "disabled",
      clip: {
        x,
        y,
        width: card.width + 56,
        height: card.y + card.height + 14 - y,
      },
    });
  },
  // The file finder with a code preview. ".ts" cannot match a temporary path.
  async search(page) {
    await page.getByRole("tab", { name: "Changes" }).click();
    await page.keyboard.press("Meta+Shift+K");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.keyboard.type(".ts");
    await page.waitForTimeout(800);
    await settle(page);
    return dialog.screenshot({ animations: "disabled" });
  },
};

async function encode(shot: Shot, scheme: Scheme, png: Buffer) {
  const image = sharp(png);
  const { width = 0, height = 0 } = await image.metadata();
  for (const target of shots[shot].widths) {
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
  return { width: Math.round(width / 2), height: Math.round(height / 2) };
}

// Image work stays on one thread, so other work on the machine keeps its share.
sharp.concurrency(1);
const version = med(["--version"]).trim();
createRepository(repo);
applyRound(repo, 0);
const { server, token } = await startMed();
const browser = await chromium.launch();
try {
  let path = createReview(0);
  let page = await open(browser, token, path, "dark", "review");
  const first = comments[0]!;
  await addComment(page, first.file, first.line, first.text);
  await page.context().close();

  applyRound(repo, 1);
  path = createReview(1);
  page = await open(browser, token, path, "dark", "review");
  const second = comments[1]!;
  await addComment(page, second.file, second.line, second.text);
  await page.context().close();

  // Encode into a staging folder; replace public/screenshots only on success.
  mkdirSync(staging);
  const manifest: Record<string, unknown> = { med: version };
  for (const shot of Object.keys(shots) as Shot[]) {
    for (const scheme of ["dark", "light"] as const) {
      page = await open(browser, token, path, scheme, shot);
      // Set SCREENSHOT_PNGS to a directory to keep the full-size captures.
      const keep = (name: string, png: Buffer) => {
        const dir = process.env.SCREENSHOT_PNGS;
        if (dir) writeFileSync(join(dir, `${shot}-${scheme}${name}.png`), png);
      };
      const png = await capture[shot](page).catch(async (error: unknown) => {
        keep("-failed", await page.screenshot());
        throw error;
      });
      keep("", png);
      await page.context().close();
      const size = await encode(shot, scheme, png);
      manifest[shot] = { ...size, widths: shots[shot].widths };
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
  await browser.close();
  server.kill();
  await server.exited;
  rmSync(scratch, { recursive: true, force: true });
}
