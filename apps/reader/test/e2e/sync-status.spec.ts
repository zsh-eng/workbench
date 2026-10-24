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
    page.getByRole("button", {
      name: "Account: Sign in again to sync",
      exact: true,
    }),
  ).toBeVisible();
  const menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: "Sign in again to sync", exact: true }),
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
      .getByRole("menuitem", {
        name: "Sync now: Uploading files…",
        exact: true,
      })
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
        name: "Sync now: Synced just now",
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

test("offline shows on the account button, and changes made offline sync when the network returns", async ({
  page,
  context,
  localBook,
  remote,
}) => {
  // The restored book is a local change; sync it first.
  await (
    await openAccountMenu(page)
  )
    .getByRole("menuitem", { name: /^Sync now:/ })
    .click();
  await expect(
    (await openAccountMenu(page)).getByRole("menuitem", {
      name: "Sync now: Synced just now",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(true);
  // A signed-in reader who goes offline is still signed in.
  await expect(
    page.getByRole("button", { name: "Account: Offline", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (id) => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    const { syncV2Db: db } = await import(modulePath);
    await db.books.update(id, { title: "Renamed offline" });
  }, localBook.id);
  await openAccountMenu(page);
  await expect(
    page.getByRole("menuitem", { name: "Sync now: Offline" }),
  ).toHaveAttribute("title", /1 change is saved on this device/);
  await page.keyboard.press("Escape");

  const pushed = remote.pushed.length;
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect.poll(() => remote.pushed.length).toBeGreaterThan(pushed);
  expect(remote.pushed.at(-1)?.value).toContain("Renamed offline");
});

test("back from the sign-in redirect, an ended session waits for the session check instead of asking to sign in again", async ({
  page,
}) => {
  await page.route("**/api/sync/v2/pull*", (route) =>
    route.fulfill({ status: 401, json: { error: "Unauthorized" } }),
  );
  await page.goto("/");
  const signInAgain = page.getByRole("button", {
    name: "Account: Sign in again to sync",
    exact: true,
  });
  await expect(signInAgain).toBeVisible();

  // The provider sends the browser back with a new session, which the
  // session check confirms only when the test lets it.
  let answer = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.unroute("**/api/sync/v2/pull*");
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ json: { url: "/?signed-in", redirect: true } }),
  );
  await page.route("**/api/auth/get-session", async (route) => {
    await answered;
    const now = new Date().toISOString();
    await route.fulfill({
      json: {
        user: {
          id: "test-user",
          name: "Test Reader",
          email: "reader@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "new-session",
          userId: "test-user",
          token: "local-test",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });
  const menu = await openAccountMenu(page);
  await menu
    .getByRole("menuitem", { name: "Sign in again to sync", exact: true })
    .click();
  await page.waitForURL(/\?signed-in$/);
  // The Library is open, and the account waits for the session check.
  await expect(page.getByText("Your library is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Account/ })).toHaveCount(0);
  await expect(page.getByText(/Sign in/)).toHaveCount(0);

  answer();
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(signInAgain).toHaveCount(0);
});
