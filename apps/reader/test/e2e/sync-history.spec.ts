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

// Account → Activity shows this device's sync history, by book, to every
// reader; Devices' list of syncing devices stays behind Debug. Two devices:
// this one, and an iPhone (the mock's other device) that adds highlights
// and edits one after this device did. Sync keeps the newest edit, so
// Activity says only what each device did.

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

/** The sample book, today: the iPhone's lines first, then this device's. */
async function expectBooks(activity: Locator) {
  const books = activity.locator("[data-book-activity] [data-activity-book]");
  await expect(books).toHaveCount(1);
  await expect(activity.getByRole("heading", { name: "Today" })).toBeVisible();
  const alice = books.first();
  await expect(alice).toContainText(/Alice.*Wonderland/);
  const devices = alice.locator("[data-activity-device]");
  await expect(devices).toHaveCount(2);
  // A line for each kind of change, the device's tag after the first.
  const phone = devices.first().locator("[data-activity-line]");
  await expect(phone).toHaveText([/^2 highlights/, "Edited a highlight"]);
  await expect(phone.first().locator("[data-device-tag]")).toHaveText(
    "your iPhone",
  );
  await expect(phone.first().locator("[data-device-tag]")).toHaveAttribute(
    "data-device-tag",
    "other",
  );
  // This device's own changes went out in the same pass; it wears the ribbon.
  const here = devices.nth(1).locator("[data-activity-line]");
  await expect(here.first()).toContainText("Added to your library");
  await expect(here.first().locator('[data-device-tag="here"]')).toHaveText(
    /^this /,
  );
  await expect(devices.locator("[data-device-tag]")).toHaveCount(2);
  // Sync kept the iPhone's newer edit; nothing asks you about it.
  await expect(activity).not.toContainText("Lost");
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

  test("without Debug, Activity shows each book with what each device did, and counts a new change in place", async ({
    page,
    remote,
    localBook,
  }) => {
    await twoDevices(page, remote, localBook.id);
    // An ordinary sync leaves the activity glyph away.
    await expect(page.locator("[data-activity-glyph]")).toHaveCount(0);

    const activity = await openActivity(page);
    // Nothing in the background, and online: nothing to say beside the title.
    await expect(activity.locator("[data-activity-status]")).toHaveCount(0);
    await expect(activity).not.toContainText("Nothing in the background");
    await expectBooks(activity);

    // The iPhone adds a third highlight while the sheet is open: its line
    // says so in place.
    const now = Date.now();
    fromPhone(remote, highlight(localBook.id, "phone-3", "green", now), now);
    await page.evaluate(async () => {
      const { syncService } = await import("/src/lib/sync-service.ts");
      await syncService.syncAll();
    });
    await expect(
      activity
        .locator("[data-activity-device]")
        .first()
        .locator("[data-activity-line]"),
    ).toHaveText([/^3 highlights/, "Edited a highlight"]);
  });

  test("a change from a device the server doesn't list joins its book's row as another device", async ({
    page,
    remote,
    localBook,
  }) => {
    await twoDevices(page, remote, localBook.id);
    const activity = await openActivity(page);
    await expectBooks(activity);
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
    const devices = activity.locator("[data-activity-device]");
    await expect(devices).toHaveCount(3);
    await expect(devices.first()).toHaveText(/^A highlight/);
    await expect(devices.first().locator("[data-device-tag]")).toHaveText(
      "another device",
    );
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Activity opens under the account button with the same books", async ({
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
    await expect(
      activity.getByRole("heading", { name: "Activity", exact: true }),
    ).toBeVisible();
    await expectBooks(activity);
    await page.keyboard.press("Escape");
    await expect(activity).toBeHidden();
  });
});

test.describe("Design ideas → Sync history", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("By book is the choice, and the iPhone's line in Persuasion counts its new highlight in place", async ({
    page,
  }) => {
    await page.goto("/debug/ideas");
    await expect(page.getByRole("heading", { name: "By book" })).toBeVisible();

    await page.goto("/debug/ideas/sync-history");
    await waitForSheet(page, "Activity");
    const books = page.locator("[data-book-activity] [data-activity-book]");
    // What still waits comes first; Emma has a row today and yesterday.
    await expect(books.first()).toHaveAttribute("data-activity-book", "emma");
    await expect(books.first()).toContainText("Waiting");
    await expect(books.filter({ hasText: "Emma" })).toHaveCount(2);
    await expect(
      page.getByRole("heading", { name: "Yesterday" }),
    ).toBeVisible();
    const persuasion = books.filter({ hasText: "Persuasion" });
    const lines = persuasion.locator("[data-activity-line]");
    // Its three highlights, or four if the page took three seconds to open,
    // then its place on a line of its own.
    await expect(lines).toHaveText([
      /^[34] highlights and a bookmark/,
      "Your place,\u00a038%",
    ]);
    await expect(persuasion.locator("[data-device-tag]")).toHaveText(
      "your iPhone",
    );
    // Three seconds in, the iPhone sends another.
    await expect(lines.first()).toContainText("4 highlights and a bookmark");
    await expect(books.nth(1)).toHaveAttribute(
      "data-activity-book",
      "persuasion",
    );
  });
});

test.describe("an iPad in Safari", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("removes a highlight this device changed: Activity says it removed it, and names it a Mac or iPad", async ({
    page,
    remote,
    localBook,
  }) => {
    // iPadOS Safari sends a Mac's user agent, so the server lists Safari
    // on macOS for it, with the name it made up from that.
    await page.route("**/api/devices", (route) => {
      const now = new Date().toISOString();
      return route.fulfill({
        json: {
          devices: [
            {
              id: REMOTE_DEVICE_ID,
              clientId: REMOTE_DEVICE_ID,
              deviceName: "Safari on macOS",
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
    const removed = activity
      .locator("[data-activity-line]")
      .filter({ hasText: "Removed a highlight" });
    await expect(removed).toHaveCount(1);
    const tag = removed.locator("[data-device-tag]");
    await expect(tag).toHaveText("your Mac or iPad");
    // Neither a computer's glyph nor a tablet's.
    await expect(tag.locator("svg.lucide-monitor-smartphone")).toHaveCount(1);
    await expect(activity).not.toContainText("Lost");
    // The removal won here too.
    expect(
      await page.evaluate(async (path) => {
        const { syncV2Db } = await import(path);
        return (await syncV2Db.highlights.get("doomed"))?.isDeleted;
      }, DATABASE_MODULE),
    ).toBe(true);
  });
});
