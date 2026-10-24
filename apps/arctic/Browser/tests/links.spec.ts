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

  // Save a link from the library's bottom bar: + turns the search capsule
  // into the field, focused in the tap, and the list stays where it was.
  await page.evaluate(() => scrollTo(0, 300));
  const add = page.getByRole("button", { name: "Save a link" });
  await add.click();
  const field = page.getByPlaceholder("Paste a link");
  await expect(field).toBeFocused();
  const cancel = page
    .locator(".library-dock")
    .getByRole("button", { name: "Cancel" });
  await expect(cancel).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => scrollY)).toBe(300);
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await expect(add).toHaveAttribute("aria-expanded", "false");

  await add.click();
  await field.fill("polar night");
  await page.keyboard.press("Enter");
  await expect(page.locator(".dock-note")).toContainText("not a web address");
  await field.fill("https://example.com/polar-night");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".card-title").first()).toHaveText("Polar night");

  // Paste saves the copied link at once.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() =>
    navigator.clipboard.writeText("https://example.com/sea-smoke"),
  );
  await add.click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".card-title").first()).toHaveText("Sea smoke");

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
  await expect(page.locator(".card-title").first()).toHaveText("Sea smoke");
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

test("the phone's link bar saves nothing after Cancel, and shows what it saves", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A clipboard that answers when the test says, as while Chrome asks for
  // permission to read it.
  await page.addInitScript(() => {
    const answers: (() => void)[] = [];
    navigator.clipboard.readText = () =>
      new Promise((done) =>
        answers.push(() => done("https://example.com/polar-night")),
      );
    Object.assign(window, { answer: () => answers.shift()?.() });
  });
  const older = article("https://example.com/older", { title: "Older reading" });
  await phone(context.request).push(older.records);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(1);
  const add = page.getByRole("button", { name: "Save a link" });
  const field = page.getByPlaceholder("Paste a link");

  // A tap on the list cancels a Paste that waits; its link stays unsaved.
  await add.click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await page.locator(".dock-scrim").click();
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => (window as unknown as { answer(): void }).answer());

  // A link saved during a search shows at the top of all of Saved.
  await page.getByRole("button", { name: /^Search \d/ }).click();
  const search = page.getByRole("searchbox");
  await search.fill("old");
  await page.keyboard.press("Enter");
  // The field stays over the folders, so a tap on it edits the search.
  await search.click();
  await search.fill("older");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?q=older$/);
  await add.click();
  await field.fill("https://example.com/sea-smoke");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Saved");
  await expect(page.locator(".card-title")).toHaveText([
    "Sea smoke",
    "Older reading",
  ]);
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/\/$/);
});
