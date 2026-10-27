import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp, sorted } from "./phone";

// A new device: the phone's first upload sent every article/ record, then
// every library/ record, then every tags/ record, each family sorted by key.
// 300 links make two pull pages, the second with the rest of library/.
const links = Array.from({ length: 300 }, (_, index) =>
  article(`https://example.com/floe/${index}`, {
    title: `Floe ${index}`,
    savedAt: Date.UTC(2026, 9, 1) + index * 60_000,
  }),
);
const newest = links.at(-1)!;
const byKey = (records: { key: string; value: string }[]) =>
  records.sort((a, b) => (a.key < b.key ? -1 : 1));

test.beforeEach(async ({ context }) => {
  await signUp(context);
  const records = links.flatMap((link) => link.records);
  const ordered = ["article/", "library/", "tags/"].flatMap((family) =>
    byKey(records.filter((record) => record.key.startsWith(family))),
  );
  for (let start = 0; start < ordered.length; start += 450)
    await phone(context.request).push(ordered.slice(start, start + 450));
  await addText(context.request, newest, paragraphs(400));
  await phone(context.request, "arctic-annotations").push([
    {
      key: "annotation/5E0C2D7A-6B4F-4C1D-9E8A-0F1B2C3D4E5F",
      value: sorted({
        articleURL: newest.url,
        colour: "sage",
        createdAt: 815_000_000,
        id: "5E0C2D7A-6B4F-4C1D-9E8A-0F1B2C3D4E5F",
        isHighlighted: true,
        note: "",
        quote: {
          exact: "Paragraph 3. Sea ice forms",
          prefix: "",
          suffix: "",
          start: 0,
        },
        updatedAt: 815_000_000,
      }),
    },
  ]);
});

test("a new device shows its library once, in order, then its texts and highlights", async ({
  page,
}) => {
  // What the first frame with real cards showed: the count and the top card.
  await page.addInitScript(() => {
    const seen = { count: "", top: "" };
    (window as { __first?: typeof seen }).__first = seen;
    const look = () => {
      const top = document.querySelector(".card[data-id] .card-title");
      if (top) {
        seen.top = top.textContent ?? "";
        seen.count = document.querySelector(".shelf-count")?.textContent ?? "";
      } else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "OPTIONS")
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto("/");
  await expect(page.locator(".card[data-id]").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as { __first?: { count: string; top: string } }).__first,
    ),
  ).toMatchObject({ count: "300 articles", top: "Floe 299" });

  // Texts and highlights arrive after the links.
  await expect(
    page.locator(".card", { hasText: "Floe 299" }).locator(".source"),
  ).toContainText("min");
  await page.getByRole("link", { name: "Highlights" }).click();
  await expect(page.getByText("Paragraph 3. Sea ice forms")).toBeVisible();

  // The account check brought the links' scope, and nothing was pushed.
  expect(requests).not.toContain("GET /api/apps/arctic/sync/v3/state");
  expect(requests.filter((line) => line.endsWith("/sync/v3/push"))).toEqual([]);
});
