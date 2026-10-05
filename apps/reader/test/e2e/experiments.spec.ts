import { test, expect } from "./helpers/fixtures";

const plates = [
  ["system", "01", "System"],
  ["threads", "03", "Threads"],
  ["folio", "07", "Folio"],
  ["lumen", "08", "Lumen"],
  ["commonplace", "10", "Commonplace"],
  ["deck", "11", "Deck"],
  ["concordance", "12", "Concordance"],
  ["clock", "14", "Rhythm"],
];

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`selected experiments load at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.goto("/debug/experiments");
    await expect(
      page.getByRole("heading", { name: "Experiments", exact: true }),
    ).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('section[id^="plate-"]')).toHaveCount(8);
    // Far-away stages must not be downloaded on entry.
    expect(
      requested.some((url) => url.includes("/highlights/Concordance.tsx")),
    ).toBe(false);
    for (const [id, number, name] of plates) {
      const plate = page.locator(`#plate-${id}`);
      await plate.scrollIntoViewIfNeeded();
      await expect(
        plate.getByText(`Plate ${number}`, { exact: true }),
      ).toBeVisible();
      await expect(plate.locator(`#plate-${id}-title`)).toContainText(name);
      await expect(plate.getByRole("status")).toHaveCount(0);
      // Every stage has interactive controls or the Rhythm visualization.
      await expect(
        plate.locator("button:visible, svg:visible").first(),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("returning to Lumen preserves its controls and reading position", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/debug/experiments");
  const lumen = page.locator("#plate-lumen");
  await lumen.scrollIntoViewIfNeeded();
  await lumen.getByRole("button", { name: "line", exact: true }).click();
  await lumen.getByRole("button", { name: "Start pacer" }).click();
  const reader = lumen.locator('[aria-label^="Moby"]');
  await expect
    .poll(() => reader.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(10);
  const position = await reader.evaluate((node) => node.scrollTop);
  const galleryHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.locator("#plate-clock").scrollIntoViewIfNeeded();
  await expect(page.locator("#plate-clock svg").first()).toBeVisible();
  await expect(
    lumen.getByRole("button", { name: "Pause pacer", includeHidden: true }),
  ).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    galleryHeight,
  );
  await lumen.scrollIntoViewIfNeeded();
  await expect(
    lumen.getByRole("button", { name: "line", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await lumen.getByRole("button", { name: "Pause pacer" }).click();
  expect(
    await reader.evaluate((node) => node.scrollTop),
  ).toBeGreaterThanOrEqual(position);
});
