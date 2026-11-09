import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { contextBreakdown } from "../../src/shared/owned-session";
import { SessionSidePanel } from "../../src/web/components/session/SessionSidePanel";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
  localStorage.removeItem("med:session-panel-cards");
});

// Claude Code's get_context_usage reply, cut down.
const reply = {
  categories: [
    { name: "System prompt", tokens: 9400, kind: "used" },
    { name: "System tools", tokens: 19_600, kind: "used" },
    { name: "MCP tools (deferred)", tokens: 120_100, isDeferred: true, kind: "deferred" },
    { name: "Messages", tokens: 413_200, kind: "used" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
    { name: "Free space", tokens: 24_800, kind: "free" },
  ],
  totalTokens: 442_200,
  maxTokens: 500_000,
  memoryFiles: [{ path: "/Users/me/project/CLAUDE.md", type: "Project", tokens: 1600 }],
  mcpTools: [
    { name: "mcp__docs__read", serverName: "docs", tokens: 500, isLoaded: false },
    { name: "mcp__docs__write", serverName: "docs", tokens: 400, isLoaded: true },
    { name: "mcp__mail__send", serverName: "mail", tokens: 2000, isLoaded: false },
  ],
  agents: [{ agentType: "reviewer", source: "plugin", tokens: 225 }],
};

test("the Context card shows what fills the window, as Claude Desktop's does", async () => {
  await page.viewport(1200, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { display: "flex", height: "900px" });
  document.body.append(frame);
  root = createRoot(frame);
  const breakdown = contextBreakdown(reply, Date.now())!;
  root.render(
    <SessionSidePanel
      usage={null}
      context={{ used: 442_200, window: 500_000, windowFrom: "agent" }}
      breakdown={breakdown}
      working
      place={{ agent: "Claude", agentIcon: "claude", runs: "Med" }}
      backgroundRef={() => {}}
    />,
  );
  const card = page.getByRole("region", { name: "Context" });
  await expect.element(card).toMatchTextContent(/^Context88% used442\.2k \/ 500k/);
  // The parts in use, largest first, then the buffer and the free space.
  const rows = card.getByRole("list", { name: "What fills the context" });
  await expect
    .element(rows)
    .toHaveTextContent(
      "Messages413.2k82.6%System tools19.6k3.9%System prompt9.4k1.9%Autocompact buffer33k6.6%Free space24.8k5.0%",
    );
  // Deferred tools load when the agent uses them, so they take no share.
  await expect
    .element(card.getByRole("list", { name: "Loaded when the agent uses them" }))
    .toHaveTextContent("MCP tools (deferred)120.1k—");
  // The lists behind the parts open in place: MCP tools by server.
  const tools = card.getByText("MCP tools", { exact: true });
  await userEvent.click(tools);
  await expect.element(card.getByText("mail")).toBeVisible();
  await expect.element(card.getByText("2 tools")).toBeVisible();
  await expect.element(card.getByText("Memory files")).toBeVisible();
  await expect.element(card.getByText("Custom agents")).toBeVisible();
  await expect
    .element(card.getByText("Last updated just now. Refreshes when this turn ends."))
    .toBeVisible();

  // The title folds the card to its bar, and the card stays folded.
  await card.getByRole("button", { name: "Context" }).click();
  await expect.element(rows).not.toBeInTheDocument();
  await expect.element(card.getByRole("meter", { name: "Context in use" })).toBeVisible();
  expect(JSON.parse(localStorage.getItem("med:session-panel-cards")!)).toEqual({ Context: false });
});
