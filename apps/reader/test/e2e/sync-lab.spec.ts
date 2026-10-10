import { test, expect, waitForReaderReady } from "./helpers/fixtures";

async function startDemo(page: import("@playwright/test").Page) {
  await page.goto("/debug/sync");
  await page
    .getByRole("button", { name: "Start with demo", exact: true })
    .click();
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("article", { name: "Client B", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
}

test("sync lab boots empty and position presets and supports keyboard inspection", async ({
  page,
}) => {
  await startDemo(page);
  await page.getByLabel("New client preset").selectOption("empty");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  const c = page.getByRole("article", { name: "Client C", exact: true });
  await expect(
    c.getByRole("button", { name: "Pull", exact: true }),
  ).toBeEnabled();
  await expect(c).toContainText("cursor 0");
  await c.getByRole("button", { name: "Pull", exact: true }).click();
  await expect(c).toContainText("cursor 1");
  await page.getByLabel("New client preset").selectOption("position");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  const d = page.getByRole("article", { name: "Client D", exact: true });
  await expect(d).toContainText("1 pending");
  await expect(
    page.getByRole("button", { name: "Add client", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Record table").selectOption("readingCheckpoints");
  await expect(
    page.getByRole("region", { name: "Record inspector" }),
  ).toContainText('"scrollProgress": 65');
  const records = page.getByRole("tab", { name: "Records", exact: true });
  await records.focus();
  await records.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Events/ })).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Sync timeline" }),
  ).toBeVisible();
});

test("sync lab runs isolated conflicts, restores snapshots, and upgrades databases", async ({
  page,
}) => {
  test.setTimeout(45000);
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startDemo(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByLabel("Scenario preset").selectOption("conflict");
  await page
    .getByRole("button", { name: "Play scenario", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Scenario playback" }).getByRole("status"),
  ).toHaveText("complete", { timeout: 15000 });
  await page.getByRole("tab", { name: /^Events/ }).click();
  await expect(
    page.getByText("conflict: both clients agree", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Matches server", { exact: true })).toHaveCount(
    2,
  );
  await page
    .getByRole("button", { name: "Stop playback", exact: true })
    .click();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  expect(page.workers()).toHaveLength(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Export Checkpoint 1", exact: true })
    .click();
  const exported = await downloadPromise;
  const exportPath = await exported.path();
  expect(exportPath).toBeTruthy();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByLabel("Scenario preset").selectOption("lost-response");
  await page
    .getByRole("button", { name: "Play scenario", exact: true })
    .click();
  const playback = page.getByRole("region", { name: "Scenario playback" });
  await expect(playback.getByRole("status")).toHaveText("paused");
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(playback.getByRole("status")).toHaveText("complete", {
    timeout: 15000,
  });
  await page.getByRole("tab", { name: /^Events/ }).click();
  await expect(
    page.getByText("lost-response: both clients agree", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop playback", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles(exportPath!);
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Matches server", { exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Upgrade v3 → current", exact: true })
    .click();
  await expect(
    page.getByText("All migration checks passed", { exact: true }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.screenshot({
    path: "test-results/sync-lab-inspector.png",
    fullPage: true,
  });
});

test("sync lab app views open the real Reader and retain local data across modes", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startDemo(page);
  await page.getByRole("button", { name: "App views", exact: true }).click();
  const a = page.frameLocator('iframe[title="Client A app"]');
  const b = page.frameLocator('iframe[title="Client B app"]');
  await expect(
    a.getByRole("heading", { name: "The Shared Bookmark", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    b.getByRole("heading", { name: "The Shared Bookmark", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await a
    .getByRole("heading", { name: "The Shared Bookmark", exact: true })
    .click();
  await expect(
    a
      .locator(
        '[data-reader-spread-layer="current"] [data-reader-page-content]',
      )
      .first(),
  ).toBeVisible();
  const bControls = page.getByRole("article", {
    name: "Client B",
    exact: true,
  });
  await bControls.getByRole("button", { name: "Online", exact: true }).click();
  await expect(
    bControls.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await b
    .getByRole("heading", { name: "The Shared Bookmark", exact: true })
    .click();
  await expect(
    b.getByText("Book file unavailable", { exact: true }),
  ).toBeVisible();
  await bControls.getByRole("button", { name: "Offline", exact: true }).click();
  await expect(
    b
      .locator(
        '[data-reader-spread-layer="current"] [data-reader-page-content]',
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Materialized", { exact: true })).toHaveCount(2);
  await a.getByRole("button", { name: "Mark as reading", exact: true }).click();
  const aFrame = page
    .frames()
    .find(
      (frame) =>
        frame.url().includes("labClient=") &&
        frame.url().includes("labMode=app"),
    )!;
  await a.locator("body").press("ArrowRight");
  await expect
    .poll(() =>
      aFrame.evaluate(async () => {
        const { syncV2SyncDb } = await import("/src/lib/sync-v2/db.ts");
        const rows = await syncV2SyncDb.readingCheckpoints.toArray();
        return rows.some((row) => row.scrollProgress > 0);
      }),
    )
    .toBe(true);
  await waitForReaderReady(aFrame);
  await page.getByRole("tab", { name: /^Events/ }).click();
  await page.screenshot({
    path: "test-results/sync-lab-app.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await page.getByLabel("Record table").selectOption("readingCheckpoints");
  await expect(
    page
      .getByRole("region", { name: "Record inspector" })
      .getByRole("button", { name: /^resume:/ })
      .first(),
  ).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("sync lab copies the current library without changing its database", async ({
  page,
  localBook,
}) => {
  const before = await page.evaluate(async () => {
    const { syncV2SyncDb } = await import("/src/lib/sync-v2/db.ts");
    return JSON.stringify(await syncV2SyncDb.books.toArray());
  });
  await page.goto("/debug/sync");
  await page
    .getByRole("button", { name: "Copy my library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy 1 selected book", exact: true })
    .click();
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Active book")).toHaveValue(localBook.id);
  await page
    .getByRole("article", { name: "Client A", exact: true })
    .getByRole("button", { name: "Save note", exact: true })
    .click();
  const after = await page.evaluate(async () => {
    const { syncV2SyncDb } = await import("/src/lib/sync-v2/db.ts");
    return {
      books: JSON.stringify(await syncV2SyncDb.books.toArray()),
      notes: await syncV2SyncDb.notes.toArray(),
    };
  });
  expect(after.books).toEqual(before);
  expect(after.notes.some((note) => note.id.startsWith("lab-note:"))).toBe(
    false,
  );
});

test("sync lab records inspector actions and replays their outcomes", async ({
  page,
}) => {
  await startDemo(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Record sequence", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeEnabled();
  const a = page.getByRole("article", { name: "Client A", exact: true });
  const b = page.getByRole("article", { name: "Client B", exact: true });
  await a
    .getByLabel("Client A shared note", { exact: true })
    .fill("A recorded edit");
  await a.getByRole("button", { name: "Save note", exact: true }).click();
  await a.getByRole("button", { name: "Sync now", exact: true }).click();
  await b.getByRole("button", { name: "Sync now", exact: true }).click();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeEnabled();
  await a
    .getByLabel("Client A shared note", { exact: true })
    .fill("A later edit");
  await a.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await page.getByRole("tab", { name: /^Events/ }).click();
  await expect(
    page.getByText("Replayed “My sync sequence”: all 3 steps matched", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Matches server", { exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Record inspector" }),
  ).toContainText("A recorded edit");
});

test("scenario playback pauses for inspection, preserves manual edits, and restarts its baseline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startDemo(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByLabel("Scenario preset").selectOption("offline-edit");
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  const playback = page.getByRole("region", { name: "Scenario playback" });
  await expect(playback.getByRole("status")).toHaveText("paused");
  const a = page.getByRole("article", { name: "Client A", exact: true });
  const b = page.getByRole("article", { name: "Client B", exact: true });
  await expect(
    a.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await playback.getByRole("button", { name: "Step", exact: true }).click();
  await expect(playback.getByRole("status")).toHaveText("paused");
  await expect(
    a.getByRole("button", { name: "Online", exact: true }),
  ).toBeVisible();
  await a.locator("summary").filter({ hasText: "Network & clock" }).click();
  await a.getByLabel("Latency (ms)").fill("800");
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(playback.getByRole("status")).toHaveText("paused");
  await expect(playback).toContainText("2/7");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await b
    .getByLabel("Client B shared note", { exact: true })
    .fill("Manual intervention");
  await b.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Record inspector" }),
  ).toContainText("Manual intervention");
  await page.screenshot({
    path: "test-results/sync-lab-playback-paused.png",
    fullPage: true,
  });
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(playback.getByRole("status")).toHaveText("failed", {
    timeout: 15000,
  });
  await expect(playback.getByRole("alert")).toContainText(
    "paused edits may change the outcome",
  );
  await expect(
    page.getByRole("region", { name: "Record inspector" }),
  ).toContainText("Manual intervention");
  await playback
    .getByRole("button", { name: "Restart playback", exact: true })
    .click();
  await expect(playback.getByRole("status")).toHaveText("paused");
  await expect(playback).toContainText("0/7");
  await expect(
    a.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Record inspector" }),
  ).not.toContainText("Manual intervention");
  await playback
    .getByRole("button", { name: "Stop playback", exact: true })
    .click();
  await expect(playback).toHaveCount(0);
  await expect(
    a.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
});
