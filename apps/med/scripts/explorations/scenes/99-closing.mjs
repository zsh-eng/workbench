// The close: the experiments that Med keeps, in one list, and how to play this video.
export const meta = { title: "What Med keeps", summary: "The summary and how to try it." };

export default async function scene(stage) {
  await stage.page.keyboard.press("Escape");
  await stage.card(
    "The decision",
    "What Med keeps",
    "Each experiment has a write-up in apps/med/docs/explorations: the design, the checks, and the open questions.",
    11_000,
    [
      "Every agent: sessions from Claude Code and Codex show by themselves.",
      "Thread status: each row says what its agent does now, and whether it asks you.",
      "Quieter chrome: the code starts higher.",
      "Attempts: two agents on one task; keep the better result.",
      "Under the hood: a thread store, and a route table for the Commit tab.",
    ],
  );
  await stage.card(
    "Try it",
    "node scripts/explorations/run.mjs --record",
    "In apps/med, after bun run build, it plays this video on your Mac. Nothing touches your own Med.",
    6_000,
  );
}
