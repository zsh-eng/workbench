import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./helpers/fixtures";
const stage = process.env.INTERFACE_REVIEW_STAGE ?? "after";
const folder = resolve("diagnostics/interface-review", stage);

test("review highlight filters and all theme contrast pairs", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    await (
      await import(path)
    ).addHighlight({
      id: "interface-review",
      bookId,
      spineItemId: "chapter",
      startOffset: 0,
      endOffset: 22,
      selectedText: "A thought worth keeping.",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: 1720000000000,
    });
  }, localBook.id);
  await page.goto("/highlights");
  await expect(
    page.getByText("A thought worth keeping.", { exact: false }),
  ).toBeVisible();
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: resolve(folder, "highlights-populated.png"),
    animations: "disabled",
  });
  const report: Record<string, Record<string, number>> = {};
  for (const theme of [
    "light",
    "dark",
    "night",
    "flexoki-light",
    "flexoki-dark",
  ]) {
    report[theme] = await page.evaluate((theme) => {
      document.documentElement.classList.remove(
        "light",
        "dark",
        "night",
        "flexoki-light",
        "flexoki-dark",
      );
      document.documentElement.classList.add(theme);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const style = getComputedStyle(document.documentElement);
      function luminance(token: string) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = style.getPropertyValue(token).trim();
        ctx.fillRect(0, 0, 1, 1);
        const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      }
      function contrast(a: string, b: string) {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      }
      return Object.fromEntries([
        ["body", contrast("--foreground", "--background")],
        ["muted", contrast("--muted-foreground", "--secondary")],
        ...["yellow", "blue", "green", "magenta"].map((color) => [
          color,
          contrast("--foreground", `--${color}-secondary`),
        ]),
      ]);
    }, theme);
    // Let CSS theme changes settle without freezing transitions mid-frame.
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: resolve(folder, `highlights-${theme}.png`),
      animations: "disabled",
    });
  }
  await writeFile(
    resolve(folder, "contrast.json"),
    JSON.stringify(report, null, 2),
  );
  if (!stage.endsWith("before")) {
    for (const [theme, pairs] of Object.entries(report))
      for (const [pair, ratio] of Object.entries(pairs))
        expect.soft(ratio, `${theme} ${pair}`).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("not present in this book");
  await expect(
    page.getByText("Nothing matches", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(folder, "highlights-no-results.png"),
    animations: "disabled",
  });
  if (!stage.endsWith("before")) {
    const message = page.getByText("Nothing matches", { exact: false });
    expect((await message.boundingBox())!.y).toBeGreaterThan(
      (await page.getByRole("searchbox").boundingBox())!.y + 56,
    );
    await page
      .getByRole("button", { name: "Show everything", exact: true })
      .click();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByRole("searchbox")).toBeFocused();
    await expect(
      page.getByText("A thought worth keeping.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Yellow highlights" }),
    ).toHaveAttribute("aria-pressed", "false");
  }
});

test.describe("account metadata", () => {
  test.use({
    signedIn: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("long device names wrap inside the mobile viewport", async ({
    page,
  }) => {
    await page.route("**/api/sessions", (route) =>
      route.fulfill({
        json: {
          sessions: [
            {
              id: "test-session",
              browser: {
                name: "A very long browser identification string",
                version: "123.456.789.123456789",
              },
              os: {
                name: "A long operating system name",
                version: "123.456.789",
              },
              deviceType: "mobile",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              isCurrent: true,
            },
          ],
        },
      }),
    );
    await page.goto("/devices");
    await expect(
      page.getByRole("heading", { name: "Devices", exact: true }),
    ).toBeVisible();
    const title = page.getByRole("heading", { name: /A very long browser/ });
    await expect(title).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await expect(title).toHaveCSS("text-overflow", "clip");
    await mkdir(folder, { recursive: true });
    await page.screenshot({
      path: resolve(folder, "devices-long-names.png"),
      animations: "disabled",
    });
  });
});
