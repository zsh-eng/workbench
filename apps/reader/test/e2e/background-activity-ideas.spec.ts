import { expect, test } from "./helpers/fixtures";

// Design ideas → Background activity runs the real engine on simulated jobs.
// One pass through the island: downloads, the update, and a failure.
test.use({ viewport: { width: 390, height: 844 } });

test("the island takes downloads, the update and a failure in turn", async ({
  page,
}) => {
  // Simulated downloads take a few seconds each, as they do on a phone.
  test.setTimeout(90_000);
  await page.goto("/debug/ideas/background?idea=island");
  const scenarios = page.getByRole("group", { name: "Scenarios" });
  const island = page.locator("[data-activity-island]");

  await scenarios.getByRole("button", { name: "Download 3" }).click();
  await expect(island).toHaveAttribute("data-activity-island", "downloads");
  await expect(island).toContainText("3 books");
  await page.getByRole("button", { name: "Open activity" }).click();
  await expect(island.getByText("Now")).toBeVisible();
  await island.getByRole("button", { name: "Done" }).click();
  await expect(island).toHaveAttribute("data-activity-island", "done", {
    timeout: 15_000,
  });

  await scenarios.getByRole("button", { name: "Update" }).click();
  await island.getByRole("button", { name: "Restart" }).click({
    timeout: 10_000,
  });
  await expect(island).toContainText("Updated", { timeout: 5_000 });

  await scenarios.getByRole("button", { name: "Failure" }).click();
  await expect(island).toContainText("Couldn’t download", {
    timeout: 15_000,
  });
  await island.getByRole("button", { name: "Retry" }).click();
  await expect(island).toHaveAttribute("data-activity-island", "downloads");
});

test("on the covers, a book's cover fills and offline books fade", async ({
  page,
}) => {
  await page.goto("/debug/ideas/background?idea=covers");
  const scenarios = page.getByRole("group", { name: "Scenarios" });
  await scenarios.getByRole("button", { name: "Download 3" }).click();
  await expect(page.locator('[data-cover-activity="running"]')).toHaveCount(2);
  await expect(page.locator('[data-cover-activity="queued"]')).toHaveCount(1);
  await scenarios.getByRole("button", { name: "Offline edits" }).click();
  await expect(
    page.getByText(/^Offline · \d+ books? on this device$/),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Saved on this device" }),
  ).toHaveCount(2);
});
