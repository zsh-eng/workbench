import type { BrowserContext, Page } from "playwright";

/**
 * agent-kit `--before` for the card Markdown timings: 160 due cards shaped
 * like the user's own (short answers, lists, KaTeX maths, code, tables,
 * images from Spaced's file store and images.zsheng.app, Anki-style cloze
 * siblings and long lists), written into the app's IndexedDB. It works on
 * a production build: it writes the stored rows, not through app code. The
 * API answers "signed out", and image URLs answer with a small SVG.
 *
 *   bun run kit time / --before tests/kit/markdown-cards.ts \
 *     --steps tests/kit/review-first-card.ts --throttle 4
 */
export function cardSet(count = 160) {
  const cards: { front: string; back: string }[] = [];
  for (let n = 0; n < count; n++) {
    const kind = n % 8;
    const tag = `#${n}`;
    if (kind === 0)
      cards.push({
        front: `What does the TCP three-way handshake establish? ${tag}`,
        back: "Both sides' initial sequence numbers, and that each can send and receive.",
      });
    else if (kind === 1)
      cards.push({
        front: `What are the **two** main jobs of the *mitochondria*? ${tag}`,
        back: [
          "1. Make ATP by oxidative phosphorylation",
          "2. Start apoptosis when the cell is damaged",
          "",
          "> Most of the cell's ATP comes from here.",
        ].join("\n"),
      });
    else if (kind === 2)
      cards.push({
        front: `Solve $ax^2 + bx + c = 0$ for $x$, where $a \\neq 0$. ${tag}`,
        back: [
          "$$",
          "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
          "$$",
          "",
          "The discriminant $\\Delta = b^2 - 4ac$ gives the number of real roots: $\\Delta > 0$ two, $\\Delta = 0$ one.",
        ].join("\n"),
      });
    else if (kind === 3)
      cards.push({
        front: [
          `What does this print? ${tag}`,
          "",
          "```python",
          "def memo(f):",
          "    cache = {}",
          "    def inner(n):",
          "        if n not in cache:",
          "            cache[n] = f(n)",
          "        return cache[n]",
          "    return inner",
          "",
          "@memo",
          "def fib(n):",
          "    return n if n < 2 else fib(n - 1) + fib(n - 2)",
          "",
          "print(fib(30))",
          "```",
        ].join("\n"),
        back: "`832040`, in linear time: each `fib(n)` is computed once.",
      });
    else if (kind === 4)
      cards.push({
        front: `Compare the isolation levels by the anomalies they allow. ${tag}`,
        back: [
          "| Level | Dirty read | Non-repeatable read | Phantom |",
          "|---|---|---|---|",
          "| Read uncommitted | yes | yes | yes |",
          "| Read committed | no | yes | yes |",
          "| Repeatable read | no | no | yes |",
          "| Serializable | no | no | no |",
          "",
          "```sql",
          "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;",
          "SELECT balance FROM accounts WHERE id = 7 FOR UPDATE;",
          "```",
        ].join("\n"),
      });
    else if (kind === 5)
      cards.push({
        front: `Which structure is labelled A? ${tag}\n\n![Heart, anterior view](https://api.zsheng.app/api/apps/spaced/files/xxh64:${(0x1000 + n).toString(16).padStart(16, "0")})`,
        back: `The **left ventricle**.\n\n![Labelled heart](https://images.zsheng.app/cards/heart-${n}.png)`,
      });
    else if (kind === 6)
      cards.push({
        front: `The [...] is the powerhouse of the cell, and makes ATP. ${tag}`,
        back: `The **mitochondrion** is the powerhouse of the cell, and makes ATP. ${tag}`,
      });
    else
      cards.push({
        front: `Name the twelve cranial nerves in order. ${tag}`,
        back: [
          "Olfactory",
          "Optic",
          "Oculomotor",
          "Trochlear",
          "Trigeminal",
          "Abducens",
          "Facial",
          "Vestibulocochlear",
          "Glossopharyngeal",
          "Vagus",
          "Accessory",
          "Hypoglossal",
        ]
          .map((name, index) => `${index + 1}. ${name}`)
          .join("\n"),
      });
  }
  return cards;
}

const IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" rx="16" fill="#ecfeff"/><circle cx="240" cy="150" r="90" fill="#a5f3fc" stroke="#0e7490" stroke-width="4"/></svg>`;

/** Signed out, with every image answering. */
export async function routeApi(context: BrowserContext) {
  const answer: Parameters<BrowserContext["route"]>[1] = (route) => {
    const url = route.request().url();
    if (/\/files\/|images\.zsheng\.app/.test(url))
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: IMAGE,
      });
    return route.fulfill({ status: 401, json: {} });
  };
  await context.route("https://api.zsheng.app/**", answer);
  await context.route("https://images.zsheng.app/**", answer);
  await context.route("**/api/**", answer);
}

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
  // The app makes its database; then the cards go in beside it.
  await page.goto(`${baseURL}/profile`);
  await page.waitForFunction(async () =>
    (await indexedDB.databases()).some((db) =>
      db.name?.startsWith("SpacedRecordsV3"),
    ),
  );
  await page.evaluate(async (cards) => {
    const name = (await indexedDB.databases()).find((db) =>
      db.name?.startsWith("SpacedRecordsV3"),
    )!.name!;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db
      .transaction("operations", "readwrite")
      .objectStore("operations");
    const now = Date.now();
    cards.forEach((card, index) => {
      // Fixed IDs: Review orders new cards by a hash of the ID, so every
      // build shows the same cards in the same order.
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      // Due in queue order, an hour ago and earlier.
      const due = new Date(now - 3_600_000 - (cards.length - index) * 1000);
      const timestamp = now - 7_200_000;
      store.put({
        type: "card",
        payload: {
          id,
          createdAt: timestamp,
          due,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          state: "New",
          last_review: null,
        },
        timestamp,
        id: JSON.stringify(["card", id]),
        isDeleted: false,
      });
      store.put({
        type: "cardContent",
        payload: { cardId: id, front: card.front, back: card.back },
        timestamp,
        id: JSON.stringify(["cardContent", id]),
        isDeleted: false,
      });
    });
    await new Promise((resolve, reject) => {
      store.transaction.oncomplete = resolve;
      store.transaction.onerror = () => reject(store.transaction.error);
    });
    db.close();
  }, cardSet());
}
