import type { Locator, Page } from "@playwright/test";
import {
  expect,
  openAccountMenu,
  SAMPLE_BOOK_TITLE,
  test,
  waitForSheet,
} from "./helpers/fixtures";
import { DATABASE_MODULE } from "./helpers/global-setup";
import { REMOTE_DEVICE_ID, type MockApi } from "./helpers/mock-api";

// Account → Activity shows this device's sync history to every reader;
// Devices' list of syncing devices stays behind Debug. Two devices: this
// one, and an iPhone (the mock's other device) that adds highlights and
// edits one after this device did, so this device's edit is lost to it.

test.use({ signedIn: true });

const minute = 60_000;

function highlight(
  bookId: string,
  id: string,
  color: string,
  createdAt: number,
) {
  return {
    id,
    bookId,
    spineItemId: "chapter-1",
    startOffset: 0,
    endOffset: 12,
    selectedText: "Down the Rabbit-Hole",
    textBefore: "",
    textAfter: "",
    color,
    createdAt,
    isDeleted: false,
  };
}

/** Another device's change, already on the server, made at `at`. */
function fromPhone(
  remote: MockApi,
  row: ReturnType<typeof highlight>,
  at: number,
  deviceId = REMOTE_DEVICE_ID,
) {
  remote.enqueue(
    {
      key: JSON.stringify(["highlights", row.id]),
      value: JSON.stringify(row),
      isDeleted: row.isDeleted,
      schemaVersion: 1,
      hlc: { wallTimeMs: at, counter: 0 },
    },
    deviceId,
  );
}

/** Debug as production starts it (off), or on. */
async function setDebug(page: Page, enabled: boolean) {
  await page.addInitScript(
    (value) => localStorage.setItem("reader-debug-enabled-v1", value),
    String(enabled),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
}

async function syncNow(page: Page) {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: /^Sync now:/ }).click();
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db } = await import(path);
        return syncV2Db._sync_outbox.count();
      }, DATABASE_MODULE),
    )
    .toBe(0);
}

/**
 * Debug off unless asked, as production starts, then: this device marks a
 * highlight yellow; the iPhone has added two highlights, and marked the
 * same one blue a minute later.
 */
async function twoDevices(
  page: Page,
  remote: MockApi,
  bookId: string,
  { debug = false } = {},
) {
  await setDebug(page, debug);
  const now = Date.now();
  await page.evaluate(
    async ({ path, row }) => {
      const { syncV2Db } = await import(path);
      await syncV2Db.highlights.put(row);
    },
    {
      path: DATABASE_MODULE,
      row: highlight(bookId, "shared", "yellow", now - 60 * minute),
    },
  );
  fromPhone(
    remote,
    highlight(bookId, "phone-1", "green", now - 3 * minute),
    now - 3 * minute,
  );
  fromPhone(
    remote,
    highlight(bookId, "phone-2", "green", now - 2 * minute),
    now - 2 * minute,
  );
  fromPhone(
    remote,
    highlight(bookId, "shared", "blue", now - 60 * minute),
    now + minute,
  );
  await syncNow(page);
}

async function openActivity(page: Page): Promise<Locator> {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Activity", exact: true }).click();
  return waitForSheet(page, "Activity");
}

async function expectHistory(activity: Locator) {
  const recent = activity.locator("[data-sync-history]");
  await expect(recent.getByRole("heading", { name: "Recent" })).toBeVisible();
  const lost = recent.locator('[data-history-kind="lost"]');
  await expect(lost).toHaveCount(1);
  await expect(lost).toContainText("Lost to a newer edit");
  await expect(lost).toContainText(/1 highlight in Alice.*Wonderland/);
  await expect(lost).toContainText(/kept your iPhone's edit from \d/);
  const fromPhoneRow = recent.locator('[data-history-kind="received"]');
  await expect(fromPhoneRow).toHaveCount(1);
  await expect(fromPhoneRow).toContainText("From your iPhone");
  await expect(fromPhoneRow).toContainText(
    /2 new highlights and 1 changed highlight in Alice.*Wonderland/,
  );
  // This device's own changes went out in the same pass.
  await expect(recent.locator('[data-history-kind="sent"]')).toContainText(
    "Sent from this device",
  );
  // Lost edits come first.
  await expect(recent.locator("[data-history-row]").first()).toHaveAttribute(
    "data-history-kind",
    "lost",
  );
}

/** Account → Devices, with no sign-in sessions to list. */
async function openDevices(page: Page) {
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Devices", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Devices", exact: true }),
  ).toBeVisible();
}

