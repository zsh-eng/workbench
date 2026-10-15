// The architecture review, as three cards: what it measured, five moves, and
// what to remove. Numbers are from docs/explorations/architecture.md.
export const meta = {
  title: "Under the hood",
  summary: "The architecture and performance review.",
};

export default async function scene(stage) {
  await stage.page.keyboard.press("Escape");
  await stage.card(
    "Under the hood",
    "Fast where it was tuned. The structure does not scale.",
    "A review measured Med on the demo world, with a production build.",
    11_000,
    [
      "The thread list shows 165 ms after a cold load. ⌘1–⌘9 shows a thread in about 30 ms.",
      "App.tsx is one component of 5,553 lines with 256 hooks. The host is one if chain of 1,712 lines.",
      "Each thread in view costs about 2.9 MiB, 2,350 nodes, and a worker. There is no budget.",
      "Saved reviews stop at 128, and none can be deleted. Your Med has 46 now.",
    ],
  );
  await stage.card(
    "Under the hood",
    "Five small moves, each measured",
    "No rewrite. Two of the moves are proofs of concept on this branch.",
    12_000,
    [
      "A window store with selectors. One agent step rendered 10,176 components; now 390.",
      "A thread index apart from review captures, with Delete.",
      "A command registry, which also writes the shortcut guide.",
      "Feature controllers that empty App.tsx.",
      "A route table with shared contracts. The Commit tab uses it now.",
    ],
  );
  await stage.card(
    "Under the hood",
    "What I would remove",
    "Each item has evidence in the review.",
    9_000,
    [
      "Two of the three live transports. Keep the WebSocket.",
      "The window lock that the WebSocket made unnecessary.",
      "Twenty response schemas that repeat the shared ones.",
      "The Elements gallery from the product bundle: 143 KB.",
      "Seventeen exports that nothing uses.",
    ],
  );
}
