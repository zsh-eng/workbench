import { expect, test, type Page } from "@playwright/test";
import { addText, article, identity, paragraphs, phone, signUp } from "./phone";

test.beforeEach(async ({ context }) => {
  await signUp(context);
});

/** A sheet takes focus once it has slid in; Escape then closes it. */
const settled = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")),
    )
    .toBe(true);

/** Pastes text outside any field, as ⌘V on the library does. */
const paste = (page: Page, text: string) =>
  page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  }, text);

test("a pasted link is saved first, in the phone's format, and Undo takes it back", async ({
  page,
  context,
}) => {
  const ice = article("https://example.com/ice", { title: "Older reading" });
  await phone(context.request).push(ice.records);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(1);

  // Prose is not a link; it is left alone.
  await paste(page, "Sea ice keeps time https://example.com");
  await paste(page, "HTTPS://Example.com:443/notes/how-sea-ice-keeps-time#top");
  await expect(page.locator(".card-title")).toHaveText([
    "How sea ice keeps time",
    "Older reading",
  ]);
  await expect(page.locator(".toast")).toContainText("Saved");

  // The phone's canonical URL, its SHA-256 id, and its three records.
  const url = "https://example.com/notes/how-sea-ice-keeps-time";
  const id = identity(url);
  const arctic = phone(context.request);
  await expect
    .poll(async () => (await arctic.records()).has(`tags/${id}`), {
      timeout: 10_000,
    })
    .toBe(true);
  const records = await arctic.records();
  const value = (key: string) => {
    const text = records.get(key)!.value;
    // Sorted keys, as Swift's JSONEncoder writes them.
    expect(Object.keys(JSON.parse(text))).toEqual(
      Object.keys(JSON.parse(text)).sort(),
    );
    return JSON.parse(text);
  };
  expect(value(`article/${id}`)).toEqual({
    subtitle: "",
    title: "How sea ice keeps time",
    url,
  });
  const library = value(`library/${id}`);
  expect(library).toMatchObject({
    archived: false,
    read: false,
    saved: true,
    url,
  });
  expect(Object.keys(library)).toEqual([
    "archived",
    "read",
    "saved",
    "savedAt",
    "url",
  ]);
  // Swift reference dates: seconds since 2001.
  expect(library.savedAt).toBeGreaterThan(8e8);
  const upper = id.toUpperCase();
  expect(value(`tags/${id}`)).toEqual({
    automatic: [],
    generation: `${upper.slice(0, 8)}-${upper.slice(8, 12)}-${upper.slice(12, 16)}-${upper.slice(16, 20)}-${upper.slice(20, 32)}`,
    manual: [],
    names: [],
    rejected: [],
    url,
  });

  // The same link again is pointed out, not saved twice.
  await page.getByRole("button", { name: "Save a link" }).click();
  const field = page.getByPlaceholder("Paste a link");
  await field.fill("not a link");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".link-note")).toContainText(
    "not a web address",
  );
  await field.fill("example.com/notes/how-sea-ice-keeps-time");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Already in Saved");
  await expect(page.locator(".card")).toHaveCount(2);

  // A second link, then Undo: its records become tombstones.
  await paste(page, "https://example.com/tundra-in-winter");
  await expect(page.locator(".card")).toHaveCount(3);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);
  const tundra = identity("https://example.com/tundra-in-winter");
  await expect
    .poll(
      async () => (await arctic.records()).get(`library/${tundra}`)?.isDeleted,
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("a phone keeps the reader's actions in thumb reach, in sheets", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const floe = article("https://example.com/floe", {
    title: "A floe at dawn",
    subtitle: "Where the ice goes in spring.",
  });
  // Older reading below it, so the list can scroll.
  const older = Array.from({ length: 20 }, (_, n) =>
    article(`https://example.com/older-${n}`, {
      title: `Older reading ${n + 1}`,
      savedAt: Date.UTC(2026, 0, n + 1),
    }),
  );
  await phone(context.request).push([
    ...floe.records,
    ...older.flatMap((item) => item.records),
  ]);
  await addText(context.request, floe, paragraphs(30));
  await page.goto("/");
  await expect(page.locator(".card[data-copy]")).toHaveCount(1);

  // Save a link from the library's bottom bar.
  await page.getByRole("button", { name: "Save a link" }).click();
  const sheet = page.getByRole("dialog", { name: "Save a link" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByPlaceholder("Paste a link")).toBeFocused();
  // The field takes focus in the tap, without scrolling, which would stop
  // the sheet partway up the screen.
  await expect
    .poll(async () => (await sheet.boundingBox())?.y ?? Infinity)
    .toBeLessThan(60);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await sheet.getByPlaceholder("Paste a link").fill("https://example.com/polar-night");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".card-title").first()).toHaveText("Polar night");

  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 30.");
  const toolbar = page.getByRole("toolbar", { name: "Article" });
  await expect(toolbar).toBeVisible();

  // A touch scroll ends in pointercancel, not pointerup. A passage selected
  // after it still brings up the colours.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 195,
    y: 600,
    yDistance: -240,
    gestureSourceType: "touch",
  });
  await page.evaluate(() => {
    const text = document.querySelectorAll(".prose p")[4]!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await expect(page.getByRole("button", { name: "Highlight sage" })).toBeVisible();
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await expect(page.getByRole("button", { name: "Highlight sage" })).toBeHidden();
  // The toolbar stepped aside on the way down; scrolling up brings it back.
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 195,
    y: 300,
    yDistance: 400,
    gestureSourceType: "touch",
  });
  await expect(toolbar).toBeInViewport();

  // Text and theme leaves the page in view and changes it as it goes.
  await toolbar.getByRole("button", { name: "Text and theme" }).click();
  const text = page.getByRole("dialog", { name: "Text and theme" });
  await expect(text).toBeVisible();
  const size = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--reading-size",
      ),
    );
  const before = parseInt(await size());
  await text.getByRole("button", { name: "Larger text" }).click();
  expect(parseInt(await size())).toBe(before + 1);
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(text).toBeHidden();

  // More holds what the toolbar does not.
  await toolbar.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("dialog", { name: /^Actions for A floe/ });
  await expect(more.getByRole("button", { name: "Open original" })).toBeVisible();
  await expect(more.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(more).toBeHidden();

  // Archive returns to the library, which no longer shows the article.
  await toolbar.getByRole("button", { name: "Archive" }).click();
  await expect(page.locator(".toast")).toContainText("Archived");
  await expect(page.locator(".card-title").first()).toHaveText("Polar night");
  await expect(page.getByText("A floe at dawn")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await phone(context.request).records()).get(`library/${floe.id}`)!
            .value,
        ).archived,
      { timeout: 10_000 },
    )
    .toBe(true);
});
