import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AGENT_CAPABILITIES } from "../../src/shared/owned-session";
import {
  firstCommit,
  mount,
  mountApp,
  NO_ANSWER,
  prepareWindow,
  root,
  unmountApp,
} from "./app-fixture";

beforeEach(prepareWindow);
afterEach(unmountApp);

describe("agent session", () => {
  test("a saved review shows its agent's session beside the review and opens files from it", async () => {
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Rename the export in /test/repo/src/beta.ts:2." },
        },
      },
      {
        at: 1000,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Run the tests",
          kind: "execute",
          status: "completed",
          rawInput: { command: "bun test" },
        },
      },
      {
        at: 2000,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Renamed in [alpha.ts:1](src/alpha.ts:1) and `/test/repo/src/beta.ts:1-2`; `src/gone.ts:3` and `bun test` are not files.",
          },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await expect.element(panel.getByText(/Rename the export in/)).toBeVisible();
    // The finished turn's work folds into one row, which opens it in place.
    // The pane has no menu or status of its own: the title band names the thread.
    const worked = panel.getByRole("button", { name: "Worked for 2s · 1 tool call" });
    await expect.element(worked).toBeVisible();
    expect(panel.getByRole("button", { name: /Run the tests/ }).query()).toBeNull();
    await worked.click();
    await expect.element(panel.getByRole("button", { name: /Run the tests/ })).toBeVisible();
    expect(panel.getByRole("button", { name: /session menu|sessions$/ }).query()).toBeNull();
    expect(panel.getByText("Idle", { exact: true }).query()).toBeNull();

    // Each reference to a file of the checkout is a link with the file's name
    // and lines: a Markdown link, inline code, an absolute path, and a path in
    // the prompt. Text that names no file stays as it is.
    const alpha = panel.getByRole("link", { name: "Open src/alpha.ts at L1" });
    await expect.element(alpha).toHaveTextContent("alpha.tsL1");
    const beta = panel.getByRole("link", { name: "Open src/beta.ts at L1–2" });
    await expect.element(beta).toHaveTextContent("beta.tsL1–2");
    await expect.element(beta).toHaveAttribute("data-tooltip", "src/beta.ts:1–2");
    const prompted = panel.getByRole("button", { name: "Open src/beta.ts at L2" });
    await expect.element(prompted).toHaveTextContent("beta.tsL2");
    await expect.element(panel.getByText("src/gone.ts:3", { exact: true })).toBeVisible();
    expect(panel.getByRole("link", { name: /gone|bun test/ }).query()).toBeNull();

    // A range opens its file at its first line with the range marked; a
    // second link to the open file goes to its own line.
    await beta.click();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    const editor = page.getByRole("region", { name: "File editor" });
    const cited = () =>
      [...editor.element().querySelectorAll(".med-cited-line")].map((line) => line.textContent);
    await expect
      .poll(cited)
      .toEqual(['export const workspace = "/test/repo";', "export const workingContents = true;"]);
    await prompted.click();
    await expect.poll(cited).toEqual(["export const workingContents = true;"]);
    await alpha.click();
    await expect.element(page.getByRole("tab", { name: "alpha.ts", exact: true })).toBeVisible();
    await expect.poll(() => editor.element().querySelectorAll(".med-cited-line").length).toBe(1);
    // A link's tab is a tab like any other: closing it shows the one before.
    await page.getByRole("button", { name: "Close src/alpha.ts" }).click();
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Close src/beta.ts" }).click();
    await expect
      .element(page.getByRole("radio", { name: "Review", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    // Hiding the pane (⌘K) leaves the agent at work; the review's Restore shows it again.
    await userEvent.keyboard("{Control>}k{/Control}");
    await page.getByRole("combobox", { name: "Search commands" }).fill("Hide agent session");
    await page.getByRole("option", { name: /^Hide agent session/ }).click();
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show agent session" }).click();
    await expect.element(panel).toBeVisible();
  });

  test("a saved review prepares its session out of view, so the pane opens with its thread", async () => {
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Rename the export." },
        },
      },
      {
        at: 2000,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Renamed **alpha** in `src/alpha.ts`.",
          },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    const panel = page.getByRole("region", { name: "Agent session" });
    // Once the review is idle, the thread streams and renders in a hidden pane.
    await expect
      .poll(() => document.querySelector('[aria-label="Session"]')?.textContent ?? "")
      .toContain("Rename the export.");
    await expect.element(panel).not.toBeInTheDocument();
    await expect
      .poll(() => document.querySelector('[aria-label="Session"] [data-unit] strong')?.textContent)
      .toBe("alpha");

    await page.getByRole("button", { name: "Show agent session" }).click();
    expect(panel.getByText("Rename the export.").element()).toBeVisible();
    expect(panel.getByText("alpha", { exact: true }).element()).toBeVisible();
  });

  test("a long session loads its earlier work, and { and } step through its prompts", async () => {
    const chunk = (at: number, kind: string, text: string) => ({
      at,
      update: { sessionUpdate: kind, content: { type: "text", text } },
    });
    // The tail starts after the build call; its result is in the tail.
    const tail = [
      {
        at: 5000,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "early",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "built" } }],
        },
      },
      chunk(6000, "user_message_chunk", "Second prompt"),
      chunk(7000, "agent_message_chunk", "Both builds pass."),
    ];
    const earlier = [
      chunk(0, "user_message_chunk", "First prompt"),
      {
        at: 1000,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "early",
          title: "Build the app",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "bun run build" },
        },
      },
    ];
    const { pageReads } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: tail, idle: true, modifiedAt: 0, truncated: true, start: 4096 })}\n\n`,
      sessionPages: {
        page: { events: earlier, start: 0 },
        turns: [
          { offset: 0, at: 0, text: "First prompt" },
          { offset: 4200, at: 6000, text: "Second prompt" },
        ],
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    // A short thread reaches its top at once, so the earlier page loads.
    await expect.element(panel.getByText("First prompt")).toBeVisible();
    expect(pageReads).toEqual(["4096"]);
    // The result that came first now completes its call: one row, with its
    // title, in the first turn's folded work.
    await panel.getByRole("button", { name: /^Worked for/ }).click();
    const build = panel.getByRole("button", { name: /Build the app/ });
    await expect.element(build).toBeVisible();
    expect(document.querySelectorAll('[aria-label="Session"] [data-unit="early"]')).toHaveLength(1);
    await expect
      .element(panel.getByRole("button", { name: "Load earlier work" }))
      .not.toBeInTheDocument();

    await expect
      .element(panel.getByText("The session is long", { exact: false }))
      .not.toBeInTheDocument();

    // The thread has no list of its prompts: { and } step through them, as
    // [ and ] through every message.
    await expect
      .element(panel.getByRole("navigation", { name: "Prompts" }))
      .not.toBeInTheDocument();
    const current = () =>
      document.querySelector<HTMLElement>('[data-message="user"][data-current]')?.textContent;
    panel.element().querySelector<HTMLElement>("[data-message-keys]")!.focus();
    await userEvent.keyboard("{{");
    await expect.poll(current).toContain("Second prompt");
    await userEvent.keyboard("{{");
    await expect.poll(current).toContain("First prompt");
    await userEvent.keyboard("}");
    await expect.poll(current).toContain("Second prompt");
  });

  test("a thread whose agent counts no tokens shows no spend, not $0.00", async () => {
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      usage: {
        spend: {
          total: 0,
          subagents: { count: 0, cost: 0 },
          models: [],
          missing: ["Antigravity"],
        },
        prices: {
          version: 1,
          source: "https://platform.claude.com/docs/en/about-claude/pricing",
          readAt: "2026-10-29",
        },
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await expect.element(panel.getByRole("form", { name: "Message Claude" })).toBeVisible();
    await expect.element(panel.getByText("$0.00")).not.toBeInTheDocument();
    await expect.element(panel.getByRole("region", { name: "Spend" })).not.toBeInTheDocument();
  });

  test("the header shows the thread's context and spend, and a click shows where they come from", async () => {
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      usage: {
        context: {
          sessionId: "s1",
          agent: "claude",
          model: "claude-opus-5-5",
          used: 312_932,
          window: 1_000_000,
          windowFrom: "model",
          compaction: {
            at: 500_000,
            from: "modelSettings in ~/.claude/settings.json",
            approximate: false,
          },
          compacted: false,
        },
        spend: {
          total: 230.62,
          subagents: { count: 4, cost: 40.44 },
          models: [
            {
              model: "claude-opus-5-5",
              requests: 812,
              input: 41_000,
              output: 690_000,
              cacheWrite5m: 0,
              cacheWrite1h: 3_100_000,
              cacheRead: 410_000_000,
              webSearches: 0,
              cost: 230.62,
            },
            {
              model: "gpt-test",
              requests: 1,
              input: 1000,
              output: 300,
              cacheWrite5m: 0,
              cacheWrite1h: 0,
              cacheRead: 4000,
              webSearches: 0,
              cost: null,
            },
          ],
          missing: [],
        },
        prices: {
          version: 1,
          source: "https://platform.claude.com/docs/en/about-claude/pricing",
          readAt: "2026-10-29",
          openai: {
            source: "https://developers.openai.com/api/docs/pricing",
            readAt: "2026-10-29",
          },
        },
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    // The chip is in the message box's bar, before Send, as in Claude
    // Desktop; its name says its figures.
    const chip = panel.getByRole("button", { name: "Context 31% full, $230.62 spent" });
    await expect.element(chip).toMatchTextContent("$230.62");
    const form = panel.getByRole("form", { name: "Message Claude" }).element();
    expect(form.contains(chip.element())).toBe(true);
    const send = panel.getByRole("button", { name: "Send", exact: true }).element();
    expect(chip.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      send.getBoundingClientRect().left,
    );
    expect(
      document.querySelector('[aria-label="Workspace"]')?.contains(chip.element()) ?? false,
    ).toBe(false);

    // Its popover is the gist: one bar and a line, then each model's cost.
    await userEvent.click(chip);
    const context = page.getByRole("region", { name: "Context" });
    await expect
      .element(context.getByRole("meter", { name: "Context in use" }))
      .toHaveAttribute("aria-valuenow", "312932");
    await expect.element(context).toMatchTextContent("31% · 313k of 1M");
    await expect
      .element(context.getByText("Compacts at 500k"))
      .toHaveAttribute("title", "modelSettings in ~/.claude/settings.json");
    const spend = page.getByRole("region", { name: "Spend" });
    await expect.element(spend.getByText("$40.44 by 4 subagents")).toBeVisible();
    await expect.element(spend.getByText("Opus 5.5", { exact: true })).toBeVisible();
    expect(spend.getByRole("table").query()).toBeNull();
    // A model without a price says so, and the total leaves it out.
    await expect.element(spend.getByText("No price", { exact: true })).toBeVisible();
    await expect.element(spend.getByText("No price for gpt-test: not in the total.")).toBeVisible();
    // The note is one line: the date of the prices, and their sources.
    await expect
      .element(spend.getByText("List prices of 2026-10-29: Anthropic, OpenAI."))
      .toBeVisible();
    await expect
      .element(spend.getByRole("link", { name: "Anthropic" }))
      .toHaveAttribute("href", "https://platform.claude.com/docs/en/about-claude/pricing");
    await expect
      .element(spend.getByRole("link", { name: "OpenAI" }))
      .toHaveAttribute("href", "https://developers.openai.com/api/docs/pricing");
  });

  test("a wide session pane shows the session rail, which the reader closes and opens again", async () => {
    // Room for the session rail, with the thread's column under its widest.
    await page.viewport(2200, 900);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [],
        conversation: [],
        reviews: [],
      },
      usage: {
        context: {
          sessionId: "s1",
          agent: "claude",
          model: "claude-opus-5-5",
          used: 312_932,
          window: 1_000_000,
          windowFrom: "model",
          compaction: {
            at: 500_000,
            from: "modelSettings in ~/.claude/settings.json",
            approximate: false,
          },
          compacted: false,
        },
        spend: {
          total: 230.62,
          subagents: { count: 4, cost: 40.44 },
          models: [
            {
              model: "claude-opus-5-5",
              requests: 812,
              input: 41_000,
              output: 690_000,
              cacheWrite5m: 0,
              cacheWrite1h: 3_100_000,
              cacheRead: 410_000_000,
              webSearches: 0,
              cost: 230.62,
            },
            {
              model: "gpt-test",
              requests: 1,
              input: 1000,
              output: 300,
              cacheWrite5m: 0,
              cacheWrite1h: 0,
              cacheRead: 4000,
              webSearches: 0,
              cost: null,
            },
          ],
          missing: [],
        },
        prices: {
          version: 1,
          source: "https://platform.claude.com/docs/en/about-claude/pricing",
          readAt: "2026-10-29",
        },
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const pane = page.getByRole("region", { name: "Agent session" });
    const side = pane.getByRole("complementary", { name: "Session rail" });
    await expect.element(side).toBeVisible();
    // Beside the panel, the thread's column takes the room that is left: the
    // message box is that room less its 12 pixel sides, and once it is over
    // the thread, less the thread's 12 pixel scroll bar, which it leaves in
    // view.
    const box = () =>
      pane.getByRole("form", { name: "Message Claude" }).element().getBoundingClientRect().width;
    const room = () =>
      pane.element().getBoundingClientRect().width - side.element().getBoundingClientRect().width;
    await expect
      .poll(() => [24, 36].some((less) => Math.abs(room() - less - box()) < 0.5))
      .toBe(true);
    const context = side.getByRole("region", { name: "Context" });
    // Context starts folded, with its share; its title unfolds it in place.
    await expect.element(context).toMatchTextContent(/^Context31%$/);
    await context.getByRole("button", { name: "Context" }).click();
    await expect.element(context).toMatchTextContent(/^Context31% used312\.9k \/ 1M/);
    await expect.element(context.getByText("Autocompact at 500k")).toBeVisible();
    await context.getByRole("button", { name: "Context" }).click();
    // Spend starts folded, with its total; its title unfolds it in place.
    const spend = side.getByRole("region", { name: "Spend" });
    await expect.element(spend).toMatchTextContent(/^Spend\$230\.62$/);
    await spend.getByRole("button", { name: "Spend" }).click();
    await expect.element(spend.getByText("$40.44 by 4 subagents")).toBeVisible();
    await expect.element(spend.getByText("Opus 5.5")).toBeVisible();
    await expect.element(spend.getByText("41k in · 690k out", { exact: false })).toBeVisible();
    await spend.getByRole("button", { name: "Spend" }).click();
    await expect.element(spend.getByText("Opus 5.5")).not.toBeInTheDocument();
    // The pull request has its own section; its row opens its page in Med,
    // which links to GitHub.
    const pulls = side.getByRole("region", { name: "Pull requests" });
    await pulls.getByRole("button", { name: /^Read pull request threads/ }).click();
    await expect
      .element(page.getByRole("radio", { name: "Pull request" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(side.getByRole("region", { name: "Agent" })).toMatchTextContent(/Claude/);
    // The rail says context and spend, so no chip under the message box
    // says them again.
    await expect
      .element(pane.getByRole("button", { name: /^Context \d+% full/ }))
      .not.toBeInTheDocument();

    await pane.getByRole("button", { name: "Hide session rail" }).click();
    await expect.element(side).not.toBeInTheDocument();
    expect(localStorage.getItem("med:session-panel")).toBe("closed");
    await expect.element(pane.getByRole("button", { name: /^Context \d+% full/ })).toBeVisible();
    // Without it, the column is Claude Desktop's 768 pixels of text and the
    // thread's 22 pixel sides.
    await expect.poll(box).toBeCloseTo(768 + 44 - 24, 0);
    await userEvent.keyboard("{Control>}{Alt>}{Shift>}b{/Shift}{/Alt}{/Control}");
    await expect.element(side).toBeVisible();
    expect(localStorage.getItem("med:session-panel")).toBe("auto");

    // A pane without room for the column and the panel has neither the panel nor its button.
    await page.viewport(1100, 900);
    await expect.element(side).not.toBeInTheDocument();
    await expect
      .element(pane.getByRole("button", { name: /session rail/ }))
      .not.toBeInTheDocument();
  });

  test("the session rail's toggle keeps the thread's place", async () => {
    // A pane just wide enough for the rail, which narrows the thread's column.
    await page.viewport(1800, 900);
    // Replies of many paragraphs, taller than the view, so a new width
    // rewraps the text above the reader's place.
    const reply = (turn: number) =>
      Array.from(
        { length: 24 },
        (_, at) =>
          `Paragraph ${turn}.${at}. ${"The view keeps its place as the column narrows and widens again. ".repeat(1 + (at % 5))}`,
      ).join("\n\n");
    const events = Array.from({ length: 12 }, (_, turn) => [
      {
        at: turn * 1000,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: `Prompt ${turn}` },
        },
      },
      {
        at: turn * 1000 + 500,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: `r${turn}`,
          content: {
            type: "text",
            text: reply(turn),
          },
        },
      },
    ]).flat();
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const pane = page.getByRole("region", { name: "Agent session" });
    await expect.element(pane.getByRole("complementary", { name: "Session rail" })).toBeVisible();
    await expect
      .poll(() => {
        const node = pane.element().querySelector<HTMLElement>(".med-thread-scroller");
        return !!node && node.scrollHeight > 4 * node.clientHeight;
      })
      .toBe(true);
    const scroller = pane.element().querySelector<HTMLElement>(".med-thread-scroller")!;
    const frames = async (count: number) => {
      for (let at = 0; at < count; at++) await new Promise(requestAnimationFrame);
    };
    await frames(20);
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    scroller.scrollTop = scroller.scrollHeight / 2;
    // The view goes 900 pixels into a reply, so the reply's text above it
    // rewraps, and settles there: the replies in view show their Markdown.
    // The units at the middle render as soon as the machine gets to them.
    const reply6 = await vi.waitUntil(
      () => scroller.querySelector<HTMLElement>('[data-unit="r6"]'),
      { timeout: 5000 },
    );
    scroller.scrollTop +=
      reply6.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 900;
    const settled = async () => {
      await expect
        .poll(() => scroller.querySelector("[data-unit] .med-session-plain"), { timeout: 5000 })
        .toBeNull();
      await frames(20);
    };
    await settled();
    // The text on the view's top line: its reply, and where in the reply's
    // text the line starts. A new width rewraps the lines, so the place moves
    // by a line or so; the bug moved it paragraphs away.
    const place = () => {
      const box = scroller.getBoundingClientRect();
      const paragraphs = [...scroller.querySelectorAll<HTMLElement>("[data-unit] p")];
      const at = paragraphs.find(
        (element) => element.getBoundingClientRect().bottom > box.top + 4,
      )!;
      const text = at.getBoundingClientRect();
      const caret = document.caretRangeFromPoint(text.left + 2, Math.max(box.top, text.top) + 4)!;
      const range = document.createRange();
      range.setStart(at, 0);
      range.setEnd(caret.startContainer, caret.startOffset);
      const unit = at.closest<HTMLElement>("[data-unit]")!;
      const earlier = [...unit.querySelectorAll<HTMLElement>("p")];
      const start = earlier
        .slice(0, earlier.indexOf(at))
        .reduce((sum, paragraph) => sum + paragraph.textContent!.length, 0);
      return { unit: unit.dataset.unit, offset: start + range.toString().length };
    };
    const same = (now: ReturnType<typeof place>, then: ReturnType<typeof place>) => {
      expect(now.unit).toBe(then.unit);
      expect(Math.abs(now.offset - then.offset)).toBeLessThan(280);
    };
    const before = place();
    const width = () => scroller.querySelector("[data-unit]")!.getBoundingClientRect().width;
    const wide = width();
    await pane.getByRole("button", { name: "Hide session rail" }).click();
    await settled();
    // The column widened, and the reader reads on where they were.
    expect(width()).toBeGreaterThan(wide + 100);
    same(place(), before);
    await pane.getByRole("button", { name: "Show session rail" }).click();
    await settled();
    same(place(), before);
  });

  test("@ names a file or a vault's note, and the agent gets its absolute path", async () => {
    const { agentMessages } = await mountApp({
      savedReview: true,
      vault: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    const input = panel.getByRole("combobox", { name: "Message Claude" });
    await input.click();
    await userEvent.keyboard("Read @alp");
    const mentions = panel.getByRole("listbox", { name: "Mentions" });
    await expect
      .element(
        mentions.getByRole("group", { name: "Files" }).getByRole("option", { name: /alpha\.ts/ }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Enter}and @plan");
    await expect
      .element(
        mentions.getByRole("group", { name: "Notes" }).getByRole("option", { name: /Plan\.md/ }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(mentions).not.toBeInTheDocument();
    // The box keeps short tokens, shown as chips with what each names.
    await expect.element(input).toHaveAttribute("data-value", "Read @alpha.ts and @Plan.md ");
    expect(
      [...document.querySelectorAll<HTMLElement>("form [data-mention-chip]")].map((chip) => [
        chip.dataset.mentionChip,
        chip.textContent,
      ]),
    ).toEqual([
      ["file", "alpha.ts"],
      ["note", "Plan.md"],
    ]);
    // Escape keeps a typed @ as text.
    await userEvent.keyboard("@be");
    await expect.element(mentions).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(mentions).not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages)
      .toMatchObject([
        { text: "Read /test/repo/src/alpha.ts and /test/notes/Projects/Plan.md @be" },
      ]);
  });
  test("comments go to the agent from the review, which Med resumes with them", async () => {
    const reply = (at: number, sessionUpdate: string, text: string) => ({
      at,
      update: { sessionUpdate, content: { type: "text", text } },
    });
    const { agentMessages, agentAnswers } = await mountApp({
      savedReview: true,
      answerAgentMessages: true,
      notes: [
        {
          id: "n1",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "Rename it.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
        },
      ],
      session: `event: reset\ndata: ${JSON.stringify({ events: [reply(1000, "user_message_chunk", "Check the durations."), reply(5000, "agent_message_chunk", "They read in seconds.")], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      // The saved comment n1 is a draft too, as the host makes it one.
      inbox: {
        messages: [],
        drafts: [
          {
            id: "n2",
            path: "src/beta.ts",
            line: 2,
            text: "Keep this one.",
            replies: 0,
          },
        ],
      },
    });
    // The comments go from the session's message box.
    expect(page.getByRole("button", { name: /^Send comments to/ }).query()).toBeNull();
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });

    // The comments wait above the message box as one line, to send on their own.
    await expect.element(panel.getByRole("button", { name: "Send 2 comments" })).toBeVisible();
    // Choose one of the two comments, then write and send.
    await panel.getByRole("button", { name: "2 comments" }).click();
    await panel.getByRole("checkbox", { name: /beta\.ts:2/ }).click();
    await expect.element(panel.getByRole("button", { name: "1 of 2 comments" })).toBeVisible();
    // A comment's file and text show it at its line in the diff, from Commit.
    await page.getByRole("radio", { name: "Commit" }).click();
    await panel.getByRole("button", { name: /^alpha\.ts:1\s*Rename it\./ }).click();
    // This review has no guide, so its diff is the Review page.
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(panel.getByRole("button", { name: "Send 1 comment" })).toBeVisible();
    await panel.getByRole("combobox", { name: "Message Claude" }).fill("Use minutes.");
    // With a message, the box's own Send takes both.
    await expect
      .element(panel.getByRole("button", { name: "Send 1 comment" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    // The message and its comment show at once, before the host answers, and
    // the composer is ready for the next one. The turn before keeps its time.
    await expect.element(panel.getByText("Use minutes.")).toBeVisible();
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    await expect.element(panel.getByText("Rename it.")).toBeVisible();
    await expect
      .element(panel.getByRole("combobox", { name: "Message Claude" }))
      .toHaveAttribute("data-value", "");
    await expect.element(panel.getByRole("button", { name: "1 comment" })).toBeVisible();
    expect(panel.element().textContent).not.toMatch(/Worked for -/);

    // A send that fails stays, and goes again with the same ID.
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => agentAnswers.length).toBe(1);
    // The message keeps its row as the host takes it.
    const row = () => panel.getByText("Use minutes.").element().closest<HTMLElement>("[data-unit]");
    const sending = row();
    let left = false;
    const watch = new MutationObserver(() => {
      if (!sending?.isConnected) left = true;
    });
    watch.observe(panel.element(), { childList: true, subtree: true });
    agentAnswers.shift()!();
    await expect
      .poll(() => agentMessages)
      .toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          thread: "claude-s1",
          text: "Use minutes.",
          noteIds: ["n1"],
          attachments: [],
          images: [],
        },
      ]);
    // Claude took it: the thread goes on below it, without a status.
    await expect.element(panel.getByText("Sending…")).not.toBeInTheDocument();
    await expect.element(panel.getByText("Not sent", { exact: false })).not.toBeInTheDocument();
    expect(panel.getByText("Use minutes.").elements()).toHaveLength(1);
    watch.disconnect();
    expect(left).toBe(false);
    expect(row()).toBe(sending);
    expect(sending!.dataset.rise).toBeUndefined();

    // The comment left over goes on its own, from its line.
    await panel.getByRole("button", { name: "Send 1 comment" }).click();
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!();
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["n2"] });
  });

  test("the message box clears its comments: one, or all, each after asking", async () => {
    const draft = (id: string, path: string, text: string) => ({
      id,
      path,
      line: 1,
      text,
      replies: 0,
    });
    const { deletedComments, agentMessages } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: {
        messages: [],
        drafts: [
          draft("c1", "src/alpha.ts", "Rename it."),
          draft("c2", "src/beta.ts", "Keep this one."),
          draft("c3", "src/gamma.ts", "Old note."),
        ],
      },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await panel.getByRole("button", { name: "3 comments" }).click();

    // A comment's Delete asks first; Escape keeps it.
    const remove = panel.getByRole("button", { name: "Delete the comment on alpha.ts:1" });
    await remove.click();
    const confirm = panel.getByRole("button", { name: "Confirm delete the comment on alpha.ts:1" });
    await expect.element(confirm).toHaveTextContent("Delete");
    await userEvent.keyboard("{Escape}");
    await expect.element(remove).toBeVisible();
    expect(deletedComments).toEqual([]);
    // The second click deletes it, from the review too.
    await remove.click();
    await confirm.click();
    await expect.element(panel.getByRole("button", { name: "2 comments" })).toBeVisible();
    await expect.element(panel.getByText("Rename it.")).not.toBeInTheDocument();
    expect(deletedComments).toEqual([["c1"]]);

    // Delete all says how many, then clears the box.
    const all = panel.getByRole("button", { name: "Delete all" });
    await all.click();
    await panel.getByRole("button", { name: "Delete 2 comments" }).click();
    expect(deletedComments.at(-1)).toEqual(["c2", "c3"]);
    await expect.element(panel.getByRole("button", { name: /comments?$/ })).not.toBeInTheDocument();
    await expect
      .element(panel.getByRole("list", { name: "Comments to send" }))
      .not.toBeInTheDocument();
    expect(agentMessages).toEqual([]);
  });

  test("a draft and the messages that Med did not take stay after a reload", async () => {
    const options = {
      savedReview: true,
      answerAgentMessages: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    };
    const panel = page.getByRole("region", { name: "Agent session" });
    const input = panel.getByRole("combobox", { name: "Message Claude" });
    const reload = async () => {
      root?.unmount();
      mount?.remove();
      const app = await mountApp(options);
      if (!panel.query()) await page.getByRole("button", { name: "Show agent session" }).click();
      await expect.element(input).toBeVisible();
      return app;
    };
    let app = await reload();
    await input.fill("Use minutes.");
    app = await reload();
    await expect.element(input).toHaveAttribute("data-value", "Use minutes.");

    // A message on its way when the page closes goes again after the reload.
    await input.click();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => app.agentAnswers.length).toBe(1);
    const onTheWay = Object.entries(localStorage).filter(([key]) => key.startsWith("med:outbox:"));
    expect(onTheWay).toHaveLength(1);
    app.agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    for (const [key, value] of onTheWay) localStorage.setItem(key, value);
    app = await reload();
    await expect.element(input).toHaveAttribute("data-value", "");
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    await expect.poll(() => app.agentAnswers.length).toBe(1);

    // One that failed comes back with its reason and Retry.
    app.agentAnswers.shift()!("The host is busy.");
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    app = await reload();
    await expect.element(panel.getByText("Not sent: The host is busy.")).toBeVisible();
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => app.agentAnswers.length).toBe(1);
    app.agentAnswers.shift()!();
    await expect
      .poll(() => app.agentMessages)
      .toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          thread: "claude-s1",
          text: "Use minutes.",
          noteIds: [],
          attachments: [],
          images: [],
        },
      ]);
    await expect.element(panel.getByText("Not sent", { exact: false })).not.toBeInTheDocument();
    expect(panel.getByText("Use minutes.").elements()).toHaveLength(1);
  });

  test("a message waits while Med does not answer, and goes when Med is back", async () => {
    const { agentMessages, agentAnswers } = await mountApp({
      savedReview: true,
      answerAgentMessages: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await panel.getByRole("combobox", { name: "Message Claude" }).fill("Use minutes.");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentAnswers.length).toBe(1);
    agentAnswers.shift()!(NO_ANSWER);
    // The page tries again by itself; the message stays Sending meanwhile.
    await expect.poll(() => agentAnswers.length).toBe(1);
    await expect.element(panel.getByText("Sending…")).toBeVisible();
    expect(panel.getByText("Not sent", { exact: false }).query()).toBeNull();
    agentAnswers.shift()!();
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Use minutes." }]);
    await expect.element(panel.getByText("Sending…")).not.toBeInTheDocument();
  });

  test("a session open in a terminal says so in one line with no box, and Fork in Med forks it", async () => {
    await page.viewport(1280, 800);
    const reply = (at: number, sessionUpdate: string, text: string) => ({
      at,
      update: { sessionUpdate, content: { type: "text", text } },
    });
    const { agentMessages, ownedStarts } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [reply(1000, "user_message_chunk", "Check the durations."), reply(5000, "agent_message_chunk", "They read in seconds.")], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], elsewhere: { s1: "terminal" }, drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    // One line says where the session runs, with the sentence in its tooltip;
    // there is no box, and Med sends nothing there.
    const line = page.getByRole("group", { name: "Claude session in a terminal" });
    const where = line.getByText("In a terminal", { exact: true });
    await expect.element(where).toBeVisible();
    await expect
      .element(where.element().parentElement!)
      .toHaveAttribute(
        "data-tooltip",
        "Claude has this session open in a terminal. Med can't type there.",
      );
    await expect
      .element(page.getByRole("form", { name: "Message Claude" }))
      .not.toBeInTheDocument();
    expect(agentMessages).toEqual([]);

    // ⌘K offers Fork in Med for the thread.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Fork in Med");
    await expect.element(page.getByRole("option", { name: /^Fork in Med/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // Fork in Med forks the session; the thread follows the fork, and the
    // box opens on it.
    await userEvent.click(line.getByRole("button", { name: "Fork in Med" }));
    await expect.poll(() => ownedStarts).toEqual([{ preset: "claude", fork: "s1" }]);
    const composer = page.getByRole("form", { name: "Message Claude" });
    await expect.element(composer.getByText("Starting Claude…")).toBeVisible();
    await expect.element(line).not.toBeInTheDocument();
  });

  test.each([
    { place: "claude-app" as const, where: "in the Claude app" },
    { place: "other-app" as const, where: "in another app" },
  ])("a session open in $place says where, and offers Fork in Med", async ({ place, where }) => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], elsewhere: { s1: place }, drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const line = page.getByRole("group", { name: `Claude session ${where}` });
    const named = line.getByText(where.replace(/^in/, "In"), { exact: true });
    await expect.element(named).toBeVisible();
    expect(named.element().parentElement!.getAttribute("data-tooltip")).toBe(
      `Claude has this session open ${where}. Med can't type there.`,
    );
    await expect.element(line.getByRole("button", { name: "Fork in Med" })).toBeVisible();
    expect(page.getByRole("combobox", { name: "Message Claude" }).query()).toBeNull();
  });

  test("a saved review starts an agent in the Session pane, and the composer drives it", async () => {
    await page.viewport(1280, 800);
    const { setOwned, ownedActions, agentMessages } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [
        { id: "claude", name: "Claude Code", kind: "claude", available: true },
        { id: "opencode", name: "OpenCode", kind: "acp", available: false },
      ],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const start = page.getByRole("region", { name: "Start a session" });
    await expect.element(start.getByRole("button", { name: /OpenCode/ })).toBeDisabled();
    await userEvent.click(start.getByRole("button", { name: /Claude Code/ }));
    const composer = page.getByRole("form", { name: "Message Claude" });
    await expect.element(composer.getByText("Starting Claude…")).toBeVisible();

    setOwned({
      status: "idle",
      settings: [
        {
          id: "model",
          name: "Model",
          category: "model",
          value: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "haiku", name: "Haiku" },
          ],
        },
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          value: "default",
          options: [
            { value: "default", name: "Ask" },
            { value: "plan", name: "Plan" },
          ],
        },
      ],
      commands: [
        { name: "review", description: "Review the current changes" },
        { name: "compact", description: "Summarize the conversation to free its context" },
      ],
      context: { used: 40_000, total: 200_000 },
    });
    // Before the transcript has a request, the header shows what the runner reports.
    await expect.element(page.getByRole("button", { name: /^Context 20% full/ })).toBeVisible();
    // Compact now sends the agent's own /compact, and closes the popover.
    await userEvent.click(page.getByRole("button", { name: /^Context 20% full/ }));
    await userEvent.click(page.getByRole("button", { name: "Compact now" }));
    await expect.poll(() => agentMessages).toMatchObject([{ text: "/compact", afterTurn: true }]);
    await expect.element(page.getByRole("button", { name: "Compact now" })).not.toBeInTheDocument();
    // Model, effort, and mode are pickers, not commands, in the message
    // box's bar, as in Claude Desktop.
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    expect(composer.element().contains(model.element())).toBe(true);
    await expect.element(model).toHaveTextContent("Default");
    await userEvent.click(model);
    await page.getByRole("option", { name: "Haiku" }).click();
    await expect.element(model).toHaveTextContent("Haiku");
    expect(ownedActions).toContainEqual({
      action: "setting",
      id: "model",
      value: "haiku",
    });

    // `/` lists the agent's own commands; Enter completes one.
    const input = composer.getByRole("combobox", { name: "Message Claude" });
    await userEvent.click(input);
    await userEvent.keyboard("/rev");
    await expect.element(composer.getByRole("option", { name: /\/review/ })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("data-value", "/review ");
    await userEvent.keyboard("the durations{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages)
      .toMatchObject([{ text: "/compact" }, { text: "/review the durations" }]);

    // A pasted image goes with the next message to an agent that takes images.
    setOwned({ images: true });
    await expect.element(composer.getByRole("button", { name: "Add images" })).toBeVisible();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "shot.png", {
        type: "image/png",
      }),
    );
    input.element().dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
      }),
    );
    const images = composer.getByRole("list", { name: "Images to send" });
    // A click on the thumbnail shows the image at full size.
    await images.getByRole("button", { name: "Show attachment 1" }).click();
    const viewer = page.getByRole("dialog", { name: "Image" });
    await expect.element(viewer).toBeVisible();
    expect(viewer.element().querySelector("img")?.getAttribute("src")).toContain(png);
    await userEvent.keyboard("{Escape}");
    await expect.element(viewer).not.toBeInTheDocument();
    await userEvent.click(input);
    await userEvent.keyboard("Why?{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({
        text: "Why?",
        images: [{ mimeType: "image/png", data: png }],
      });
    await expect.element(images).not.toBeInTheDocument();

    // A tool call waits for an answer; while the agent works, Send becomes Stop.
    setOwned({
      status: "working",
      permission: {
        id: "ask-1",
        title: "Claude Code wants to use Edit",
        detail: "src/alpha.ts",
        options: [
          { id: "allow", name: "Allow", kind: "allow_once" },
          { id: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    const ask = page.getByRole("group", { name: "Permission request" });
    await expect.element(ask.getByText("src/alpha.ts")).toBeVisible();
    await userEvent.click(ask.getByRole("button", { name: "Allow", exact: true }));
    await expect.element(ask).not.toBeInTheDocument();
    expect(ownedActions).toContainEqual({
      action: "permission",
      id: "ask-1",
      option: "allow",
    });
    await userEvent.click(composer.getByRole("button", { name: "Stop" }));
    await expect.element(composer.getByRole("button", { name: "Send" })).toBeVisible();
    expect(ownedActions.at(-1)).toEqual({ action: "interrupt" });
  });

  test("while the agent works, a message goes at its next step; Edit brings it back, Remove drops it, and ↑ takes back the rest", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, goneOnTake } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /Claude Code/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Claude" });
    const field = composer.getByRole("combobox", { name: "Message Claude" });
    setOwned({ status: "working", settings: [], commands: [] });
    // Working, with an empty box: Stop. With a message: Send now, and Stop beside it.
    await expect.element(composer.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect
      .element(composer.getByRole("button", { name: "Send now" }))
      .not.toBeInTheDocument();
    await userEvent.click(field);
    await userEvent.keyboard("Round to minutes.");
    await expect.element(composer.getByRole("button", { name: "Stop" })).toBeVisible();
    await userEvent.click(composer.getByRole("button", { name: "Send now" }));
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Round to minutes." }]);
    const queued = panel.getByText("Queued for Claude's next step");
    await expect.element(queued).toBeVisible();
    // Claude Code takes it after its tools by itself, so no Send now.
    await expect.element(panel.getByRole("button", { name: "Send now" })).not.toBeInTheDocument();
    await expect.element(field).toHaveAttribute("data-value", "");

    // Edit takes it back into the box, before what the box holds.
    await userEvent.click(field);
    await userEvent.keyboard("And hours.");
    await userEvent.click(panel.getByRole("button", { name: "Edit", exact: true }));
    await expect.element(field).toHaveAttribute("data-value", "Round to minutes.\n\nAnd hours.");
    await expect.element(queued).not.toBeInTheDocument();

    // Remove drops one; ↑ in the empty box takes back the rest, in order.
    await userEvent.click(field);
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("Keep seconds.{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("Test the hour.{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.length).toBe(4);
    await expect.element(panel.getByText("Keep seconds.")).toBeVisible();
    const removes = panel.getByRole("button", { name: "Remove", exact: true });
    await expect.poll(() => removes.elements().length).toBe(3);
    await userEvent.click(removes.nth(1));
    await expect.element(panel.getByText("Keep seconds.")).not.toBeInTheDocument();
    // One that the agent takes meanwhile goes; the rest come back.
    goneOnTake.add("Test the hour.");
    await userEvent.click(field);
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(field).toHaveAttribute("data-value", "Round to minutes.\n\nAnd hours.");
    await expect.element(queued).not.toBeInTheDocument();
    await expect.element(panel.getByText("1 of them went to Claude already.")).toBeVisible();

    // A queued image does not come back with its text, and the box says so.
    setOwned({ status: "working", images: true, settings: [], commands: [] });
    await userEvent.fill(field, "");
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "shot.png", {
        type: "image/png",
      }),
    );
    field
      .element()
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }));
    await expect.element(composer.getByRole("list", { name: "Images to send" })).toBeVisible();
    await userEvent.click(field);
    await userEvent.keyboard("See the chart.{Meta>}{Enter}{/Meta}");
    await expect.element(queued).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Edit", exact: true }));
    await expect.element(field).toHaveAttribute("data-value", "See the chart.");
    await expect
      .element(panel.getByText("Its attachment did not come back; add it again."))
      .toBeVisible();
  });

  test("while the agent works, ⇧⌘↩ queues a message for the turn's end, Send now sends it at the next step, and ⌘↩ can queue instead", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, steered } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    localStorage.removeItem("med:follow-up");
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /Claude Code/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Claude" });
    const field = composer.getByRole("combobox", { name: "Message Claude" });
    setOwned({ status: "working", settings: [], commands: [] });
    await userEvent.click(field);
    await userEvent.keyboard("Rename it.{Meta>}{Shift>}{Enter}{/Shift}{/Meta}");
    await expect.poll(() => agentMessages).toMatchObject([{ text: "Rename it.", afterTurn: true }]);
    const queued = panel.getByText("Queued until Claude's turn ends");
    await expect.element(queued).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Send now", exact: true }));
    await expect.poll(() => steered).toHaveLength(1);
    await expect.element(panel.getByText("Queued for Claude's next step")).toBeVisible();
    await expect.element(queued).not.toBeInTheDocument();

    // The palette's choice makes ⌘↩ queue, and the button says so.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(
      page.getByRole("option", { name: "While the agent works, ⌘↩ queues for the turn's end" }),
    );
    expect(localStorage.getItem("med:follow-up")).toBe("queue");
    await userEvent.click(field);
    await userEvent.keyboard("Then the docs.");
    await expect.element(composer.getByRole("button", { name: "Queue" })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ text: "Then the docs.", afterTurn: true });
    localStorage.removeItem("med:follow-up");
  });

  test("Codex takes a message sent now in the turn that runs, and a queued one at its end or on Send now", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages, steered } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "codex", name: "Codex", kind: "codex", available: true }],
    });
    localStorage.removeItem("med:follow-up");
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page.getByRole("region", { name: "Start a session" }).getByRole("button", { name: /Codex/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const composer = panel.getByRole("form", { name: "Message Codex" });
    const field = composer.getByRole("combobox", { name: "Message Codex" });
    setOwned({
      status: "working",
      settings: [],
      commands: [],
      capabilities: AGENT_CAPABILITIES.codex,
    });
    await userEvent.click(field);
    await userEvent.keyboard("Check the hour.");
    await expect.element(composer.getByRole("button", { name: "Send now" })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.at(-1)).toMatchObject({ text: "Check the hour." });
    expect(agentMessages.at(-1)).not.toHaveProperty("afterTurn");
    await expect.element(panel.getByText("Queued for Codex's next step")).toBeVisible();
    await expect
      .element(panel.getByRole("button", { name: "Send now", exact: true }))
      .not.toBeInTheDocument();

    await userEvent.keyboard("Then the docs.{Meta>}{Shift>}{Enter}{/Shift}{/Meta}");
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ text: "Then the docs.", afterTurn: true });
    await expect.element(panel.getByText("Queued until Codex's turn ends")).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Send now", exact: true }));
    await expect.poll(() => steered).toHaveLength(1);
    await expect.element(panel.getByText("Queued until Codex's turn ends")).not.toBeInTheDocument();
  });

  test("an ACP agent takes messages only between turns: its button is Queue, and a queued message has no Send now", async () => {
    await page.viewport(1280, 800);
    const { setOwned, agentMessages } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "fake", name: "OpenCode", kind: "acp", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    await userEvent.click(
      page
        .getByRole("region", { name: "Start a session" })
        .getByRole("button", { name: /OpenCode/ }),
    );
    const panel = page.getByRole("region", { name: "Agent session" });
    const field = panel.getByRole("combobox", { name: /^Message / });
    setOwned({
      status: "working",
      settings: [],
      commands: [],
      capabilities: AGENT_CAPABILITIES.acp,
    });
    await userEvent.click(field);
    await userEvent.keyboard("Wait for me.");
    await expect.element(panel.getByRole("button", { name: "Queue", exact: true })).toBeVisible();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect.poll(() => agentMessages.at(-1)).toMatchObject({ text: "Wait for me." });
    await expect.element(panel.getByText(/^Queued until .*'s turn ends$/)).toBeVisible();
    await expect
      .element(panel.getByRole("button", { name: "Send now", exact: true }))
      .not.toBeInTheDocument();
  });

  test("a turn that another process runs on a session that Med runs works until it ends, then shows its time", async () => {
    await page.viewport(1280, 800);
    const { setOwned, setOwnedTranscript } = await mountApp({
      savedReview: true,
      inbox: { messages: [], drafts: [] },
      agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
    });
    await userEvent.click(page.getByRole("button", { name: "Show agent session" }));
    const start = page.getByRole("region", { name: "Start a session" });
    await userEvent.click(start.getByRole("button", { name: /Claude Code/ }));
    const now = Date.now();
    // Med's runner waits after its last turn.
    setOwned({ status: "idle", updatedAt: now - 60_000 });
    const prompt = (at: number, text: string) => ({
      at,
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
    });
    // Claude Code in a terminal takes the session and thinks: the transcript
    // has only its prompt, newer than the runner's state.
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests.")],
      idle: false,
      modifiedAt: now - 2000,
    });
    const panel = page.getByRole("region", { name: "Agent session" });
    const thread = panel.getByRole("log", { name: "Session" });
    await expect.element(thread.getByText("Run the tests.")).toBeVisible();
    await expect.element(thread.getByText("Working")).toBeVisible();
    expect(thread.element().textContent).not.toContain("Worked for");
    // The header says so too.
    await expect.element(panel.getByText("Working", { exact: true }).first()).toBeVisible();
    expect(panel.getByText("Idle", { exact: true }).query()).toBeNull();

    // Its reply ends the turn, three seconds after the prompt.
    const reply = {
      at: now + 1000,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "The tests pass." },
        _meta: { med: { endsTurn: true } },
      },
    };
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests."), reply],
      idle: true,
      modifiedAt: now + 1000,
    });
    await expect.element(thread.getByText("Worked for 3s")).toBeVisible();
    expect(thread.element().textContent).not.toContain("Working");

    // A turn that Med runs ends when its runner says so, though the transcript
    // that it left behind does not say, as after an API error.
    setOwned({ status: "working", updatedAt: now + 2000 });
    setOwnedTranscript({
      events: [prompt(now - 2000, "Run the tests."), reply, prompt(now + 2000, "Check the hour.")],
      idle: false,
      modifiedAt: now + 2000,
    });
    await expect.element(thread.getByText("Working")).toBeVisible();
    setOwned({ status: "idle", updatedAt: now + 4000 });
    // The transcript ends at the prompt: under a second, the turn shows no time.
    await expect.element(thread.getByText("Worked", { exact: true })).toBeVisible();
    expect(thread.element().textContent).not.toContain("Working");
  });
});
