// End-to-end checks of the built page (dist/), served as a static host would.
import { expect, test } from "@playwright/test";
import { site } from "../src/site.ts";

test("install tabs work from the keyboard", async ({ page }) => {
  await page.goto("/");
  const terminal = page.getByRole("tab", { name: "Terminal" });
  const agent = page.getByRole("tab", { name: "Ask your agent" });

  await terminal.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await expect(agent).toHaveAttribute("aria-selected", "true");
  // The agent tab names the agents and copies the prompt without showing it.
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("listitem")).toHaveText([
    "Claude Code",
    "Cursor",
    "Codex",
    "Gemini CLI",
    "OpenCode",
  ]);
  await expect(panel.getByText("med skills install")).toBeHidden();

  await page.keyboard.press("Home");
  await expect(terminal).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").locator("code")).toHaveText(
    site.installCommand,
  );
});

test("copy buttons copy the exact text and announce it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const status = page.getByRole("status");

  await page.getByRole("button", { name: "Copy the install command" }).click();
  await expect(status).toHaveText("Copied the install command.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    site.installCommand,
  );

  // Tab from the selected tab reaches the copy button of the visible panel.
  await page.getByRole("tab", { name: "Ask your agent" }).click();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Copy prompt for your agent" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Copied the prompt for your agent.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    site.agentPrompt,
  );
});

