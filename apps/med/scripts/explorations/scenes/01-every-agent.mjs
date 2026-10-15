// Experiment 1: Med finds the Claude Code and Codex sessions in the registered
// repositories by itself. One that works opens as a tab; the others wait in
// history, which ⌃Tab searches.
export const meta = {
  title: "Every agent, wherever it runs",
  summary: "Sessions from Claude Code and Codex show in the thread list without a handoff.",
};

/** Captions sit over the diff while the scene shows the session pane's foot. */
const CAPTION_RIGHT = `#xp-caption { left: 74% !important; max-width: 520px !important; }`;

export default async function scene(stage) {
  const { page } = stage;
  await stage.card(
    "Experiment 1",
    "Every agent, wherever it runs",
    "Your Claude Code and Codex sessions belong in Med, also when no agent hands off its work.",
  );
  await stage.key("Escape", 200);
  // Copy writes the resume command to the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  const sidebar = page.locator("aside").first();
  const glossary = sidebar.locator('[data-found] >> text="README glossary"').first();
  await glossary.waitFor({ timeout: 20_000 });

  await stage.say(
    "Nobody ran <b>med review</b> for this one. Med found it at work in <b>Claude Code</b>'s transcripts and opened it as a tab.",
  );
  await stage.point(glossary, { dx: 0.4 });
  await stage.wait(1800);
  await stage.shot("01-sidebar");

  await stage.say("Open one: its session on the left, its live changes on the right.");
  await stage.click(glossary, { dx: 0.4 });
  const session = page.locator('section[aria-label="Claude session"]').filter({ visible: true });
  await session
    .getByText("Add a short glossary to the README")
    .first()
    .waitFor({ timeout: 20_000 });
  await page
    .locator('[data-review-status="ready"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(1600);
  await stage.shot("01-thread");

  await stage.say("The agent is still at work. The diff and the session follow it.");
  for (let step = 0; step < 4; step++) {
    await stage.world.advance();
    await stage.wait(2000);
  }
  await page
    .getByText("Spring and neap tides", { exact: false })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 10_000 });
  await stage.shot("01-live");

  const right = await page.addStyleTag({ content: CAPTION_RIGHT });
  const bar = page.getByRole("group", { name: "Runs in Claude Code" }).filter({ visible: true });
  await stage.say("It runs in Claude Code. Copy its resume command to go on in a terminal.");
  await stage.point(bar.locator("code"), { dx: 0.3 });
  await stage.wait(900);
  await stage.click(bar.getByRole("button", { name: "Copy Claude Code resume command" }));
  await bar.getByText("Copied").waitFor({ timeout: 5000 });
  await stage.wait(1000);
  await stage.shot("01-resume");

  await stage.say("<b>Keep in Med</b> saves it as a thread, so you can comment and reply.");
  await stage.click(bar.getByRole("button", { name: "Keep in Med" }));
  await page.waitForURL(/\/review\//, { timeout: 20_000 });
  await page
    .getByPlaceholder(/Message Claude/)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await sidebar
    .locator('[data-thread]:not([data-found]) >> text="README glossary"')
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(2200);
  await stage.shot("01-kept");
  await right.evaluate((node) => node.remove());

  // A Codex session that does not work waits in history; ⌃Tab finds it.
  await stage.say("Sessions that do not work wait in history. <b>⌃Tab</b> and a word find them.");
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.press("f");
  await page.keyboard.up("Control");
  await stage.type("eet", 90);
  const feet = page.getByRole("option", {
    name: "Readers in the US want heights in feet, in history",
  });
  await feet.waitFor({ timeout: 10_000 });
  await stage.wait(1600);
  await stage.shot("01-history");
  await stage.key("Escape", 600);
  await stage.clear();
}
