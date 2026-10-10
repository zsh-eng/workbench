import { test, expect, openLocalBook } from "./helpers/fixtures";

test.use({
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

test("desktop composer keeps the send button outside single and multiline fields", async ({
  page,
  localBook,
}, testInfo) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const panel = tools.getByRole("region", { name: "Book notebook" });
  await expect(panel).toHaveCSS("transform", "none");
  await expect(panel).toHaveCSS("opacity", "1");
  expect(await panel.evaluate((node) => node.getAnimations().length)).toBe(0);
  const input = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  const field = tools.locator("[data-note-input-surface]");
  const send = tools.locator('button[aria-label="Save note"]');
  await expect(input).toBeFocused();
  const emptyBounds = (await field.boundingBox())!;
  await expect(send).toHaveCSS("opacity", "0");
  await input.fill("A thought");
  await expect(send).toHaveCSS("opacity", "1");
  const oneLine = (await field.boundingBox())!;
  const sendBounds = (await send.boundingBox())!;
  expect(emptyBounds.width - oneLine.width).toBeCloseTo(40, 0);
  expect(sendBounds.x - oneLine.x - oneLine.width).toBeCloseTo(8, 0);
  expect(await field.locator('button[aria-label="Save note"]').count()).toBe(0);
  await input.fill("First line\nSecond line\nThird line\nFourth line");
  const multiline = (await field.boundingBox())!;
  expect(multiline.width).toBe(oneLine.width);
  expect(multiline.height).toBeGreaterThan(oneLine.height + 40);
  const textarea = (await input.boundingBox())!;
  expect(
    multiline.x + multiline.width - textarea.x - textarea.width,
  ).toBeLessThan(20);
  const multilineSend = (await send.boundingBox())!;
  expect(multilineSend.x).toBe(sendBounds.x);
  expect(
    multiline.y + multiline.height - multilineSend.y - multilineSend.height,
  ).toBeCloseTo(5, 0);
  await page.screenshot({
    path: testInfo.outputPath("desktop-multiline-composer.png"),
  });
  await input.fill("");
  await expect(send).toHaveCSS("opacity", "0");
  expect((await field.boundingBox())!.width).toBe(emptyBounds.width);
  await tools.getByRole("button", { name: "Contents", exact: true }).click();
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  expect(await panel.evaluate((node) => node.getAnimations().length)).toBe(0);
});

test("desktop notes edit in place with stable rows and keep compose and edit drafts separate", async ({
  page,
  localBook,
}, testInfo) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const compose = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  const original =
    "A thought about the first passage.\nA second line to keep nearby.\nA third line for context.";
  await compose.fill(original);
  await tools.getByRole("button", { name: "Save note", exact: true }).click();
  await compose.fill("Another thought.");
  await tools.getByRole("button", { name: "Save note", exact: true }).click();
  const rows = tools.locator("[data-note-id]");
  await expect(rows).toHaveCount(2);
  await compose.fill("An unsent thought.");
  const before = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      y: node.getBoundingClientRect().y,
      height: node.getBoundingClientRect().height,
    })),
  );
  const first = rows.nth(0);
  const second = rows.nth(1);
  const id = await first.getAttribute("data-note-id");
  const readSaved = () =>
    page.evaluate(async (id) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db } = await import(modulePath);
      return syncV2Db.notes.get(id);
    }, id);
  const savedBefore = await readSaved();
  await first.locator("p").dblclick();
  const editor = first.getByRole("textbox", { name: "Edit note", exact: true });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(original);
  await expect(tools.locator("[data-note-input-surface] textarea")).toHaveValue(
    "An unsent thought.",
  );
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        y: node.getBoundingClientRect().y,
        height: node.getBoundingClientRect().height,
      })),
    ),
  ).toEqual(before);
  await expect(second.locator('[data-slot="context-menu-trigger"]')).toHaveCSS(
    "opacity",
    "0.45",
  );
  const revised =
    "Revised first line.\nRevised second line.\nRevised third line.\nExtra line scrolling inside the note.";
  await editor.fill(revised);
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        y: node.getBoundingClientRect().y,
        height: node.getBoundingClientRect().height,
      })),
    ),
  ).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("desktop-inline-edit.png"),
  });
  const modifier = await page.evaluate(() =>
    /Mac/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await editor.press(`${modifier}+Enter`);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readSaved()).content).toBe(revised);
  expect((await readSaved()).anchor).toEqual(savedBefore.anchor);
  expect((await readSaved()).createdAt).toEqual(savedBefore.createdAt);
  await expect(compose).toHaveValue("An unsent thought.");

  await first.locator("article").click({ button: "right" });
  const menu = page.getByRole("menu");
  const editItem = menu.getByRole("menuitem", {
    name: "Edit",
    exact: true,
  });
  await editItem.hover();
  await expect(editItem).toHaveAttribute("data-highlighted", "");
  expect(
    await editItem.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  const menuRadius = await menu.evaluate((node) =>
    parseFloat(getComputedStyle(node).borderTopLeftRadius),
  );
  const itemRadius = await editItem.evaluate((node) =>
    parseFloat(getComputedStyle(node).borderTopLeftRadius),
  );
  expect(menuRadius - itemRadius).toBeCloseTo(5, 0);
  expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(208);
  await page.screenshot({ path: testInfo.outputPath("desktop-note-menu.png") });
  await editItem.click();
  await expect(editor).toBeFocused();
  await editor.fill("Saved when I leave the note.");
  await editor.click({ button: "right" });
  await expect(menu).toBeHidden();
  await second.locator("article").click({ button: "right" });
  await expect(menu).toBeHidden();
  await expect(editor).toHaveValue("Saved when I leave the note.");
  await second.locator("p").click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(async () => (await readSaved()).content)
    .toBe("Saved when I leave the note.");
  await first.locator("p").dblclick();
  await editor.fill("Saved when I change panels.");
  await tools.getByRole("button", { name: "Contents", exact: true }).click();
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(compose).toHaveValue("An unsent thought.");
  await expect(editor).toHaveCount(0);
  await first.locator("p").dblclick();
  await expect(editor).toHaveValue("Saved when I change panels.");
  await editor.fill("Cancel this revision.");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  expect((await readSaved()).content).toBe("Saved when I change panels.");
  await expect(compose).toHaveValue("An unsent thought.");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await first.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy text", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Saved when I change panels.",
  );
  await first.locator("article").click({ button: "right" });
  const deleteItem = page.getByRole("menuitem", {
    name: "Delete",
    exact: true,
  });
  await deleteItem.hover();
  await expect(deleteItem).toHaveAttribute("data-highlighted", "");
  expect(
    await deleteItem.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await deleteItem.click();
  await expect(rows).toHaveCount(1);
  expect((await readSaved()).isDeleted).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows).toHaveCount(2);
  expect((await readSaved()).isDeleted).toBe(false);
});

