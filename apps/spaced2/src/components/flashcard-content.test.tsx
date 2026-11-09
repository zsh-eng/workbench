import { expect, test } from "bun:test";
import { render, until } from "../../tests/dom";
import FlashcardContent from "./flashcard-content";

// The card goes through the real Markdown worker. Diagrams need layout, so
// tests/browser/card-markdown.browser.ts draws them in Chromium.
test("existing cards render as before: maths, tables, code, images, links and cloze text", async () => {
  const front = [
    "Solve $ax^2 + bx + c = 0$ for $x$.",
    "",
    "$$",
    "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    "$$",
    "",
    "```math",
    "\\int_0^1 x\\,dx",
    "```",
    "",
    "| Level | Phantom |",
    "|---|---|",
    "| Serializable | no |",
    "",
    "```python",
    "def square(n):",
    "    return n * n",
    "```",
    "",
    "```",
    "plain <b>text</b>",
    "```",
    "",
    "![Heart](https://api.zsheng.app/api/apps/spaced/files/xxh64:0123456789abcdef) ![Plot](https://images.zsheng.app/plot.png)",
    "",
    "The [...] is a cloze, see [the notes](https://example.com/notes). <script>alert(1)</script> [run](javascript:alert(1))",
  ].join("\n");
  const view = await render(<FlashcardContent content={front} />);
  try {
    const card = view.container.querySelector("article")!;
    await until(() => card.querySelector(".katex-display") !== null);
    // Inline, a $$ block and a math fence.
    expect(card.querySelectorAll(".katex").length).toBe(4);
    expect(card.querySelectorAll(".katex-display").length).toBe(2);

    // A wide table scrolls inside the card.
    expect(card.querySelector(".card-table > table")).not.toBeNull();

    // Code has both themes' colors; a block without a language stays text.
    const [python, plain] = [...card.querySelectorAll("pre > code")];
    expect(python.classList.contains("card-code")).toBe(true);
    expect(python.textContent).toBe("def square(n):\n    return n * n");
    expect(python.querySelector("span")!.getAttribute("style")).toMatch(
      /--hls-light:#[0-9a-f]+;?.*--hls-dark:|--hls-dark:#[0-9a-f]+;?.*--hls-light:/,
    );
    expect(plain.querySelector("b")).toBeNull();
    expect(plain.textContent).toBe("plain <b>text</b>\n");

    // Images wait for the local image cache.
    const images = [...card.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      null,
      null,
    ]);
    expect(images.map((image) => image.dataset.cacheSrc)).toEqual([
      "https://api.zsheng.app/api/apps/spaced/files/xxh64:0123456789abcdef",
      "https://images.zsheng.app/plot.png",
    ]);

    // Web links open beside the app; other schemes and raw HTML stay inert.
    const [link, script] = [...card.querySelectorAll("a")];
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(script.textContent).toBe("run");
    expect(script.hasAttribute("href")).toBe(false);
    expect(card.querySelector("script")).toBeNull();
    expect(card.textContent).toContain("The [...] is a cloze");
  } finally {
    await view.unmount();
  }
});

test("single-dollar inline maths and a one-line $$ render as KaTeX", async () => {
  // 96 active cards use $…$ inline; Spaced keeps remark-math's default.
  const view = await render(
    <FlashcardContent content={"Let $x_1$ be the first term of $$\\sum_i x_i$$."} />,
  );
  try {
    const card = view.container.querySelector("article")!;
    await until(() => card.querySelectorAll(".katex").length === 2);
    const [single, double] = [...card.querySelectorAll(".katex annotation")];
    expect(single!.textContent).toBe("x_1");
    expect(double!.textContent).toBe("\\sum_i x_i");
    expect(card.textContent).not.toContain("$");
  } finally {
    await view.unmount();
  }
});

test("a dollar amount without a closing dollar stays text", async () => {
  const view = await render(
    <FlashcardContent content={"The ticket costs $5, and **$$** is text."} />,
  );
  try {
    const card = view.container.querySelector("article")!;
    await until(() => card.textContent!.includes("ticket"));
    expect(card.querySelector(".katex")).toBeNull();
    expect(card.textContent).toContain("costs $5");
  } finally {
    await view.unmount();
  }
});
