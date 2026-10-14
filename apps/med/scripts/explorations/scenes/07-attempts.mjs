// Experiment 7: one task to two agents, each in its own worktree; compare
// their work side by side and keep the better one.
export const meta = {
  title: "Attempts",
  summary: "Ask two agents the same task, compare their work, and keep one.",
};

export default async function scene(stage) {
  const { page } = stage;
  await stage.card(
    "Experiment 7",
    "Attempts: ask twice, keep the best",
    "Two agents seldom solve a task the same way. Give the task to both, each in its own worktree, then compare their work and keep the better one.",
    3800,
  );
  await stage.key("Escape", 200);
  const sidebar = page.locator("aside").first();
  const group = sidebar.locator('[data-attempt-group="week-view"]');
  await group.waitFor({ timeout: 20_000 });

  // New thread: two attempts, each with its agent and branch. The scene does not start them.
  await stage.click(sidebar.getByRole("button", { name: /New thread/ }));
  const dialog = page.getByRole("dialog", { name: "New thread" });
  const task = dialog.getByRole("combobox", { name: "Task" });
  await task.waitFor({ timeout: 10_000 });
  await task.focus();
  await stage.type("Add a --week option to the CLI: seven days of tides for a station.", 28);
  const count = dialog.getByRole("combobox", { name: "Attempts" });
  await stage.say("New thread has one more choice: how many <b>attempts</b>.", 0);
  await stage.point(count);
  await count.selectOption("2");
  const rows = dialog.getByRole("group", { name: "Attempts" });
  const agentB = rows.getByRole("combobox", { name: "Agent for attempt B" });
  await agentB.waitFor({ timeout: 10_000 });
  await stage.point(agentB);
  await agentB.selectOption("codex");
  await rows.getByRole("combobox", { name: "Model for attempt B" }).waitFor({ timeout: 10_000 });
  await stage.say(
    "Each attempt has its agent and model, and Med gives each its own branch and worktree.",
    0,
  );
  await stage.point(rows.locator("code").last(), { dx: 0.3 });
  await stage.wait(1800);
  await stage.shot("07-new-thread");
  await stage.say("Start sends the same task to both. Here, two agents did it earlier.", 1800);
  await stage.key("Escape", 400);

  // The group in the sidebar: one row for the task, its attempts under it.
  await stage.say("In the sidebar, the task is one row. Its attempts fold under it when done.", 0);
  await stage.click(group.getByRole("button", { name: "Show attempts" }));
  await group.getByRole("list").waitFor({ timeout: 5000 });
  await stage.wait(1600);
  await stage.click(group.locator("[data-sidebar-row]").first(), { dx: 0.35 });

  // The Attempts page: a column for each attempt.
  const main = page.getByRole("main", { name: "Attempts" });
  const keepB = main.getByRole("button", { name: "Keep B" });
  await keepB.waitFor({ timeout: 20_000 });
  await main.locator('h3[data-attempt-path="src/cli.ts"]').waitFor({ timeout: 20_000 });
  await stage.say(
    "The Attempts page: a column for each. Claude with Opus took 13 minutes; Codex took 8.",
    0,
  );
  await stage.point(main.locator('[data-attempt="A"]'), { dx: 0.25 });
  await stage.wait(1200);
  await stage.point(main.locator('[data-attempt="B"]'), { dx: 0.25 });
  await stage.wait(1200);
  const checks = main.getByRole("row").filter({ hasText: "Checks" }).getByRole("cell");
  await stage.say(
    "The checks come from each session. Claude's test run failed; Codex fixed its own test, then all 5 passed.",
    0,
  );
  await stage.point(checks.first(), { dx: 0.3 });
  await stage.wait(1400);
  await stage.point(checks.nth(1), { dx: 0.3 });
  await stage.wait(1800);
  await stage.shot("07-compare");

  // The file that both changed, side by side.
  const shared = main.locator('h3[data-attempt-path="src/cli.ts"]');
  await shared.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "smooth" }));
  await stage.wait(900);
  await stage.say(
    "Below, each file that both changed, side by side, both against the same base. Then the files only one changed.",
    0,
  );
  await stage.point(shared, { dx: 0.2 });
  await stage.wait(2600);
  await stage.shot("07-side-by-side");

  // Keep B: ← and → move between the attempts; Keep makes one the thread.
  await stage.say("<kbd>←</kbd> <kbd>→</kbd> move between the attempts.", 0);
  await stage.key("ArrowRight", 700);
  await stage.key("ArrowRight", 900);
  await stage.say(
    "Keep B. Med archives A and removes its worktree, after it commits A's work to its branch.",
    0,
  );
  await stage.click(keepB);
  const toast = page.getByRole("status").filter({ hasText: "Kept B." });
  await toast.waitFor({ timeout: 20_000 });
  // The notice sits where captions do: lift the captions over it for a while.
  const lift = (bottom) =>
    page.evaluate((value) => {
      const caption = document.getElementById("xp-caption");
      if (caption) caption.style.bottom = value;
    }, bottom);
  await lift("96px");
  try {
    await stage.say("B is now the thread. One <b>Undo</b> brings A back, with its worktree.", 0);
    await stage.point(toast.getByRole("button", { name: "Undo" }));
    await stage.wait(2200);
    await stage.shot("07-kept");
  } finally {
    await lift("");
  }
  await group.waitFor({ state: "detached", timeout: 10_000 });
  const kept = sidebar
    .locator("[data-thread]")
    .filter({ hasText: "Show a week of tides in the CLI" });
  await stage.say(
    "In the sidebar, B is an ordinary thread now. A's work stays on its branch, week-view-a.",
    0,
  );
  await stage.point(kept.first(), { dx: 0.4 });
  await stage.wait(2400);
  await stage.clear();
}
