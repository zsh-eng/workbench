// The close: the seven experiments in one list, and how to try them.
export const meta = { title: "Keep, change, or drop", summary: "The summary and how to try it." };

export default async function scene(stage) {
  await stage.page.keyboard.press("Escape");
  await stage.card(
    "med-explorations",
    "Keep, change, or drop",
    "Each experiment has a write-up in apps/med/docs/explorations: the design, the checks, and the open questions.",
    13_000,
    [
      "Every agent: sessions from Claude Code and Codex show by themselves.",
      "Inbox: what needs you comes first, and one key answers it.",
      "Turn blame: each line links to the request that wrote it.",
      "Change map: the shape of a change, and an order to read it.",
      "Land: plan, check, fast-forward, clean up, and Undo.",
      "Quieter chrome: the code starts higher.",
      "Attempts: two agents on one task; keep the better result.",
    ],
  );
  await stage.card(
    "Try it",
    "git switch med-explorations",
    "Then bun run build, and node scripts/explorations/run.mjs --record plays this video on your Mac. Nothing touches your own Med.",
    6_000,
  );
}
