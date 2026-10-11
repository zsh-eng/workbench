import { test, expect, openAccountMenu } from "./helpers/fixtures";

test.use({ signedIn: true });

test("automatic auth failure is visible and does not retry on reconnect", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/sync/v2/pull*", async (route) => {
    requests++;
    await route.fulfill({ status: 401, json: { error: "Unauthorized" } });
  });
  await page.goto("/");
  // Sync needs attention, so its state shows beside the account button.
  await expect(
    page.getByRole("button", { name: "Account: Sign in again", exact: true }),
  ).toBeVisible();
  const menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: "Sign in again", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { syncService } = await import("/src/lib/sync-service.ts");
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    syncService.stopPeriodicSync();
    syncService.startPeriodicSync();
    await syncService.drain();
  });
  expect(requests).toBe(1);
  await expect(page.getByText("Library synced", { exact: true })).toHaveCount(
    0,
  );
});

test("record completion does not claim a pending file upload has completed", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/files/*", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await held;
    const fileId = route.request().url().split("/").at(-1)!;
    await route.fulfill({
      json: {
        id: fileId,
        fileSize: 7,
        mediaType: "text/plain",
        createdAt: Date.now(),
      },
    });
  });
  await page.goto("/");
  try {
    await page.evaluate(async () => {
      const { files } = await import("/src/lib/files/files-manager.ts");
      await files.put(new Blob(["pending"], { type: "text/plain" }));
    });
    let menu = await openAccountMenu(page);
    await expect(
      menu.getByRole("menuitem", {
        name: "Sync now: Uploading files…",
        exact: true,
      }),
    ).toBeVisible();
    await menu
      .getByRole("menuitem", { name: "Sync now: Uploading files…", exact: true })
      .click();
    menu = await openAccountMenu(page);
    await expect(
      menu.getByRole("menuitem", {
        name: "Sync now: Uploading files…",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Library synced", { exact: true })).toHaveCount(
      0,
    );
    release();
    await expect(
      menu.getByRole("menuitem", {
        name: "Sync now: Reading data synced",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const { db } = await import("/src/lib/db.ts");
        return db.fileUploadOperations.count();
      }),
    ).toBe(0);
  } finally {
    release();
  }
});
