import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { DashboardsPage } from "../../src/web/components/dashboards/DashboardsPage";
import type { Dashboard, DashboardFile } from "../../src/shared/dashboards";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
  history.replaceState(null, "", "/");
});

const dashboard: Dashboard = {
  title: "Checkout health",
  description: "As on-call reads it.",
  range: "now-6h",
  live: false,
  inputs: [
    { name: "service", label: "Service", type: "text", default: "checkout" },
    { name: "env", label: "env", type: "choice", default: "prod", options: ["prod", "staging"] },
  ],
  views: [
    {
      name: "Overview",
      panels: [
        {
          kind: "chart",
          width: 3,
          keys: [
            ["link", "https://status.acme.build/${service}?env=${env}&from=${from}"],
            ["metric", "requests"],
            ["type", "stat"],
            ["title", "Requests"],
            ["unit", "req/s"],
          ],
        },
        { kind: "text", width: 3, text: "**${service}** in ${env}" },
        {
          kind: "chart",
          width: 6,
          keys: [
            ["link", "https://status.acme.build/${service}?env=${env}"],
            ["title", "Mistyped"],
            ["metric", "${metrc}"],
          ],
        },
      ],
    },
    {
      name: "Endpoints",
      panels: [
        {
          kind: "chart",
          width: 12,
          keys: [
            ["link", "https://status.acme.build/${service}?env=${env}"],
            ["metric", "endpoints"],
            ["type", "table"],
            ["title", "Slowest endpoints"],
          ],
        },
      ],
    },
  ],
};

const file: DashboardFile = {
  entry: {
    id: "personal/checkout",
    path: "/home/me/.config/med/dashboards/checkout.dashboard.yaml",
    where: "Personal",
    relative: "checkout.dashboard.yaml",
    title: "Checkout health",
    views: 2,
    panels: 4,
    modified: 1,
  },
  text: "title: Checkout health\n",
  dashboard,
  problems: [{ line: 9, message: "Med does not know the key colour." }],
};

async function show(address: string) {
  history.replaceState(null, "", address);
  await page.viewport(1400, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "1300px", height: "880px", display: "flex" });
  document.body.append(frame);
  root = createRoot(frame);
  root.render(<DashboardsPage />);
}

test("a dashboard draws its inputs, its panels from their sources, and its problems; an input's value reaches the source and the address", async () => {
  const asked: { link: string; meta?: Record<string, string>; at?: number }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/dashboards/read") return Response.json(file);
    if (url.pathname !== "/api/charts/link")
      return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
    asked.push(body);
    const env = new URL(body.link).searchParams.get("env");
    if (body.meta?.metric === "requests")
      return Response.json({
        source: "https://status.acme.build",
        rows: `time,req/s\n2026-11-16T09:00:00,400\n2026-11-16T09:01:00,${env === "staging" ? 40 : 500}`,
        live: false,
        fetched: Date.parse("2026-11-16T09:05:00"),
      });
    return Response.json({
      source: "https://status.acme.build",
      rows: "endpoint,req/s,p99 ms\n/cart,412,180\n/pay,120,950\n/search,880,95",
      live: false,
      fetched: Date.parse("2026-11-16T09:05:00"),
    });
  });
  await show("/dashboards/personal/checkout?var-env=prod");
  await expect.element(page.getByRole("heading", { name: "Checkout health" })).toBeVisible();
  await expect
    .element(page.getByRole("alert", { name: "Problems in the file" }))
    .toHaveTextContent("Line 9: Med does not know the key colour.");
  // The stat: the last value, its change over the range.
  const stat = page.getByRole("figure").filter({ hasText: "Requests" });
  await expect.element(stat.getByText("500 req/s")).toBeVisible();
  expect(stat.element().textContent).toContain("↗ 25%");
  // A text panel takes the inputs' values too.
  const note = () => document.querySelector("[data-dashboard-panel] p")?.textContent;
  await expect.poll(note, { timeout: 5_000 }).toBe("checkout in prod");
  // A name that is no input says so, and asks nothing.
  const mistyped = page.getByRole("alert").filter({ hasText: "Mistyped" });
  await expect.element(mistyped).toBeVisible();
  expect(mistyped.element().textContent).toContain("${metrc} is no input of this dashboard.");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({
    link: "https://status.acme.build/checkout?env=prod&from=now-6h",
    meta: { metric: "requests" },
  });
  // Every panel reads as of one minute.
  expect(asked[0]!.at! % 60_000).toBe(0);

  // A choice's value reaches the source, and the address keeps it.
  // Two choices flip with a click.
  await page.getByRole("button", { name: "env: prod" }).click();
  await expect.element(stat.getByText("40 req/s")).toBeVisible();
  expect(asked.at(-1)!.link).toBe("https://status.acme.build/checkout?env=staging&from=now-6h");
  expect(new URLSearchParams(location.search).get("var-env")).toBe("staging");
  // A text input reads on Enter.
  const service = page.getByRole("textbox", { name: "Service" });
  await service.fill("payments");
  await userEvent.keyboard("{Enter}");
  await expect.poll(note, { timeout: 5_000 }).toBe("payments in staging");
  await expect
    .poll(() => asked.at(-1)?.link)
    .toBe("https://status.acme.build/payments?env=staging&from=now-6h");

  // Inspect shows the link, the keys the command read, and what it printed.
  await stat.getByRole("button", { name: "Inspect data" }).click();
  const dialog = page.getByRole("dialog");
  await expect
    .element(dialog.getByText("MED_CHART_METRIC=requests", { exact: false }))
    .toBeVisible();
  await expect.element(dialog.getByText("2026-11-16T09:01:00,40", { exact: false })).toBeVisible();
  await userEvent.keyboard("{Escape}");

  // Another view is a tab; its table sorts by a column.
  await page.getByRole("tab", { name: "Endpoints" }).click();
  expect(new URLSearchParams(location.search).get("view")).toBe("Endpoints");
  const table = page.getByRole("table");
  await expect.element(table.getByText("/search")).toBeVisible();
  await table.getByRole("button", { name: "p99 ms" }).click();
  const firsts = () =>
    [...table.element().querySelectorAll("tbody tr td:first-child")].map(
      (cell) => cell.textContent,
    );
  expect(firsts()).toEqual(["/pay", "/cart", "/search"]);
}, 20_000);

test("the list groups the dashboards Med found by where they are, and opens one", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    if (url.pathname === "/api/dashboards")
      return Response.json({
        folder: "~/.config/med/dashboards",
        dashboards: [
          file.entry,
          {
            ...file.entry,
            id: "shop/ops/shop",
            where: "shop",
            relative: "ops/shop.dashboard.yaml",
            title: "Shop",
            problem: "Line 1: Flow sequence in block collection must be sufficiently indented",
          },
        ],
      });
    if (url.pathname === "/api/dashboards/read") return Response.json(file);
    return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
  });
  await show("/dashboards");
  await expect.element(page.getByRole("heading", { name: "Dashboards", level: 1 })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Personal" })).toBeVisible();
  await expect
    .element(page.getByRole("region", { name: "shop" }).getByText(/^Line 1:/))
    .toBeVisible();
  await page.getByRole("button", { name: /Checkout health/ }).click();
  expect(location.pathname).toBe("/dashboards/personal/checkout");
  await expect.element(page.getByRole("heading", { name: "Checkout health" })).toBeVisible();
});
