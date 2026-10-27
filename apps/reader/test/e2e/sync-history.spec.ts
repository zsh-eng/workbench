import type { Locator, Page } from "@playwright/test";
import {
  expect,
  openAccountMenu,
  SAMPLE_BOOK_TITLE,
  test,
  waitForSheet,
} from "./helpers/fixtures";
import { DATABASE_MODULE } from "./helpers/global-setup";
import type { MockApi } from "./helpers/mock-api";

// Account → Activity shows this device's sync history, behind Debug. Two
// devices: this one, and an iPhone (the mock's other device) that adds
// highlights and edits one after this device did, so this device's edit
// is lost to it.

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

/** The iPhone's change, already on the server, made at `at`. */
function fromPhone(
  remote: MockApi,
  row: ReturnType<typeof highlight>,
  at: number,
) {
  remote.enqueue({
    key: JSON.stringify(["highlights", row.id]),
    value: JSON.stringify(row),
    isDeleted: false,
    schemaVersion: 1,
    hlc: { wallTimeMs: at, counter: 0 },
  });
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
 * Debug on, then: this device marks a highlight yellow; the iPhone has
 * added two highlights, and marked the same one blue a minute later.
 */
async function twoDevices(page: Page, remote: MockApi, bookId: string) {
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "true"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
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

test("without Debug, the account menu has no Activity item", async ({
  page,
  localBook: _localBook,
}) => {
  // Development builds start with Debug on; production starts with it off.
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "false"),
  );
  await page.reload();
  const menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: /^Sync now:/ }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Activity" })).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Activity shows what came from the iPhone and the edit lost to it, and its rows hold while it is open", async ({
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
