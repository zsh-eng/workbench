// Tabs and history: the threads you have open stay loaded and keep your
// order; their subagents show under them; a closed tab goes to history,
// which ⌃Tab searches.
export const meta = {
  title: "Tabs and history",
  summary: "Open threads are tabs that Med follows; closed ones are cold history, one search away.",
};

export default async function scene(stage) {
  const { page } = stage;
  // The background subagent works now, however long the scenes before took.
  await stage.world.touchSubagents();
  await stage.card(
    "Tabs",
    "Tabs and history",
    "The threads that you have open are tabs: Med keeps them loaded and follows their agents. The others are history: Med does not watch them until you open one again.",
    3800,
  );
  await stage.key("Escape", 200);
  const sidebar = page.locator("aside").first();

  // Activity: a row says what its agent does; its subagents show under it.
  const subagents = sidebar.getByRole("list", { name: /subagents$/ }).first();
  const working = subagents.getByRole("button", { name: /^Check the glossary against the model/ });
  await working.waitFor({ timeout: 20_000 });
  await stage.say(
    "Rows keep your order. A row says what its agent does now, and its <b>subagents</b> show under it.",
  );
  await stage.point(working, { dx: 0.4 });
  await stage.wait(1800);
  await stage.shot("02-tabs");

  // The counts line, when a tab needs you or works.
  const counts = sidebar.getByRole("group", { name: "Tabs at work" });
  if (await counts.isVisible().catch(() => false)) {
    await stage.say("Above the tabs, one line counts what needs you. <b>⌘0</b> goes to the next.");
    await stage.point(counts.getByRole("button").first(), { dx: 0.4 });
    await stage.wait(1600);
    await stage.shot("02-counts");
  }

  // A click on a subagent opens its thread with the subagent's tab.
  await stage.say("Click a subagent to follow it in the Session pane.");
  await stage.click(working, { dx: 0.4 });
  await page
    .getByRole("tab", { name: /Check the glossary against the model/ })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(1800);
  await stage.shot("02-subagent");

  // Close and Undo: the agent keeps working; Med stops watching.
  const model = sidebar.getByRole("button", { name: /^Explain the prediction model/ });
  await stage.say("Done with a thread? <b>×</b> closes its tab. Its agent keeps working.");
  await stage.point(model, { dx: 0.6 });
  const close = sidebar.getByRole("button", { name: "Close Explain the prediction model" });
  await close.waitFor({ timeout: 5000 });
  await stage.wait(500);
  await stage.click(close);
  const undo = sidebar.getByRole("button", { name: "Undo" });
  await undo.waitFor({ timeout: 5000 });
  await stage.wait(1400);
  await stage.shot("02-closed");
  await stage.say("<b>Undo</b>, or <b>⌘⌥T</b>, opens it again at its place.");
  await stage.click(undo);
  await model.waitFor({ timeout: 10_000 });
  await stage.wait(1400);

  // History: closed threads and found sessions, newest first, in ⌃Tab.
  await model.hover();
  await close.click();
  await undo.waitFor({ timeout: 5000 });
  await stage.say("History is a search away: <b>⌃Tab</b>, then a word.");
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.press("m");
  await page.keyboard.up("Control");
  await stage.type("odel", 90);
  const row = page.getByRole("option", { name: "Explain the prediction model, in history" });
  await row.waitFor({ timeout: 10_000 });
  await stage.wait(1800);
  await stage.shot("02-history");
  await stage.say("Return opens it as a tab again.");
  await stage.key("Enter", 400);
  await model.waitFor({ timeout: 10_000 });
  await page
    .locator('[data-review-status="ready"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(1600);
  await stage.shot("02-reopened");
  await stage.clear();
}
