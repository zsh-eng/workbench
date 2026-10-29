import { expect, test, type Page } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp, sorted } from "./phone";

// A new device: the phone's first upload sent every article/ record, then
// every library/ record, then every tags/ record, each family sorted by key.
// 300 links make two pull pages, the second with the rest of library/.
const links = Array.from({ length: 300 }, (_, index) =>
  article(`https://example.com/floe/${index}`, {
    title: `Floe ${index}`,
    savedAt: Date.UTC(2026, 9, 1) + index * 60_000,
  }),
);
const newest = links.at(-1)!;
const byKey = (records: { key: string; value: string }[]) =>
  records.sort((a, b) => (a.key < b.key ? -1 : 1));

test.beforeEach(async ({ context }) => {
  await signUp(context);
  const records = links.flatMap((link) => link.records);
  const ordered = ["article/", "library/", "tags/"].flatMap((family) =>
    byKey(records.filter((record) => record.key.startsWith(family))),
  );
  for (let start = 0; start < ordered.length; start += 450)
    await phone(context.request).push(ordered.slice(start, start + 450));
  await addText(context.request, newest, paragraphs(400));
  await phone(context.request, "arctic-annotations").push([
    {
      key: "annotation/5E0C2D7A-6B4F-4C1D-9E8A-0F1B2C3D4E5F",
      value: sorted({
        articleURL: newest.url,
        colour: "sage",
        createdAt: 815_000_000,
        id: "5E0C2D7A-6B4F-4C1D-9E8A-0F1B2C3D4E5F",
        isHighlighted: true,
        note: "",
        quote: {
          exact: "Paragraph 3. Sea ice forms",
          prefix: "",
          suffix: "",
          start: 0,
        },
        updatedAt: 815_000_000,
      }),
    },
  ]);
});

test("a new device shows its library once, in order, then its texts and highlights", async ({
  page,
}) => {
  // What the first frame with real cards showed: the count and the top card.
  await page.addInitScript(() => {
    const seen = { count: "", top: "" };
    (window as { __first?: typeof seen }).__first = seen;
    const look = () => {
      const top = document.querySelector(".card[data-id] .card-title");
      if (top) {
        seen.top = top.textContent ?? "";
        seen.count = document.querySelector(".shelf-count")?.textContent ?? "";
      } else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "OPTIONS")
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto("/");
  await expect(page.locator(".card[data-id]").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as { __first?: { count: string; top: string } }).__first,
    ),
  ).toMatchObject({ count: "300 articles", top: "Floe 299" });

  // Texts and highlights arrive after the links.
  await expect(
    page.locator(".card", { hasText: "Floe 299" }).locator(".source"),
  ).toContainText("min");
  await page.getByRole("link", { name: "Highlights" }).click();
  await expect(page.getByText("Paragraph 3. Sea ice forms")).toBeVisible();

  // The account check brought the links' scope, and nothing was pushed.
  expect(requests).not.toContain("GET /api/apps/arctic/sync/v3/state");
  expect(requests.filter((line) => line.endsWith("/sync/v3/push"))).toEqual([]);
});

/** Holds the links' pull until `release`, so the restore island shows. */
async function holdLinks(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    "**/api/apps/arctic/sync/v3/pull-stream**",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  return release;
}

test("on a phone, the restore island says what it waits for, and folds into the account button", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const release = await holdLinks(page);
  await page.goto("/");
  const island = page.locator(".strip .ba-island-slot");
  await expect(island.getByRole("status")).toHaveText("Getting your library…");
  await expect(page.locator(".ba-island")).toHaveText("Getting your library");
  await expect(page.locator(".grid.waiting")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await context.setOffline(true);
  await expect(page.locator(".ba-island")).toHaveText(
    "Waiting for a connection",
  );
  await expect(island.getByRole("status")).toHaveText(
    "Getting your library… Waiting for a connection.",
  );
  await context.setOffline(false);
  // Its fold lasts 0.32 s: the page notes where it goes.
  const fold = page.evaluate(
    () =>
      new Promise<{ dx: number; dy: number }>((resolve) =>
        new MutationObserver((_, observer) => {
          const pill = document.querySelector<HTMLElement>(
            ".ba-island[data-fold]",
          );
          if (!pill) return;
          observer.disconnect();
          resolve({
            dx: parseFloat(pill.style.getPropertyValue("--ba-island-dx")),
            dy: parseFloat(pill.style.getPropertyValue("--ba-island-dy")),
          });
        }).observe(document.body, { attributes: true, subtree: true }),
      ),
  );
  release();
  await expect(page.locator(".card[data-id]").first()).toBeVisible();
  await expect(island.getByRole("status")).toHaveText("Library ready");
  // It folds up and right, into the account button at the strip's end.
  const travel = await fold;
  expect(travel.dx).toBeGreaterThan(100);
  expect(travel.dy).toBeLessThan(-30);
  await expect(island).toHaveAttribute("data-island", "rest");
  // The account button keeps its place in the strip.
  const strip = await page.locator(".strip").boundingBox();
  const avatar = await page
    .getByRole("button", { name: "Account" })
    .boundingBox();
  expect(avatar!.y).toBeGreaterThanOrEqual(strip!.y);
  expect(avatar!.y + avatar!.height).toBeLessThanOrEqual(
    strip!.y + strip!.height,
  );
});

