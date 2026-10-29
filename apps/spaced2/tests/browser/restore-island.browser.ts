// Where the restore island floats needs real layout, so these tests drive
// the dev server in Chromium. Run with `bun run test:browser`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

const port = Number(process.env.SPACED_BROWSER_PORT ?? 5249) + 1;
const origin = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;

beforeAll(async () => {
  server = Bun.spawn(
    [
      "./node_modules/.bin/vite",
      "--host",
      "127.0.0.1",
      "--port",
      `${port}`,
      "--strictPort",
    ],
    { cwd: `${import.meta.dir}/../..`, stdout: "ignore", stderr: "inherit" },
  );
  for (let tries = 0; ; tries++) {
    if (
      await fetch(origin).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (tries > 100) throw new Error(`No dev server on ${origin}`);
    await Bun.sleep(100);
  }
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

const STATE = "spaced-records-v3-state";

/**
 * A new device that restores an account's cards: its sync state has the
 * account's scope and has not reached the end, and the server never
 * answers, so the restore goes on. `top` is the status bar's inset.
 */
async function restoring(
  size: { width: number; height: number },
  path = "/",
  top = 0,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
): Promise<Page> {
  const context = await browser.newContext({ viewport: size, reducedMotion });
  await context.route("**/api/**", () => new Promise(() => {}));
  const page = await context.newPage();
  if (top > 0) {
    const cdp = await context.newCDPSession(page);
    const insets = { top, left: 0, right: 0, bottom: 0 };
    await cdp
      .send("Emulation.setSafeAreaInsetsOverride", {
        insets: {
          ...insets,
          topMax: top,
          leftMax: 0,
          rightMax: 0,
          bottomMax: 0,
        },
      })
      .catch(() => {});
  }
  await page.goto(`${origin}${path}`);
  await page.waitForFunction((key) => localStorage.getItem(key), STATE);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        bootstrapped: false,
        scope: {
          origin: location.origin,
          userId: "user-1",
          namespace: "spaced",
          epoch: "1",
        },
      }),
    );
    localStorage.setItem(
      "spaced-sync-status",
      JSON.stringify({ user: { userId: "user-1", name: "Sam" } }),
    );
  }, STATE);
  await page.reload();
  await page.locator(".ba-island[data-settled]").waitFor();
  return page;
}

/**
 * Another tab ends the restore: the island says "Restored" and folds. Its
 * width, travel and transitions as it folds, and its words' width.
 */
async function fold(page: Page) {
  // The fold lasts 0.32 s: the page notes it as it starts.
  const folding = page.evaluate(
    () =>
      new Promise<
        Record<"width" | "dx" | "dy" | "words" | "transition", string>
      >((resolve) =>
        new MutationObserver((_, observer) => {
          const island = document.querySelector<HTMLElement>(
            ".ba-island[data-fold]",
          );
          if (!island) return;
          observer.disconnect();
          resolve({
            width: island.style.width,
            dx: island.style.getPropertyValue("--ba-island-dx"),
            dy: island.style.getPropertyValue("--ba-island-dy"),
            words: `${island.querySelector(".ba-island-words")!.scrollWidth}px`,
            transition: getComputedStyle(island).transitionProperty,
          });
        }).observe(document.body, { attributes: true, subtree: true }),
      ),
  );
  const other = await page.context().newPage();
  await other.goto(`${origin}/`);
  await other.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...state, bootstrapped: true }));
  }, STATE);
  return folding;
}

/** The island's box, and the controls under it other than its mark. */
function underIsland(page: Page) {
  return page.evaluate(() => {
    const island = document
      .querySelector(".ba-island")!
      .getBoundingClientRect();
    const mark = document.querySelector(".ba-island-slot")!;
    const covered = [...document.querySelectorAll("a, button, input")]
      .filter((control) => {
        if (mark.contains(control) || control.contains(mark)) return false;
        const box = control.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.left < island.right &&
          box.right > island.left &&
          box.top < island.bottom &&
          box.bottom > island.top
        );
      })
      .map(
        (control) => control.getAttribute("aria-label") ?? control.textContent,
      );
    return {
      top: island.top,
      offCentre: Math.abs(
        island.left +
          island.width / 2 -
          document.documentElement.clientWidth / 2,
      ),
      covered,
    };
  });
}

test("at every width, the island floats at the top centre over every page and covers no control", async () => {
  for (const width of [320, 390, 768, 1280, 1920])
    for (const path of ["/", "/decks", "/profile"]) {
      const page = await restoring({ width, height: 800 }, path);
      expect({ width, path, ...(await underIsland(page)) }).toEqual({
        width,
        path,
        top: 8,
        offCentre: 0,
        covered: [],
      });
      await page.context().close();
    }
}, 120_000);

test("it floats below a status bar that the page reaches under", async () => {
  const page = await restoring({ width: 390, height: 844 }, "/", 47);
  expect((await underIsland(page)).top).toBe(47 + 8);
  await page.context().close();
}, 30_000);

test("on a phone, it floats over the icon and folds into it", async () => {
  const page = await restoring({ width: 390, height: 844 });
  expect(await page.locator(".ba-island").textContent()).toBe(
    "Restoring cards",
  );
  // The icon steps aside under it.
  expect(
    await page.locator(".ba-island-rest").getAttribute("data-hidden"),
  ).toBe("true");

  // From its middle at 8 + 18 px into the icon's, 64 × 48 at 16 px.
  expect(await fold(page)).toMatchObject({
    width: "64px",
    dx: "0px",
    dy: "14px",
  });
  await page.locator(".ba-island").waitFor({ state: "detached" });
  expect(
    await page.locator(".ba-island-rest").getAttribute("data-hidden"),
  ).toBeNull();
  await page.context().close();
}, 30_000);

test("with reduced motion, it fades in and out at its words' width, without moving", async () => {
  const page = await restoring({ width: 390, height: 844 }, "/", 0, "reduce");
  const { words, ...folding } = await fold(page);
  // "Restored"'s width: the words change at once, and the shape with them.
  expect(folding).toEqual({
    width: words,
    dx: "0px",
    dy: "0px",
    transition: "opacity",
  });
  await page.context().close();
}, 30_000);
