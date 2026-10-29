import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// SHARED_APPS=spaced2 SHARED_API_PORT=… SHARED_APP_PORT=… move the stack.
const api = `http://localhost:${process.env.SHARED_API_PORT ?? "8792"}`;
const app = `http://localhost:${process.env.SHARED_APP_PORT ?? "5180"}`;
const spaced = `${api}/api/apps/spaced`;
const DAY = 86_400_000;
const CARDS = ["Alder", "Birch", "Cedar"];
const REVIEWS = 600;

/**
 * A migrated account, straight to the server: the cards and their deck,
 * their review history (pages of 500), then each card's latest review,
 * which moves its schedule after its content in every pull.
 */
async function seed(context: BrowserContext) {
  const signUp = await context.request.post(`${api}/api/auth/sign-up/email`, {
    headers: { Origin: app },
    data: {
      email: `${crypto.randomUUID()}@example.test`,
      password: "spaced-first-review-password",
      name: "Spaced first review",
    },
  });
  expect(signUp.status()).toBe(200);
  const scope = JSON.stringify(
    await (
      await context.request.get(`${spaced}/sync/v3/state`, {
        headers: { Origin: app },
      })
    ).json(),
  );
  let clock = Date.now() - 30 * DAY;
  /** When each card was made; its schedule row carries it. */
  const born = CARDS.map((_, index) => clock - 30 * DAY + index * 1_000);
  const record = (
    table: string,
    type: string,
    entity: string,
    payload: object,
  ) => {
    const timestamp = (clock += 1_000);
    const id = JSON.stringify([type, entity]);
    return {
      key: JSON.stringify([table, id]),
      value: JSON.stringify({ type, payload, timestamp, id, isDeleted: false }),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: timestamp, counter: 0 },
    };
  };
  const cardId = (index: number) => `first-review-card-${index}`;
  const schedule = (index: number, reps: number) =>
    record("operations", "card", cardId(index), {
      id: cardId(index),
      createdAt: born[index],
      due: new Date(Date.now() - DAY).toISOString(),
      stability: 10,
      difficulty: 5,
      elapsed_days: 10,
      scheduled_days: 10,
      learning_steps: 0,
      reps,
      lapses: 0,
      state: "Review",
      last_review: new Date(Date.now() - 11 * DAY).toISOString(),
    });
  const content = (index: number, front: string) =>
    record("operations", "cardContent", cardId(index), {
      cardId: cardId(index),
      front,
      back: `${front} answer`,
    });
  const push = async (changes: object[], device = "old-phone") => {
    const response = await context.request.post(`${spaced}/sync/v3/push`, {
      headers: { Origin: app, "X-Sync-Scope": scope, "X-Device-ID": device },
      data: { changes },
    });
    expect(response.status()).toBe(200);
  };
  await push([
    ...CARDS.map((_, index) => schedule(index, 4)),
    ...CARDS.map((front, index) => content(index, front)),
    record("operations", "deck", "first-review-deck", {
      id: "first-review-deck",
      name: "Trees",
      description: "",
      deleted: false,
    }),
    ...CARDS.map((_, index) =>
      record(
        "operations",
        "updateDeckCard",
        JSON.stringify(["first-review-deck", cardId(index)]),
        { deckId: "first-review-deck", cardId: cardId(index), present: true },
      ),
    ),
  ]);
  const reviews = Array.from({ length: REVIEWS }, (_, index) =>
    record("reviewLogOperations", "reviewLog", `first-review-log-${index}`, {
      id: `first-review-log-${index}`,
      cardId: cardId(index % CARDS.length),
      grade: "Good",
      state: "Review",
      due: new Date(clock).toISOString(),
      stability: 10,
      difficulty: 5,
      elapsed_days: 3,
      last_elapsed_days: 3,
      scheduled_days: 10,
      learning_steps: 0,
      review: new Date(clock).toISOString(),
      duration: 5_000,
      createdAt: new Date(clock).toISOString(),
    }),
  );
  await push(reviews.slice(0, 500));
  await push(reviews.slice(500));
  await push(
    CARDS.map((_, index) => schedule(index, 5)),
    "phone",
  );
  return {
    born,
    /** Another device edits Birch's front. */
    editBirch: () => push([content(1, "Birch, edited")], "phone"),
    async serverRecords() {
      const response = await context.request.get(
        `${spaced}/sync/v3/pull?cursor=0&limit=500&excludeOwnDevice=false`,
        {
          headers: {
            Origin: app,
            "X-Sync-Scope": scope,
            "X-Device-ID": "check",
          },
        },
      );
      const records: { key: string; value: string }[] = [];
      let page = await response.json();
      records.push(...page.records);
      while (page.hasMore) {
        page = await (
          await context.request.get(
            `${spaced}/sync/v3/pull?cursor=${page.cursor}&head=${page.head}&limit=500&excludeOwnDevice=false`,
            {
              headers: {
                Origin: app,
                "X-Sync-Scope": scope,
                "X-Device-ID": "check",
              },
            },
          )
        ).json();
        records.push(...page.records);
      }
      return records;
    },
  };
}

const syncState = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.startsWith("spaced-records-v3-state"),
    );
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
/** The front of the card under review. */
const front = (page: Page) =>
  page.locator("main article").first().textContent();
const good = (page: Page) =>
  page.getByRole("button", { name: "Good", exact: true });