test("without Debug, Account has Activity, and Devices lists no syncing devices", async ({
  page,
  localBook: _localBook,
}) => {
  // Development builds start with Debug on; production starts with it off.
  await setDebug(page, false);
  const menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: /^Sync now:/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Activity", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await openDevices(page);
  await expect(page.locator("[data-sync-devices]")).toHaveCount(0);
});

test("Activity says so when its code cannot load, and the app stays", async ({
  page,
  localBook: _localBook,
}) => {
  await setDebug(page, false);
  await page.route(
    /\/src\/features\/sync-history\/ActivityHistory\.tsx/,
    (route) => route.abort("internetdisconnected"),
  );
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Couldn't open Activity.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
});

test("with Debug, Devices lists each syncing device with what it last sent", async ({
  page,
  remote,
  localBook,
}) => {
  await twoDevices(page, remote, localBook.id, { debug: true });
  await openDevices(page);
  const devices = page.locator("[data-sync-devices]");
  await expect(
    devices.getByRole("heading", { name: "Syncing devices" }),
  ).toBeVisible();
  const rows = devices.locator("[data-sync-device]");
  await expect(rows).toHaveCount(2);
  // This device first, with what it sent; then the iPhone, with what came from it.
  await expect(rows.first()).toContainText("This device");
  await expect(rows.first()).toContainText(/Sent .+ · Alice.*Wonderland added/);
  await expect(rows.nth(1)).toHaveAttribute(
    "data-sync-device",
    REMOTE_DEVICE_ID,
  );
  await expect(rows.nth(1)).toContainText("iPhone");
  await expect(rows.nth(1)).toContainText(
    /Last sent .+ · 2 new highlights and 1 changed highlight in Alice.*Wonderland/,
  );
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("without Debug, Activity shows what came from the iPhone and the edit lost to it, and its rows hold while it is open", async ({
    page,
    remote,
    localBook,
  }) => {
    await twoDevices(page, remote, localBook.id);
    // An ordinary sync leaves the activity glyph away.
    await expect(page.locator("[data-activity-glyph]")).toHaveCount(0);

    const activity = await openActivity(page);
    await expect(activity).toContainText(
      "Nothing in the background right now.",
    );
    await expectHistory(activity);
    const rows = activity.locator("[data-history-row]");
    const order = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-history-row")),
    );

    // The iPhone adds a third highlight while the sheet is open: its group
    // says so in place, and no row moves.
    const now = Date.now();
    fromPhone(remote, highlight(localBook.id, "phone-3", "green", now), now);
    await page.evaluate(async () => {
      const { syncService } = await import("/src/lib/sync-service.ts");
      await syncService.syncAll();
    });
    await expect(
      activity.locator('[data-history-kind="received"]'),
    ).toContainText(
      /3 new highlights and 1 changed highlight in Alice.*Wonderland/,
    );
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-history-row")),
      ),
    ).toEqual(order);
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Activity opens under the account button with the same history", async ({
    page,
    remote,
    localBook,
  }) => {
    await twoDevices(page, remote, localBook.id);
    const activity = await openActivity(page);
    const account = await page
      .getByRole("button", { name: /^Account/ })
      .boundingBox();
    const box = (await activity.boundingBox())!;
    // It hangs from the account button, at its right edge.
    expect(box.y).toBeGreaterThan(account!.y + account!.height - 1);
    expect(
      Math.abs(box.x + box.width - (account!.x + account!.width)),
    ).toBeLessThan(2);
    await expectHistory(activity);
    await page.keyboard.press("Escape");
    await expect(activity).toBeHidden();
  });
});

test.describe("Design ideas → Sync history", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const rowsOf = (page: Page) =>
    page.locator("[data-sync-history] [data-history-row]");
  const kinds = (page: Page) =>
    rowsOf(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-history-kind")),
    );

  test("is the newest topic, and the iPhone's row changes in place while the sheet is open", async ({
    page,
  }) => {
    await page.goto("/debug/ideas");
    await expect(
      page.getByRole("heading", { name: "Now, then Recent" }),
    ).toBeVisible();

    await page.goto("/debug/ideas/sync-history?variant=sections");
    await waitForSheet(page, "Activity");
    const iPhone = rowsOf(page).filter({ hasText: /in Persuasion/ });
    // Its three highlights, or four if the page took three seconds to open.
    await expect(iPhone).toContainText(
      /^From your iPhone.+[34] new highlights/,
    );
    const order = await rowsOf(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-history-row")),
    );
    expect((await kinds(page)).slice(0, 2)).toEqual(["lost", "waiting"]);
    // Three seconds in, the iPhone sends another.
    await expect(iPhone).toContainText("4 new highlights");
    expect(
      await rowsOf(page).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-history-row")),
      ),
    ).toEqual(order);
  });

  test("the timeline puts the lost edit among the groups", async ({ page }) => {
    await page.goto("/debug/ideas/sync-history?variant=timeline");
    await waitForSheet(page, "Activity");
    await expect(rowsOf(page).first()).toHaveAttribute(
      "data-history-kind",
      "waiting",
    );
    const order = await kinds(page);
    expect(order.indexOf("lost")).toBeGreaterThan(order.indexOf("received"));
  });

  test("by device, one row per device", async ({ page }) => {
    await page.goto("/debug/ideas/sync-history?variant=devices");
    await waitForSheet(page, "Activity");
    await expect(rowsOf(page)).toHaveCount(6);
    const ids = await rowsOf(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-history-row")),
    );
    expect(ids.slice(2)).toEqual([
      "device:iphone",
      "device:this device",
      "device:mac",
      "device:ipad",
    ]);
  });
});

