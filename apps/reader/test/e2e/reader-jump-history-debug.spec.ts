import { test, expect } from "./helpers/fixtures";
import type { Page } from "@playwright/test";
import type { ReaderJumpHistory } from "../../src/features/reader/jump-history";

async function state(page: Page): Promise<ReaderJumpHistory> {
  return JSON.parse((await page.getByTestId("history-json").textContent())!);
}
async function move(page: Page, kind: string, destination: string) {
  await page
    .getByRole("combobox", { name: "Action type", exact: true })
    .selectOption(kind);
  await page.getByLabel("Destination", { exact: true }).fill(destination);
  await page.getByRole("button", { name: "Run action", exact: true }).click();
}

test("plays typed movements and exposes the actual array, cursor and saved state", async ({
  page,
}) => {
  await page.goto("/debug/jump-history");
  await expect(
    page.getByRole("heading", { name: "Jump history playground" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeDisabled();
  await move(page, "highlight", "H1");
  await move(page, "highlight", "H2");
  await move(page, "normal", "R1");
  await move(page, "normal", "R2");
  expect(
    (await state(page)).entries.map((entry) => [
      entry.kind,
      entry.anchor.blockId,
    ]),
  ).toEqual([
    ["normal", "A"],
    ["highlight", "H2"],
    ["normal", "R2"],
  ]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("history-location")).toHaveText("H2");
  expect((await state(page)).cursor).toBe(1);
  await page.reload();
  await expect(page.getByTestId("history-location")).toHaveText("H2");
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(page.getByTestId("history-location")).toHaveText("R2");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await move(page, "toc", "C");
  expect(
    (await state(page)).entries.map((entry) => entry.anchor.blockId),
  ).toEqual(["A", "H2", "C"]);
  await expect(
    page.getByRole("button", { name: "Forward", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("reader-jump-history-v1")),
  ).toBeNull();
});

test("steps through previews, commit and history eviction", async ({
  page,
}, testInfo) => {
  await page.goto("/debug/jump-history");
  await expect(
    page.getByRole("heading", { name: "Jump history playground" }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("combobox", { name: "Example", exact: true })
    .selectOption({ label: "Scrub, then highlight" });
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByTestId("history-preview")).toContainText("B3");
  expect((await state(page)).entries).toHaveLength(1);
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByTestId("history-preview")).toHaveCount(0);
  await expect(page.getByTestId("history-location")).toHaveText("B3");
  await page
    .getByRole("button", { name: "Run remaining", exact: true })
    .click();
  expect(
    (await state(page)).entries.map((entry) => entry.anchor.blockId),
  ).toEqual(["A", "B3", "C"]);
  expect((await state(page)).cursor).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("jump-history-playground.png"),
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Example", exact: true })
    .selectOption({ label: "Reach the history limit" });
  await page
    .getByRole("button", { name: "Run remaining", exact: true })
    .click();
  expect((await state(page)).entries).toHaveLength(30);
  expect((await state(page)).entries[0].anchor.blockId).toBe("L3");
  await page.getByRole("button", { name: "Reset to A", exact: true }).click();
  await expect(page.getByTestId("history-location")).toHaveText("A");
});

test("gates the playground and links to it from debug tools", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "false"),
  );
  await page.goto("/debug/jump-history");
  await expect(
    page.getByRole("heading", { name: "Debug mode is off" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Open settings" }).click();
  await expect(page.getByRole("link", { name: /Debug tools/ })).toHaveCount(0);
  const toggle = page.getByRole("switch", { name: "Debug mode" });
  // The shell fades in after entering from a route outside it.
  await expect
    .poll(() =>
      toggle.evaluate((element) => {
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          if (getComputedStyle(node).opacity !== "1") return false;
        }
        return true;
      }),
    )
    .toBe(true);
  await toggle.check();
  await page.getByRole("link", { name: /Debug tools/ }).click();
  await page.getByRole("link", { name: /^Jump history/ }).click();
  await expect(
    page.getByRole("heading", { name: "Jump history playground" }),
  ).toBeVisible({ timeout: 30_000 });
});

async function expectStripSettled(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId("history-strip").evaluate((strip) => {
        const focus = strip
          .querySelector('[data-testid="history-strip-focus"]')!
          .getBoundingClientRect();
        const current = strip
          .querySelector('[aria-current="location"]')!
          .getBoundingClientRect();
        const bounds = strip.getBoundingClientRect();
        const centre = current.x + current.width / 2;
        return Math.max(
          Math.abs(centre - (focus.x + focus.width / 2)),
          Math.abs(centre - (bounds.x + bounds.width / 2)),
        );
      }),
    )
    .toBeLessThan(1);
}

for (const mobile of [true, false]) {
  test(`footer strip centres the trail and restores the original quiet count (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 900 });
    await page.goto("/debug/jump-history");
    const strip = page.getByTestId("history-strip");
    await expect(strip).toHaveAttribute("data-mode", "quiet", {
      timeout: 30_000,
    });
    if (!mobile)
      await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Example", exact: true })
      .selectOption({ label: "Pages 81 → 140 → 25" });
    const quiet = strip.locator(".history-strip-quiet");
    const originalType = await quiet
      .locator(".font-numeric")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          family: style.fontFamily,
          size: style.fontSize,
          spacing: style.letterSpacing,
        };
      });
    expect(originalType.family).toContain("Inter");
    expect(originalType.size).toBe("10px");
    await expect(quiet).toContainText("p.");
    await expect(quiet).toContainText("of 1200");
    const quietHeight = await strip.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await page
      .getByRole("button", { name: "Run remaining", exact: true })
      .click();
    await expect(strip).toHaveAttribute("data-mode", "history");
    await expectStripSettled(page);
    const trail = await state(page);
    expect(trail.entries.map((entry) => entry.anchor.blockId)).toEqual([
      "A",
      "140",
      "25",
    ]);
    expect(trail.cursor).toBe(1);
    await expect(
      strip.getByRole("button", {
        name: "Current page 140, Highlight",
        exact: true,
      }),
    ).toBeVisible();
    await strip
      .getByRole("button", {
        name: "Earlier visit: page 81, Reading",
        exact: true,
      })
      .click();
    await expectStripSettled(page);
    expect((await state(page)).cursor).toBe(0);
    expect((await state(page)).entries).toEqual(trail.entries);
    await strip
      .getByRole("button", {
        name: "Later visit: page 140, Highlight",
        exact: true,
      })
      .click();
    await expectStripSettled(page);
    await expect(quiet).toHaveCSS("opacity", "0");
    const current = strip.locator('[aria-current="location"]');
    const historyType = await current.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        family: style.fontFamily,
        size: style.fontSize,
        spacing: style.letterSpacing,
      };
    });
    expect(historyType.family).toBe(originalType.family);
    expect(historyType.size).toBe(originalType.size);
    expect(parseFloat(historyType.spacing)).toBeCloseTo(0.6);
    expect(parseFloat(historyType.spacing)).toBeLessThan(
      parseFloat(originalType.spacing),
    );
    // Compare rendered text bounds, not button boxes: quiet mode has asymmetric padding.
    const baselineDifference = await strip.evaluate((element) => {
      const textBounds = (text: Element) => {
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect();
      };
      const history = textBounds(
        element.querySelector(
          '[aria-current="location"] .history-strip-number',
        )!,
      );
      const quiet = textBounds(
        element.querySelector(".history-strip-quiet .text-foreground > span")!,
      );
      return Math.abs(history.y - quiet.y);
    });
    expect(baselineDifference).toBeLessThan(0.5);
    const gaps = await strip
      .locator(".history-strip-entry")
      .evaluateAll((entries) => {
        const centres = entries.map((element) => {
          // Include the icon's actual bounds, even if it is positioned separately.
          const parts = Array.from(
            element.querySelectorAll(
              ".history-strip-number, .history-strip-icon",
            ),
          ).map((part) => part.getBoundingClientRect());
          const left = Math.min(...parts.map((part) => part.left));
          const right = Math.max(...parts.map((part) => part.right));
          const slot = element.getBoundingClientRect();
          return {
            label: (left + right) / 2,
            slot: slot.x + slot.width / 2,
          };
        });
        return {
          gaps: [
            centres[1].label - centres[0].label,
            centres[2].label - centres[1].label,
          ],
          offsets: centres.map((centre) =>
            Math.abs(centre.label - centre.slot),
          ),
        };
      });
    expect(gaps.gaps[0]).toBeCloseTo(gaps.gaps[1], 1);
    expect(gaps.gaps[0]).toBeLessThan(90);
    expect(Math.max(...gaps.offsets)).toBeLessThan(0.5);
    await expect(strip.locator('[data-kind="normal"] svg')).toHaveCount(1);
    await expect(strip.locator('[data-kind="highlight"] svg')).toHaveCount(1);
    await expect(strip.locator('[data-kind="internal-link"] svg')).toHaveCount(
      0,
    );
    expect(
      await strip.evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(quietHeight);
    await page.getByTestId("history-footer-preview").screenshot({
      path: testInfo.outputPath(
        `history-strip-${mobile ? "mobile" : "desktop"}.png`,
      ),
    });

    // The next normal movement hides the strip without discarding the earlier trail.
    await page
      .getByRole("button", { name: "Read next page", exact: true })
      .click();
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    await expect(
      strip.getByRole("button", {
        name: "Page 141 of 1200. Show jump history",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await state(page)).entries.map((entry) => entry.anchor.blockId),
    ).toEqual(["A", "140", "141"]);
    await expect(quiet).toHaveCSS("opacity", "1");
    await expect(quiet).toContainText("of 1200");
    expect(
      await strip.evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(quietHeight);
    await strip
      .getByRole("button", {
        name: "Page 141 of 1200. Show jump history",
        exact: true,
      })
      .click();
    await expect(strip).toHaveAttribute("data-mode", "history");
    await strip
      .getByRole("button", { name: "Current page 141, Reading", exact: true })
      .press("ArrowLeft");
    expect((await state(page)).cursor).toBe(1);
    await expectStripSettled(page);
  });
}

test("footer strip replaces grouped jumps in place across digit widths", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/debug/jump-history");
  const strip = page.getByTestId("history-strip");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await move(page, "highlight", "99");
  await expectStripSettled(page);
  const before = await page
    .getByTestId("history-strip-track")
    .evaluate((el) => getComputedStyle(el).transform);
  await move(page, "highlight", "1000");
  await expectStripSettled(page);
  expect((await state(page)).entries).toHaveLength(2);
  expect(
    await page
      .getByTestId("history-strip-track")
      .evaluate((el) => getComputedStyle(el).transform),
  ).toBe(before);
  const committed = await state(page);
  await move(page, "preview", "600");
  await expect(strip).toHaveAttribute("data-mode", "quiet");
  await expect(strip).toHaveAttribute("data-current-page", "600");
  expect(await state(page)).toEqual(committed);
  await move(page, "scrubber", "600");
  await expect(strip).toHaveAttribute("data-mode", "history");
  expect((await state(page)).entries).toHaveLength(3);
  await page
    .getByRole("combobox", { name: "Example", exact: true })
    .selectOption({ label: "Reach the history limit" });
  await page
    .getByRole("button", { name: "Run remaining", exact: true })
    .click();
  await expectStripSettled(page);
  await expect(page.getByTestId("history-strip-track")).toHaveAttribute(
    "data-active-slot",
    "32",
  );
  expect((await state(page)).entries).toHaveLength(30);
});

test("footer strip reserves icons for reading, highlights and source devices", async ({
  page,
}, testInfo) => {
  await page.goto("/debug/jump-history");
  const strip = page.getByTestId("history-strip");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  for (const [index, kind] of [
    "scrubber",
    "toc",
    "search",
    "note",
    "chapter",
    "internal-link",
  ].entries()) {
    await move(page, kind, String(100 + index));
    await expect(strip.locator('[aria-current="location"] svg')).toHaveCount(0);
  }
  await move(page, "handoff", "300");
  await expect(
    strip.locator('[aria-current="location"] .lucide-monitor-smartphone'),
  ).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Example", exact: true })
    .selectOption({ label: "Device handoffs" });
  await page
    .getByRole("button", { name: "Run remaining", exact: true })
    .click();
  await expectStripSettled(page);
  await expect(
    strip
      .getByRole("button", {
        name: "Earlier visit: page 140, Device handoff, mobile",
        exact: true,
      })
      .locator(".lucide-smartphone"),
  ).toHaveCount(1);
  await expect(
    strip
      .getByRole("button", {
        name: "Current page 25, Device handoff, desktop",
        exact: true,
      })
      .locator(".lucide-laptop"),
  ).toHaveCount(1);
  await expect(
    strip
      .getByRole("button", {
        name: "Later visit: page 210, Device handoff, tablet",
        exact: true,
      })
      .locator(".lucide-tablet"),
  ).toHaveCount(1);
  await page
    .getByTestId("history-footer-preview")
    .screenshot({ path: testInfo.outputPath("history-strip-devices.png") });
});