test("with room, the restore island folds away by the count", async ({
  page,
}) => {
  const release = await holdLinks(page);
  await page.goto("/");
  const island = page.locator(".desk-head .ba-island-slot");
  await expect(island.getByRole("status")).toHaveText("Getting your library…");
  release();
  await expect(island.getByRole("status")).toHaveText("Library ready");
  await expect(island).toHaveAttribute("data-island", "rest");
  await expect(island.locator(".shelf-count")).toHaveText("300 articles");
});

/**
 * The controls of the library's bars that the island covers (the phone's
 * strip, the bar and the shelf's tabs, or the desk's bar, title and
 * sidebar), and its distance from the window's centre line.
 */
function underIsland(page: Page) {
  return page.evaluate(() => {
    const open = document.querySelector(".ba-island[data-settled]");
    if (!open) return null;
    const island = open.getBoundingClientRect();
    const bars = document.querySelectorAll(
      ".strip, .bar, .shelf, .desk-bar, .desk-head, .sidebar, .library-dock",
    );
    const covered = [...bars]
      .flatMap((bar) => [...bar.querySelectorAll("a, button, input")])
      .filter((control) => {
        const box = control.getBoundingClientRect();
        return (
          box.width > 0 &&
          control.checkVisibility({ opacityProperty: true }) &&
          box.left < island.right &&
          box.right > island.left &&
          box.top < island.bottom &&
          box.bottom > island.top
        );
      })
      .map(
        (control) => control.getAttribute("aria-label") ?? control.textContent,
      );
    const centre = island.left + island.width / 2;
    return {
      covered,
      offCentre: Math.round(
        Math.abs(centre - document.documentElement.clientWidth / 2),
      ),
    };
  });
}

test("at every width, the restore island floats at the top centre, below the bars that hold it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const release = await holdLinks(page);
  await page.goto("/");
  try {
    // The top below which it floats: under the phone's strip, the bar and
    // the shelf's tabs, or the desk's bar where its search field reaches
    // the centre, and at the top with room beside the search field.
    for (const [width, height, top] of [
      [320, 640, 61],
      [390, 844, 61],
      [600, 900, 142],
      [768, 1024, 142],
      [1024, 768, 68],
      [1280, 800, 68],
      [1920, 1080, 8],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() => underIsland(page), { message: `${width} px` })
        .toEqual({ covered: [], offCentre: 0 });
      await expect
        .poll(async () => (await page.locator(".ba-island").boundingBox())?.y, {
          message: `${width} px`,
        })
        .toBeCloseTo(top, 0);
      // The account menu drops from the bar's end across the island, and
      // opens over it.
      if (width === 600) {
        await page.getByRole("button", { name: "Account" }).click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        const onTop = await menu.evaluate((menu) => {
          const island = document.querySelector<HTMLElement>(".ba-island")!;
          const a = menu.getBoundingClientRect();
          const b = island.getBoundingClientRect();
          const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
          const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
          const overlap =
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom;
          // The island takes no taps: let the hit test see it.
          island.style.pointerEvents = "auto";
          const top = document.elementFromPoint(x, y);
          island.style.pointerEvents = "";
          return overlap && menu.contains(top);
        });
        expect(onTop).toBe(true);
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
      }
      // Below the shelf's tabs, it rises with them as the page scrolls, up
      // to the bar, which stays (61 px with its hairline).
      if (width === 768) {
        await page.evaluate(() => window.scrollTo(0, 200));
        await expect
          .poll(async () => (await page.locator(".ba-island").boundingBox())?.y)
          .toBeCloseTo(69, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  } finally {
    release();
  }
});
