// Med as it is on main (v0.4.2): the thread list, a thread, its session and diff.
export const meta = { title: "Med today", summary: "The starting point for the experiments." };

export default async function scene(stage) {
  const { page } = stage;
  await stage.card(
    "Med · design explorations",
    "Eight experiments, one night",
    "What would make Med the place where you direct agents, understand their work, and ship it?",
    3600,
  );
  const sidebar = page.locator("aside").first();
  await sidebar.getByText("Forgiving station search").first().waitFor({ timeout: 20_000 });
  await stage.say(
    "This is Med 0.4.2 on main. Threads list on the left: each is an agent's task, its checkout, and its changes.",
    400,
  );
  await stage.shot("00-threads");
  await stage.click(sidebar.getByText("Forgiving station search").first());
  await page
    .locator('[data-review-status="ready"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await stage.wait(1200);
  await stage.say("A thread shows the agent's session beside its diff.", 2400);
  await stage.shot("00-thread");
  await stage.clear();
}
