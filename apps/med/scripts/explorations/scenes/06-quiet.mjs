// Experiment 6: quieter chrome, so the code starts higher.
import { measure } from "../chrome-measure.mjs";

export const meta = {
  title: "Quiet chrome",
  summary: "One row for each pane; rare actions in ⋯ and ⌘K; each thing said once.",
};

/** Uses a chrome at once, as another window's choice does. */
const useChrome = (page, mode) =>
  page.evaluate((value) => {
    localStorage.setItem("med:chrome:v1", value);
    dispatchEvent(new StorageEvent("storage", { key: "med:chrome:v1" }));
  }, mode);

export default async function scene(stage) {
  const { page } = stage;
  // The scene starts from the layout before, under its card.
  await useChrome(page, "full");
  await stage.card(
    "Experiment 6",
    "Quieter chrome: the code starts higher",
    "A thread stacked five rows of chrome over its code, and said its title three times. Quiet chrome gives each pane one row and says each thing once.",
    3800,
  );
  await page.keyboard.press("Escape");
  const sidebar = page.locator("aside").first();
  const thread = sidebar.getByText("Daylight saving times", { exact: true }).first();
  await thread.waitFor({ timeout: 20_000 });
  await stage.click(thread);
  await page
    .locator('[data-review-status="ready"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  const changes = page.getByRole("tab", { name: /^Changes/ }).filter({ visible: true });
  if ((await changes.getAttribute("aria-selected").catch(() => null)) !== "true")
    await changes.click();
  await page.waitForTimeout(700);

  const full = await page.evaluate(measure);
  await stage.say(
    `Before: a title band, the session's header, tabs, a toolbar, and a status bar. <b>${full.controls.length} controls</b>, and the code starts <b>${full.firstLine} px</b> down.`,
    3600,
  );
  await stage.shot("06-full");
  const session = page.getByRole("region", { name: "Claude session" });
  await stage.point(session.getByText("Daylight saving times", { exact: true }));
  await stage.say(
    "The title is in the sidebar and again in the session's header. The branch is in the band, and the status bar repeats the file.",
    3400,
  );

  await stage.key("Meta+k");
  await stage.type("quiet");
  await stage.say("One command changes it: <b>Use quiet chrome</b>.", 1400);
  await stage.key("Enter", 900);
  const quiet = await page.evaluate(measure);
  await stage.say(
    `After: one row for each pane. <b>${quiet.controls.length} controls</b>, and the code starts at <b>${quiet.firstLine} px</b>.`,
    3400,
  );
  await stage.shot("06-quiet");

  await stage.point(session.getByRole("button", { name: "Claude session menu" }));
  await stage.say(
    "The session's row starts with its agent and its state. The sidebar names the thread.",
    2800,
  );
  const comparison = page.getByRole("combobox", { name: "Comparison" }).filter({ visible: true });
  await stage.click(comparison);
  await stage.say(
    "One control says what the diff compares. It also compares against a branch or between two revisions.",
    3200,
  );
  await stage.shot("06-comparison");
  await stage.key("Escape", 300);

  await stage.click(page.getByRole("button", { name: "More actions" }).filter({ visible: true }));
  await stage.say(
    "Rare actions go to <b>⋯</b>: the comments, find, the panes, push, and the diff's view under View.",
    1600,
  );
  await stage.point(page.getByRole("menuitem", { name: "View", exact: true }));
  await page.waitForTimeout(1600);
  await stage.shot("06-menu");
  await stage.key("Escape", 150);
  await stage.key("Escape", 300);

  await stage.key("Meta+k");
  await stage.type("compare");
  await stage.say("Each one is also in <b>⌘K</b>, with its shortcut.", 2600);
  await stage.key("Escape", 300);

  await stage.key("Meta+b", 500);
  await stage.say("With the sidebar hidden, the title band names the thread.", 2600);
  await stage.shot("06-band");
  await stage.key("Meta+b", 400);
  await stage.say(
    "<b>Use full chrome</b> brings back the toolbar and the status bar. The choice holds for every window.",
    3000,
  );
  await stage.clear();
}