test("a new device reviews from the priority pull, and the full pull keeps its review", async ({
  browser,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  const account = await seed(context);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // The full pull waits; once `holdAll` is set, so does the priority pull.
  let holdAll = false;
  await context.route(`${spaced}/sync/v3/pull-stream?**`, async (route) => {
    if (holdAll || !route.request().url().includes("prefix=")) await held;
    await route.continue().catch(() => {});
  });

  const page = await context.newPage();
  await page.goto(app);
  // Review opens while the review history has not started to commit.
  await expect(good(page)).toBeVisible();
  await expect(page.getByText("Restoring review history…")).toBeVisible();
  await expect(page.locator('a[href="/"]').first()).toHaveText("3");
  expect(await syncState(page)).toMatchObject({
    pullCursor: 0,
    bootstrapped: false,
  });
  // A grade on the cards as the priority pull left them: each card's
  // content came before its schedule.
  const graded = (await front(page))!.trim();
  await good(page).click();
  await expect(page.locator('a[href="/"]').first()).toHaveText("2");
  expect((await front(page))!.trim()).not.toBe(graded);

  // With every pull held, only the device's marker can open the pages.
  holdAll = true;
  // Stats waits for the history rather than showing part of it.
  await page.goto(`${app}/stats`);
  await expect(page.getByText("Restoring your review history…")).toBeVisible();
  // A reload during the rest of the restore opens Review at once.
  await page.goto(app);
  await expect(good(page)).toBeVisible();
  await expect(page.getByText("Restoring review history…")).toBeVisible();
  await expect(page.locator('a[href="/"]').first()).toHaveText("2");
  await account.editBirch();
  release();

  await expect
    .poll(async () => (await syncState(page))?.bootstrapped, {
      timeout: 30_000,
    })
    .toBe(true);
  await expect(page.getByText("Restoring review history…")).toHaveCount(0);
  const index = CARDS.indexOf(graded);
  const local = await page.evaluate(
    async ({ index }) => {
      const path = "/src/lib/db/persistence.ts";
      const { db } = await import(path);
      const outbox = () => db._sync_outbox.count();
      for (let wait = 0; (await outbox()) > 0 && wait < 100; wait++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      const card = await db.operations.get(
        JSON.stringify(["card", `first-review-card-${index}`]),
      );
      const birch = await db.operations.get(
        JSON.stringify(["cardContent", "first-review-card-1"]),
      );
      return {
        reps: card.payload.reps,
        createdAt: card.payload.createdAt,
        birch: birch.payload.front,
        reviews: await db.reviewLogOperations.count(),
        outbox: await outbox(),
      };
    },
    { index },
  );
  // The review made during the restore stays, with the card's creation
  // time: the full pull's copy of the card is the older version, and its
  // log is the only new one.
  expect(local).toEqual({
    reps: 6,
    createdAt: account.born[index],
    birch: "Birch, edited",
    reviews: REVIEWS + 1,
    outbox: 0,
  });
  const server = await account.serverRecords();
  const reviewLogs = server.filter((record) =>
    record.key.startsWith('["reviewLogOperations"'),
  );
  expect(reviewLogs).toHaveLength(REVIEWS + 1);
  const schedule = server.find(
    (record) =>
      record.key ===
      JSON.stringify([
        "operations",
        JSON.stringify(["card", `first-review-card-${index}`]),
      ]),
  )!;
  expect(JSON.parse(schedule.value).payload).toMatchObject({
    reps: local.reps,
    createdAt: local.createdAt,
  });
  await context.close();
});

/** Requests that wait until it opens. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

test("a reload, an offline start and a second tab show the restore, not part of the library", async ({
  browser,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  await seed(context);
  const pulls = gate();
  let priorityHeld = true;
  await context.route(`${spaced}/sync/v3/pull-stream?**`, async (route) => {
    if (priorityHeld || !route.request().url().includes("prefix="))
      await pulls.opened;
    await route.continue().catch(() => {});
  });
  /** This page's account check waits until the gate opens. */
  const holdAccount = async (page: Page) => {
    const account = gate();
    await page.unroute(`${spaced}/me`);
    await page.route(`${spaced}/me`, async (route) => {
      await account.opened;
      await route.continue().catch(() => {});
    });
    return account;
  };
  const cardsWait = (page: Page) => page.getByText("Restoring your cards…");
  const historyWait = (page: Page) =>
    page.getByText("Restoring your review history…");
  const historyNote = (page: Page) =>
    page.getByText("Restoring review history…");

  const page = await context.newPage();
  await page.goto(app);
  await expect(cardsWait(page)).toBeVisible();
  // A reload before the account check answers: the cards are still coming.
  let account = await holdAccount(page);
  await page.reload();
  await expect.soft(cardsWait(page)).toBeVisible();
  priorityHeld = false;
  account.open();
  await expect(good(page)).toBeVisible();
  await expect(historyNote(page)).toBeVisible();

  // A second tab, which waits while the first one restores.
  const second = await context.newPage();
  await second.goto(`${app}/stats`);
  await expect.soft(historyWait(second)).toBeVisible();
  await second.goto(app);
  await expect(good(second)).toBeVisible();
  await expect.soft(historyNote(second)).toBeVisible();

  // An offline start: no sync runs, so only what the device saved speaks.
  const offline = await context.newPage();
  await offline.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { get: () => false }),
  );
  await offline.goto(`${app}/stats`);
  await expect.soft(historyWait(offline)).toBeVisible();
  await offline.goto(app);
  await expect(good(offline)).toBeVisible();
  await expect.soft(historyNote(offline)).toBeVisible();

  // A reload of the first tab during the history, before its account check.
  account = await holdAccount(page);
  await page.goto(`${app}/stats`);
  await expect.soft(historyWait(page)).toBeVisible();

  account.open();
  pulls.open();
  // Every tab hears the end of the restore, the offline one too.
  for (const tab of [page, second, offline])
    await expect(tab.getByText(/Restoring/)).toHaveCount(0, {
      timeout: 30_000,
    });
  await context.close();
});