test("desktop deletion undo follows deletion order and leaves text undo to the editor", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const panel = tools.getByRole("region", { name: "Book notebook" });
  const compose = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  for (const content of [
    "First thought.",
    "Second thought.",
    "Third thought.",
  ]) {
    await compose.fill(content);
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(compose).toHaveValue("");
  }
  const rows = panel.locator("[data-note-id]");
  await expect(rows).toHaveCount(3);
  const ids = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-note-id")),
  );
  const deletedIds = () =>
    page.evaluate(async (ids) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db } = await import(modulePath);
      return (await syncV2Db.notes.bulkGet(ids))
        .filter((note) => note.isDeleted)
        .map((note) => note.id);
    }, ids);
  async function remove(content: string) {
    await panel.getByText(content, { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  }
  const modifier = await page.evaluate(() =>
    /Mac/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await remove("First thought.");
  await expect(rows).toHaveCount(2);
  await remove("Second thought.");
  await expect(rows).toHaveCount(1);
  expect(await deletedIds()).toEqual([ids[0], ids[1]]);

  // Chromium's emulated platform can differ from the host's native editing
  // bindings. Use the host shortcut for text undo and the app's Mod key below.
  const textModifier = process.platform === "darwin" ? "Meta" : "Control";
  // Native text undo must work even when deletion history is available.
  await compose.click();
  await compose.pressSequentially("x");
  await compose.press(`${textModifier}+z`);
  await expect(compose).toHaveValue("");
  expect(await deletedIds()).toEqual([ids[0], ids[1]]);
  await panel.getByText("Third thought.", { exact: true }).dblclick();
  const editor = panel.getByRole("textbox", { name: "Edit note", exact: true });
  await editor.pressSequentially("x");
  await editor.press(`${textModifier}+z`);
  await expect(editor).toHaveValue("Third thought.");
  expect(await deletedIds()).toEqual([ids[0], ids[1]]);
  await editor.press("Escape");

  // Undo is limited to the open notebook; closing it does not discard history.
  await tools
    .getByRole("navigation", { name: "Reader tools", exact: true })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();
  await expect(tools).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Write a note", exact: true }),
  ).toBeHidden();
  await page.keyboard.press(`${modifier}+z`);
  expect(await deletedIds()).toEqual([ids[0], ids[1]]);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  // Click a note to move focus out of the composer before using panel Undo.
  await panel.getByText("Third thought.", { exact: true }).click();
  await page.keyboard.press(`${modifier}+Shift+z`);
  expect(await deletedIds()).toEqual([ids[0], ids[1]]);
  await page.keyboard.press(`${modifier}+z`);
  await expect(rows).toHaveCount(2);
  expect(await deletedIds()).toEqual([ids[0]]);
  await page.keyboard.press(`${modifier}+z`);
  await expect(rows).toHaveCount(3);
  expect(await deletedIds()).toEqual([]);
  // Restoring from a toast removes that action from keyboard history too.
  await remove("Third thought.");
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await remove("Second thought.");
  await expect(rows).toHaveCount(2);
  await panel.getByText("Third thought.", { exact: true }).click();
  await page.keyboard.press(`${modifier}+z`);
  await expect(rows).toHaveCount(3);
  expect(await deletedIds()).toEqual([]);
});

test("a notebook highlight has the note menu: copy, delete, and Undo", async ({
  page,
  localBook,
}) => {
  const { nextSpread } = await import("./helpers/fixtures");
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const selected = await page.evaluate(() => {
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 30)
      node = walker.nextNode();
    const range = document.createRange();
    range.setStart(node!, 0);
    range.setEnd(node!, 25);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return range.toString();
  });
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString().length))
    .toBe(25);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await page.getByRole("button", { name: "Highlight with green" }).click();
  const mark = page.locator(
    '[data-reader-spread-layer="current"] mark[data-color="green"]',
  );
  await expect(mark.first()).toBeVisible();
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const entry = tools.locator('[aria-label^="Highlight;"]');
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await entry.locator("article").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Copy text", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    selected,
  );
  await entry.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(entry).toHaveCount(1);
  await expect(mark.first()).toBeVisible();
});