test.describe("an iPad in Safari", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("removes a highlight this device changed: the lost edit says it removed it, and it reads as a Mac or iPad", async ({
    page,
    remote,
    localBook,
  }) => {
    // iPadOS Safari sends a Mac's user agent, so the server lists Safari
    // on macOS for it.
    await page.route("**/api/devices", (route) => {
      const now = new Date().toISOString();
      return route.fulfill({
        json: {
          devices: [
            {
              id: REMOTE_DEVICE_ID,
              clientId: REMOTE_DEVICE_ID,
              deviceName: null,
              browser: "Safari",
              os: "macOS",
              deviceType: "desktop",
              createdAt: now,
              lastActiveAt: now,
              isCurrent: false,
            },
          ],
        },
      });
    });
    await setDebug(page, false);
    const now = Date.now();
    const doomed = highlight(
      localBook.id,
      "doomed",
      "yellow",
      now - 60 * minute,
    );
    await page.evaluate(
      async ({ path, row }) => {
        const { syncV2Db } = await import(path);
        await syncV2Db.highlights.put(row);
      },
      { path: DATABASE_MODULE, row: doomed },
    );
    fromPhone(remote, { ...doomed, isDeleted: true }, now + minute);
    await syncNow(page);

    const activity = await openActivity(page);
    const lost = activity.locator('[data-history-kind="lost"]');
    await expect(lost).toHaveCount(1);
    await expect(lost).toContainText("Lost to a newer edit");
    await expect(lost).toContainText(
      /^Lost to a newer edit.+1 highlight in Alice.*Wonderland · your Mac or iPad removed it at \d/,
    );
    await expect(
      activity.locator('[data-history-kind="received"]'),
    ).toContainText(/^From your Mac or iPad.+1 removed highlight in Alice/);
    // The removal won here too.
    expect(
      await page.evaluate(async (path) => {
        const { syncV2Db } = await import(path);
        return (await syncV2Db.highlights.get("doomed"))?.isDeleted;
      }, DATABASE_MODULE),
    ).toBe(true);
  });
});

test.describe("with reduced motion", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a group that joins while Activity is open takes its full height at once", async ({
    page,
    remote,
    localBook,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await twoDevices(page, remote, localBook.id);
    const activity = await openActivity(page);
    await expectHistory(activity);
    // Each row that joins: its height in each of its first 30 frames.
    await page.evaluate(() => {
      const list = document.querySelector("[data-sync-history] [role=list]")!;
      const heights: number[] = [];
      Object.assign(window, { joinedHeights: heights });
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (!node.classList.contains("ba-sheet-row")) continue;
            let frames = 0;
            const sample = () => {
              heights.push(node.getBoundingClientRect().height);
              if (++frames < 30) requestAnimationFrame(sample);
            };
            sample();
          }
      }).observe(list, { childList: true });
    });
    const now = Date.now();
    fromPhone(
      remote,
      highlight(localBook.id, "third-1", "green", now),
      now,
      "third-device",
    );
    await page.evaluate(async () => {
      const { syncService } = await import("/src/lib/sync-service.ts");
      await syncService.syncAll();
    });
    await expect(
      activity
        .locator("[data-history-row]")
        .filter({ hasText: "From another device" }),
    ).toBeVisible();
    const joined = () =>
      page.evaluate(
        () => (window as unknown as { joinedHeights: number[] }).joinedHeights,
      );
    await expect.poll(async () => (await joined()).length).toBe(30);
    const heights = await joined();
    // No frame shows the row part-way open.
    expect(heights.filter((height) => height > 0 && height < 72)).toEqual([]);
    expect(heights.at(-1)).toBe(72);
  });
});
