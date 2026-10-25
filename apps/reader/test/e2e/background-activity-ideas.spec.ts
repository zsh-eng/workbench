import {
  expect,
  test,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

// Design ideas → Background activity runs the real engine on simulated jobs.
test.use({ viewport: { width: 390, height: 844 } });

test("in the sheet, books finish where they are and regroup when it opens again", async ({
  page,
}) => {
  // Simulated downloads take a few seconds each, as they do on a phone.
  test.setTimeout(60_000);
  await page.goto("/debug/ideas/background?idea=together");
  const scenarios = page.getByRole("group", { name: "Scenarios" });
  await scenarios.getByRole("button", { name: "Download 5" }).click();
  const glyph = page.locator("[data-activity-glyph]");
  await expect(glyph).toHaveAttribute("data-activity-glyph", "progress");
  await glyph.click();
  const dialog = await waitForSheet(page, "Activity");
  await waitForSheetToRest(dialog);

  const sheet = page.locator("[data-activity-sheet]");
  const rows = sheet.locator("[data-sheet-row]");
  await expect(rows).toHaveCount(5);
  await expect(sheet.locator("[data-sheet-cover]")).toHaveCount(5);
  const ids = () =>
    rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-sheet-row")),
    );
  const tops = () =>
    rows.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    );
  const order = await ids();
  const before = await tops();
  // Two books finish where they are, at the same height, under Now.
  const done = sheet.locator('[data-sheet-row-state="done"]');
  await expect
    .poll(() => done.count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  expect(await ids()).toEqual(order);
  expect(await tops()).toEqual(before);
  await expect(sheet.locator("h3")).toHaveText(["Now"]);

  // Opened again while the rest download, the finished books are under Done.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await glyph.click();
  await waitForSheet(page, "Activity");
  await expect(sheet.locator("h3")).toHaveText(["Now", "Done"]);
  const states = await sheet
    .locator("h3, [data-sheet-row]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.tagName === "H3"
          ? element.textContent
          : element.getAttribute("data-sheet-row-state"),
      ),
    );
  const doneAt = states.indexOf("Done");
  expect(states.slice(doneAt + 1).every((state) => state === "done")).toBe(
    true,
  );
  expect(states.slice(1, doneAt)).not.toContain("done");
});

test("on the covers, a book's cover fills and offline books fade", async ({
  page,
}) => {
  await page.goto("/debug/ideas/background?idea=covers");
  const scenarios = page.getByRole("group", { name: "Scenarios" });
  await scenarios.getByRole("button", { name: "Download 5" }).click();
  await expect(page.locator('[data-cover-activity="running"]')).toHaveCount(2);
  await expect(page.locator('[data-cover-activity="queued"]')).toHaveCount(3);
  await scenarios.getByRole("button", { name: "Offline edits" }).click();
  await expect(
    page.getByText(/^Offline · \d+ books? on this device$/),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Saved on this device" }),
  ).toHaveCount(2);
});
