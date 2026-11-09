import type { BrowserContext, Page } from "playwright";
import { routeApi } from "./markdown-cards";

/**
 * agent-kit `--before` on the dev server: a Mermaid card and a card with
 * maths and code, for screenshots of Review and the card form. Review
 * orders new cards by a hash of their random IDs, so SPACED_KIT_CARD=0 or 1
 * seeds only that card.
 *
 *   SPACED_KIT_CARD=0 bun run kit shot / --before tests/kit/diagram-cards.ts [--dark] [--desktop]
 */
export const DIAGRAM_CARDS = [
  {
    front: [
      "What happens to a card after you grade it **Again**?",
      "",
      "```mermaid",
      "flowchart LR",
      "  New --> Learning",
      "  Learning -->|Good| Review",
      "  Review -->|Again| Relearning",
      "  Relearning -->|Good| Review",
      "```",
    ].join("\n"),
    back: [
      "It goes to **Relearning**, then back to **Review** after a Good.",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  participant U as You",
      "  participant S as Scheduler",
      "  U->>S: Again",
      "  S-->>U: due in 10 minutes",
      "  U->>S: Good",
      "  S-->>U: due in 2 days",
      "```",
    ].join("\n"),
  },
  {
    front: "Solve $ax^2 + bx + c = 0$ for $x$.",
    back: [
      "$$",
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "$$",
      "",
      "```python",
      "def roots(a, b, c):",
      "    d = (b * b - 4 * a * c) ** 0.5",
      "    return (-b + d) / (2 * a), (-b - d) / (2 * a)",
      "```",
    ].join("\n"),
  },
];

export default async function seed({
  page,
  context,
  baseURL,
}: {
  page: Page;
  context: BrowserContext;
  baseURL: string;
}) {
  await routeApi(context);
  await page.goto(`${baseURL}/profile`);
  await page.evaluate(async (cards) => {
    const { createNewCard } = await import(
      // @ts-expect-error A dev server path, not a module of this program.
      "/src/lib/sync/operation.ts"
    );
    for (const card of cards) {
      await createNewCard(card.front, card.back);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, process.env.SPACED_KIT_CARD ? [DIAGRAM_CARDS[Number(process.env.SPACED_KIT_CARD)]] : DIAGRAM_CARDS);
}
