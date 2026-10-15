// The opening: the question, the demo world, and a thread as Med shows it today.
export const meta = { title: "Med, reconsidered", summary: "The question and the demo world." };

export default async function scene(stage) {
  const { page } = stage;
  await stage.card(
    "Med · design explorations",
    "Med, reconsidered",
    "One night of experiments on the branch med-explorations. These are the ones that Med keeps.",
    4200,
  );
  await stage.card(
    "The question",
    "Where you direct agents, understand their work, and ship it",
    "Agents now work in parallel, in worktrees, in Claude Code and Codex. Reading one diff is no longer the hard part.",
    7000,
    [
      "Where do my agents work?",
      "What needs me now?",
      "Can the code have more of the window?",
      "Which of two tries is better?",
    ],
  );
  const sidebar = page.locator("aside").first();
  await sidebar.getByText("Forgiving station search").first().waitFor({ timeout: 20_000 });
  await stage.say(
    "The demo world: one repository, <b>tide</b>, with agents at work in four worktrees, in Claude Code and Codex.",
    3200,
  );
  await stage.shot("00-threads");
  await stage.click(sidebar.getByText("Forgiving station search").first());
  await page
    .locator('[data-review-status="ready"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(1000);
  await stage.say(
    "A thread: the agent's session beside its diff. Each experiment starts here.",
    2800,
  );
  await stage.shot("00-thread");
  await stage.clear();
}
