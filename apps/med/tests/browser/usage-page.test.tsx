import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { UsagePage } from "../../src/web/components/UsagePage";
import type { UsageReport, UsageRow } from "../../src/shared/usage-report";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
const address = location.pathname + location.search;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  history.replaceState(null, "", address);
  vi.restoreAllMocks();
});

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const row = (
  day: string,
  agent: string,
  model: string,
  cost: number,
  extra: Partial<UsageRow> = {},
) => ({
  day,
  agent,
  model,
  requests: 10,
  input: 1000,
  output: 2000,
  cacheRead: 90_000,
  cacheWrite: 9000,
  cost,
  unpriced: 0,
  agentPriced: 0,
  ...extra,
});

test("Usage shows a range's spend, each day's by agent, and the spend by agent and by model", async () => {
  initializeTheme();
  const asked: { from: string; to: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    if (url.pathname === "/api/agents")
      return Response.json({
        agents: [{ id: "pi", name: "Pi", kind: "pi", available: true }],
      });
    if (url.pathname === "/api/usage") {
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      asked.push({ from, to });
      const report: UsageReport = {
        from,
        to,
        files: 3,
        rows: [
          row(from, "claude", "claude-opus-5-5", 12.5),
          row(from, "codex", "gpt-6.2-sol", 2.25),
          row(to, "pi", "claude-opus-5-5", 1.25),
          row(to, "pi", "made-up-model", 0, { unpriced: 10 }),
        ],
        prices: {
          version: 1,
          source: "https://example.com/anthropic",
          readAt: "2026-11-24",
        },
      };
      return Response.json(report);
    }
    return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  // The address's range.
  history.replaceState(null, "", "/usage?from=2026-11-02&to=2026-11-04");
  root.render(<UsagePage />);
  await expect.poll(() => asked[0]).toEqual({ from: "2026-11-02", to: "2026-11-04" });
  await expect.element(page.getByText("$16.00", { exact: true })).toBeVisible();
  await expect.element(page.getByText("40 requests")).toBeVisible();
  // The tables: every agent, and every model with the agents that ran it.
  const agents = page.getByRole("table").first();
  await expect.element(agents.getByRole("rowheader", { name: "Claude Code" })).toBeVisible();
  await expect.element(agents.getByRole("cell", { name: "$12.50" })).toBeVisible();
  const models = page.getByRole("table").last();
  await expect
    .element(models.getByRole("rowheader", { name: /Opus 5\.5.*Claude Code, Pi/ }))
    .toBeVisible();
  await expect.element(models.getByRole("cell", { name: "$13.75" })).toBeVisible();
  await expect.element(page.getByText(/No price for made-up-model/)).toBeVisible();

  // A day's split is on its column; the day between has none.
  await expect.element(page.getByRole("button", { name: /: \$0\.00$/ })).toBeVisible();
  await page.getByRole("button", { name: /: \$14\.75$/ }).hover();
  // The tooltip leads with the day's total, then each agent's share.
  await expect
    .poll(() => page.getByRole("status").element().textContent)
    .toMatch(/\$14\.75\$12\.50Claude Code\$2\.25Codex$/);

  // The presets: this month to today, and last month.
  const now = new Date();
  await page.getByRole("button", { name: "This month" }).click();
  await expect
    .poll(() => asked.at(-1))
    .toEqual({ from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayOf(now) });
  expect(location.search).toBe("");
  await page.getByRole("button", { name: "Last month" }).click();
  await expect
    .poll(() => asked.at(-1))
    .toEqual({
      from: dayOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: dayOf(new Date(now.getFullYear(), now.getMonth(), 0)),
    });
  expect(location.search).toBe("?range=last-month");
  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabelText("From").fill("2026-02-03");
  await expect.poll(() => asked.at(-1)?.from).toBe("2026-02-03");
  expect(location.search).toMatch(/^\?from=2026-02-03&to=/);
});
