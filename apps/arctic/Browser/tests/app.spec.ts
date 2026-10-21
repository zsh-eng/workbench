import {
  expect,
  request as api,
  test,
  type BrowserContext,
} from "@playwright/test";
import { API, article, paragraphs, phone, signUp, sorted } from "./phone";

const ice = article("https://example.com/sea-ice", {
  title: "How sea ice keeps time | Example",
  subtitle: "A season on the floe.",
  tags: ["Science"],
  savedAt: Date.now() - 3_600_000,
  importBatchID: "6D1E0A44-1C2B-4F7D-8E9A-2B3C4D5E6F70",
});
const tundra = article("https://example.org/tundra", {
  title: "The tundra in winter",
  tags: ["Nature"],
  savedAt: Date.now() - 7_200_000,
});
const shelved = article("https://example.net/shelved", {
  title: "A finished story",
  archived: true,
});

test.beforeEach(async ({ context }) => {
  await signUp(context);
  await phone(context.request).push([
    ...ice.records,
    ...tundra.records,
    ...shelved.records,
  ]);
});

const library = async (context: BrowserContext, id: string) =>
  JSON.parse(
    (await phone(context.request).records()).get(`library/${id}`)!.value,
  );

test("shows the phone's library, with topics, search and folders", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);
  // The publisher suffix is display noise, as on the phone.
  await expect(page.locator(".card-title").first()).toHaveText(
    "How sea ice keeps time",
  );
  await expect(page.locator(".shelf-count")).toHaveText("2 articles");

  await page.getByRole("button", { name: /^Nature/ }).click();
  await expect(page.locator(".card-title")).toHaveText([
    "The tundra in winter",
  ]);
  await page.getByRole("button", { name: "All", exact: true }).click();

  await page.keyboard.press("/");
  await page.keyboard.type("floe");
  await expect(page.locator(".card-title")).toHaveText([
    "How sea ice keeps time",
  ]);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page.locator(".card-title")).toHaveText(["A finished story"]);
});

test("saves article text from files and reads it; refuses previews and strangers", async ({
  page,
  context,
}) => {
  await page.goto("/copies");
  await page.setInputFiles('input[type="file"]', [
    {
      name: "ice.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<article data-arctic-url="https://example.com/sea-ice" data-arctic-byline="Ann Lee15 September 2026">${paragraphs(12)}<script>alert(1)</script></article>`,
      ),
    },
    {
      name: "tundra.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<article data-arctic-url="https://www.example.org/tundra/">${paragraphs(1)}</article>`,
      ),
    },
    {
      name: "stranger.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<article data-arctic-url="https://elsewhere.example/x">${paragraphs(12)}</article>`,
      ),
    },
  ]);
  await page.getByRole("button", { name: "Save 2 copies" }).click();
  await expect(page.locator(".rows li")).toHaveText([
    /sea ice.*words/,
    /tundra.*Only \d+ words/,
    /stranger.*No article/,
  ]);

  // The copy lives in arctic-content, apart from the phone's records.
  const content = phone(context.request, "arctic-content");
  await expect
    .poll(async () => (await content.records()).has(`content/${ice.id}`), {
      timeout: 10_000,
    })
    .toBe(true);
  const record = JSON.parse(
    (await content.records()).get(`content/${ice.id}`)!.value,
  );
  expect(record).toMatchObject({
    url: ice.url,
    format: "html",
    source: "file",
    byline: "Ann Lee",
  });
  expect(
    (await phone(context.request).records()).has(`content/${ice.id}`),
  ).toBe(false);
  const scope = JSON.stringify(
    await (
      await context.request.get(`${API}/api/apps/arctic-content/sync/v3/state`)
    ).json(),
  );
  const file = await (
    await context.request.get(
      `${API}/api/apps/arctic-content/files/${record.file}`,
      { headers: { "X-Sync-Scope": scope } },
    )
  ).text();
  expect(file).toContain("Paragraph 12.");
  expect(file).not.toContain("<script");

  await page.goto("/");
  await page
    .locator(".card-title", { hasText: "How sea ice keeps time" })
    .click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  await expect(page.locator(".byline")).toContainText("Ann Lee");
  // Opening counts as a visit on every device.
  await expect
    .poll(async () => (await library(context, ice.id)).read, {
      timeout: 15_000,
    })
    .toBe(true);
});

test("archive and favourite write records in the phone's format and keep its fields", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "More for How sea ice keeps time" })
    .click();
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);

  await page
    .locator(".card-title", { hasText: "How sea ice keeps time" })
    .click();
  await expect(page.locator(".article-title")).toHaveText(
    "How sea ice keeps time",
  );
  await page.keyboard.press("f");
  await expect(
    page.getByRole("button", { name: "Favourite" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".toast")).toContainText("Archived");

  // The first Archive may upload before its Undo; wait for the final state.
  await expect
    .poll(
      async () => {
        const fields = await library(context, ice.id);
        return [fields.archived, fields.favourite, fields.read];
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true, true]);
  const records = await phone(context.request).records();
  const value = records.get(`library/${ice.id}`)!;
  const fields = JSON.parse(value.value);
  expect(value.value).toBe(sorted(fields));
  expect(value.deviceId).toMatch(/^web-/);
  expect(fields).toMatchObject({
    url: ice.url,
    saved: true,
    archived: true,
    favourite: true,
    read: true,
    importBatchID: "6D1E0A44-1C2B-4F7D-8E9A-2B3C4D5E6F70",
    savedAt: JSON.parse(ice.records[1]!.value).savedAt,
  });
  expect(fields.favouritedAt).toEqual(expect.any(Number));
  expect(fields.lastVisitedAt).toEqual(expect.any(Number));
  // The web app never writes the phone's article or tag records.
  expect(records.get(`article/${ice.id}`)!.deviceId).toBe("iphone");
  expect(records.get(`tags/${ice.id}`)!.deviceId).toBe("iphone");
});

test("an edit made offline merges with a later change from the phone", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "More for The tundra in winter" })
    .click();
  await page.getByRole("menuitem", { name: /^Favourite/ }).click();
  await expect(page.locator(".status-note")).toContainText("Offline", {
    timeout: 10_000,
  });

  // Meanwhile the phone archives the same article: a later edit of another field.
  const iphone = await api.newContext({
    storageState: await context.storageState(),
  });
  const before = JSON.parse(tundra.records[1]!.value);
  await phone(iphone).push([
    {
      key: `library/${tundra.id}`,
      value: sorted({ ...before, archived: true }),
    },
  ]);

  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        const fields = await library(context, tundra.id);
        return [fields.archived, fields.favourite];
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true]);
  await page.getByRole("link", { name: "Favourites", exact: true }).click();
  await expect(page.locator(".card-title")).toHaveText([
    "The tundra in winter",
  ]);
  await iphone.dispose();
});

test("remove writes tombstones for the article; Undo restores it", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "More for The tundra in winter" })
    .click();
  await page.getByRole("menuitem", { name: "Remove from library" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);

  await page
    .getByRole("button", { name: "More for How sea ice keeps time" })
    .click();
  await page.getByRole("menuitem", { name: "Remove from library" }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect
    .poll(
      async () => {
        const records = await phone(context.request).records();
        return ["article", "library", "tags"].map(
          (family) => records.get(`${family}/${ice.id}`)!.isDeleted,
        );
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true, true]);
  const records = await phone(context.request).records();
  expect(records.get(`library/${tundra.id}`)!.isDeleted).toBe(false);
});