test("every window runs Med on a wide screen, and the page still scrolls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const hero = page.locator(".product .screen");
  await expect(hero).toHaveAttribute("data-state", "live", {
    timeout: 20_000,
  });

  // The demo scrolls only inside its window, so the test scrolls the page.
  const show = () =>
    hero.evaluate((screen) => screen.scrollIntoView({ block: "center" }));
  await show();

  // Over a window, the wheel scrolls the page until the visitor clicks in it.
  const box = (await hero.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const top = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(top);

  // Med lists the review as its thread, and a file opens from its header
  // with its recorded source.
  await show();
  const med = page.frameLocator(".product .live");
  await expect(
    med
      .getByRole("navigation", { name: "Threads" })
      .getByText("Search filters"),
  ).toBeVisible();
  await med
    .getByRole("link", { name: "src/search/query.ts", exact: true })
    .first()
    .click();
  await expect(
    med.getByText("export function parseQuery").first(),
  ).toBeVisible();

  // In view, the hero sends the comment and the agent answers; Replay starts
  // it again from its first moment.
  const edited = () =>
    page
      .frameLocator(".product .live:last-of-type")
      .getByText("I'll list them under the input.");
  await show();
  await expect(edited().first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  // The new scene loads behind the old one until it is ready.
  await expect(page.locator(".product .live[data-next]")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator(".product .live")).toHaveCount(1);
  await expect(edited()).toHaveCount(0);

  // Each feature's window opens on its own scene as it comes near.
  const scenes = {
    brief: "Cites 3 of 6 changed files",
    comment: "Add aria-live",
    session: "is waiting for your review",
    commit: "Commit 6 files",
    notes: "From query to chips",
  };
  for (const [scene, text] of Object.entries(scenes)) {
    const screen = page.locator(`[data-demo$="scene=${scene}"]`);
    await screen.scrollIntoViewIfNeeded();
    await expect(screen).toHaveAttribute("data-state", "live", {
      timeout: 20_000,
    });
    await expect(
      screen.frameLocator(".live").getByText(text).first(),
    ).toBeVisible();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`fits a 375 px phone in ${colorScheme}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      colorScheme,
    });
    const page = await context.newPage();
    await page.goto("/");
    const layout = await page.evaluate(() => {
      const box = document
        .querySelector("main .column")!
        .getBoundingClientRect();
      const review = document.querySelector<HTMLImageElement>(".screen img")!;
      const mark = [...document.querySelectorAll(".brand .mark svg")].find(
        (icon) => getComputedStyle(icon).display !== "none",
      )!;
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        left: box.left,
        right: innerWidth - box.right,
        review: review.currentSrc,
        mark: mark.querySelector("clipPath")!.id,
        // The body has the paper too, so a host page's background stays hidden.
        paper:
          getComputedStyle(document.body).backgroundColor ===
          getComputedStyle(document.documentElement).backgroundColor,
        // Narrow screens show parts of the screenshot, not the live demo.
        demos: document.querySelectorAll(".screen iframe").length,
      };
    });
    expect(layout).toMatchObject({
      overflow: 0,
      left: 16,
      right: 16,
      demos: 0,
      paper: true,
    });
    expect(layout.review).toContain(`review-${colorScheme}-`);
    expect(layout.mark).toContain(
      colorScheme === "dark" ? "icon-night" : "icon-dawn",
    );
    // A feature shows its part as Med lays it out for a phone.
    const comment = page.locator('[data-demo$="scene=comment"] img');
    await comment.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        comment.evaluate((image: HTMLImageElement) => image.currentSrc),
      )
      .toContain(`comment-phone-${colorScheme}-`);
    await context.close();
  });
}

test("a phone shows the part of the review that the visitor picks", async ({
  browser,
}) => {
  // Reduced motion: the window moves at once and only when asked.
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/");
  const parts = page.getByRole("group", { name: "Parts of the review" });
  const review = page.locator(".product .screen img");
  // The image's left edge, from the window's left edge.
  const left = () =>
    review.evaluate(
      (image) =>
        image.getBoundingClientRect().left -
        image.parentElement!.parentElement!.getBoundingClientRect().left,
    );

  await expect(parts.getByRole("button", { name: "Comment" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await left()).toBeLessThan(0);
  // The history is at the screenshot's left edge.
  await parts.getByRole("button", { name: "History" }).click();
  await expect(parts.getByRole("button", { name: "History" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await left()).toBe(0);

  // A swipe to the right goes back one part.
  const box = (await page.locator(".product .screen").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
  await page.mouse.up();
  await expect(
    parts.getByRole("button", { name: "Agent session" }),
  ).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("the docs render Med's guides and link between them", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs$/);
  const docs = page.getByRole("navigation", { name: "Docs", exact: true });
  await expect(docs.getByRole("link", { name: "Install" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Install Med" }),
  ).toBeVisible();

  // A link to another guide's section opens that page at the section.
  await docs.getByRole("link", { name: "Using Med" }).click();
  await page
    .getByRole("main")
    .getByRole("link", { name: "titles and pull requests" })
    .click();
  await expect(page).toHaveURL(/\/docs\/agents#titles-and-pull-requests$/);
  await expect(
    page.getByRole("heading", { level: 3, name: "Titles and pull requests" }),
  ).toBeInViewport();

  // A phone shows the pages as a row, without sideways scrolling.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(docs.getByRole("link", { name: "Agent reviews" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
  await context.close();
});

test("the docs' prototypes run a commit and a comment's trip to the agent", async ({
  page,
}) => {
  await page.goto("/docs/usage");
  const commit = page.getByRole("figure", { name: "Try it: Commit tab" });
  const said = commit.getByRole("status");
  await commit.locator(".try-stage").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Space");
  await expect(said).toHaveText("Staged src/search/query.ts.");
  await page.keyboard.press("c");
  await page.keyboard.type("Show the active filters");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(said).toHaveText("Committed 2 files as 3f2c9a1.");
  // A branch without an upstream asks before its first push.
  await page.keyboard.press("Shift+P");
  await expect(commit.getByText("has no upstream")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(said).toHaveText("Pushed 1 commit to origin/search-filters.");

  await page.goto("/docs/agents");
  const review = page.getByRole("figure", { name: "Try it: Comment and send" });
  await review.getByRole("button", { name: "Line 7" }).click();
  await review
    .getByRole("button", { name: "Line 8" })
    .click({ modifiers: ["Shift"] });
  await page.keyboard.press("c");
  await page.keyboard.press("ControlOrMeta+Enter");
  await review.getByRole("button", { name: /Send to Claude/ }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(review.getByText("Taken")).toBeVisible();
  await expect(review.getByText("to the chip list")).toBeVisible();
  await expect(
    review.getByText('<ul className="chips" aria-live="polite">'),
  ).toBeVisible();
});
