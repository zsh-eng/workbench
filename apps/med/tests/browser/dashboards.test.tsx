import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { DashboardsPage } from "../../src/web/components/dashboards/DashboardsPage";
import type { Dashboard, DashboardFile } from "../../src/shared/dashboards";
import type { Thread } from "../../src/shared/threads";
import type { SuperagentLink } from "../../src/web/data/superagent";
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
            ["link", "https://status.acme.build/${service}"],
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
            ["link", "https://status.acme.build/${service}"],
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
            ["link", "https://status.acme.build/${service}"],
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
    const env = body.meta?.env;
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
  // The source gets the inputs and the range as keys; the link spells none.
  expect(asked[0]).toMatchObject({
    link: "https://status.acme.build/checkout",
    meta: { metric: "requests", service: "checkout", env: "prod", from: "now-6h", to: "now" },
  });
  // Every panel reads as of one minute.
  expect(asked[0]!.at! % 60_000).toBe(0);

  // A choice's value reaches the source, and the address keeps it.
  // Two choices flip with a click.
  await page.getByRole("button", { name: "env: prod" }).click();
  await expect.element(stat.getByText("40 req/s")).toBeVisible();
  expect(asked.at(-1)).toMatchObject({
    link: "https://status.acme.build/checkout",
    meta: { env: "staging" },
  });
  expect(new URLSearchParams(location.search).get("var-env")).toBe("staging");
  // A text input reads on Enter.
  const service = page.getByRole("textbox", { name: "Service" });
  await service.fill("payments");
  await userEvent.keyboard("{Enter}");
  await expect.poll(note, { timeout: 5_000 }).toBe("payments in staging");
  await expect.poll(() => asked.at(-1)?.link).toBe("https://status.acme.build/payments");

  // Inspect shows the link, the keys the command read, and what it printed.
  await stat.getByRole("button", { name: "Inspect data" }).click();
  const dialog = page.getByRole("dialog");
  await expect
    .element(dialog.getByText("MED_CHART_METRIC=requests", { exact: false }))
    .toBeVisible();
  await expect.element(dialog.getByText("MED_CHART_ENV=staging", { exact: false })).toBeVisible();
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

const timed: DashboardFile = {
  ...file,
  problems: [],
  dashboard: {
    ...dashboard,
    inputs: [
      {
        name: "service",
        label: "Service",
        type: "choice",
        default: "checkout",
        options: ["checkout", "payments", "search", "inventory"],
      },
    ],
    views: [
      {
        name: "Overview",
        panels: [
          {
            kind: "chart",
            width: 6,
            keys: [
              ["link", "https://status.acme.build/${service}"],
              ["metric", "requests"],
              ["type", "stat"],
              ["title", "Requests"],
            ],
          },
          {
            kind: "chart",
            width: 6,
            keys: [
              ["link", "https://status.acme.build/${service}"],
              ["metric", "latency"],
              ["title", "Latency"],
            ],
          },
        ],
      },
    ],
  },
};

function superagentThread(turn?: Thread["turn"]): Thread {
  return {
    id: "superagent-thread",
    kind: "session",
    title: "Superagent",
    createdAt: "2026-11-16T09:00:00Z",
    updatedAt: 1,
    reviews: [],
    superagent: true,
    ...(turn ? { turn } : {}),
  };
}

test("a dashboard keeps what it drew while it reads again, picks a range from words, searches its choices, zooms to a drag, and Back undoes each", async () => {
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  const asked: { link: string; meta?: Record<string, string> }[] = [];
  const reports: { values: Record<string, string>; showing: boolean }[] = [];
  const sent: { text: string; attachments: { label: string; text: string }[] }[] = [];
  let hold: Promise<void> | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/dashboards/read") return Response.json(timed);
    if (url.pathname === "/api/dashboards/report") {
      reports.push(body);
      return Response.json({});
    }
    if (url.pathname.endsWith("/agent/messages")) {
      sent.push(body);
      return Response.json({
        message: {
          id: "m1",
          sessionId: "s1",
          agent: "claude",
          text: body.text,
          noteIds: [],
          attachmentCount: 1,
          createdAt: new Date().toISOString(),
          delivery: "delivered",
        },
      });
    }
    if (url.pathname !== "/api/charts/link")
      return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
    asked.push(body);
    await hold;
    const service = new URL(body.link).pathname.slice(1);
    const last = service === "payments" ? 90 : 500;
    // A point a minute for an hour, ending at the last value.
    const points = Array.from(
      { length: 61 },
      (_, minute) =>
        `2026-11-16T09:${String(minute % 60).padStart(2, "0")}:00`.replace(
          minute === 60 ? "09:00" : "\0",
          "10:00",
        ) + `,${minute === 60 ? last : 400 + minute}`,
    );
    return Response.json({
      source: "https://status.acme.build",
      rows: `time,${body.meta?.metric === "latency" ? "p99 ms" : "req/s"}\n${points.join("\n")}`,
      live: false,
      fetched: Date.parse("2026-11-16T10:05:00"),
    });
  });
  const { SuperagentContext } = await import("../../src/web/data/superagent");
  let link: SuperagentLink = {
    thread: superagentThread(),
    start: vi.fn<SuperagentLink["start"]>(),
    open: vi.fn<SuperagentLink["open"]>(),
  };
  history.replaceState(null, "", "/dashboards/personal/checkout");
  await page.viewport(1400, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "1300px", height: "880px", display: "flex" });
  document.body.append(frame);
  root = createRoot(frame);
  const render = () =>
    root!.render(
      <SuperagentContext value={link}>
        <DashboardsPage />
      </SuperagentContext>,
    );
  render();
  const stat = page.getByRole("figure").filter({ hasText: "Requests" });
  await expect.element(stat.getByText("500")).toBeVisible();
  // The page tells the host what it shows, each value filled in.
  await expect
    .poll(() => reports.at(-1))
    .toEqual({
      id: "personal/checkout",
      values: { service: "checkout", from: "now-6h", to: "now" },
      showing: true,
    });

  // More than two choices: a menu with a search field.
  let release!: () => void;
  hold = new Promise((go) => (release = go));
  await page.getByRole("combobox", { name: "Service" }).click();
  await userEvent.keyboard("pay");
  await expect.element(page.getByRole("option", { name: "payments" })).toBeVisible();
  expect(page.getByRole("option", { name: "search" }).query()).toBeNull();
  await userEvent.keyboard("{Enter}");
  // While it reads, the last value stays, dimmed under a bar, and says it fetches.
  await expect.poll(() => asked.at(-1)?.link).toMatch(/\/payments$/);
  await expect.element(stat.getByText("500")).toBeVisible();
  await expect.poll(() => !!document.querySelector("[data-chart-busy]")).toBe(true);
  expect(stat.element().textContent).toMatch(/Fetching/);
  release();
  await expect.element(stat.getByText("90")).toBeVisible();
  await expect.poll(() => !!document.querySelector("[data-chart-busy]")).toBe(false);
  hold = undefined;
  expect(new URLSearchParams(location.search).get("var-service")).toBe("payments");

  // The range from words: the preview says the moments before they apply.
  await page.getByRole("button", { name: "Time range: Last 6 hours" }).click();
  await userEvent.keyboard("yesterday 14:00 to 16:30");
  await expect
    .element(page.getByRole("status").filter({ hasText: "14:00 → 16:30 · 2 h 30 min" }))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("button", { name: /^Time range: \w{3} \d+, 14:00 – 16:30$/ }))
    .toBeVisible();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(14, 0, 0, 0);
  expect(new URLSearchParams(location.search).get("from")).toBe(String(yesterday.getTime()));
  // A source reads a moment as an ISO time, in MED_CHART_FROM.
  await expect.poll(() => asked.at(-1)?.meta?.from).toBe(yesterday.toISOString());

  // A drag across a chart's time zooms the whole page to it.
  const surface = await vi.waitFor(() => {
    const rect = document.querySelector<SVGRectElement>(
      "[data-chart-plot] > rect[fill='transparent']",
    );
    if (!rect) throw new Error("No plot yet");
    return rect;
  });
  const box = surface.getBoundingClientRect();
  const drag = (type: string, x: number) =>
    surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: box.left + x,
        clientY: box.top + box.height / 2,
      }),
    );
  // A frame between moves, as a hand gives React.
  for (const [type, at] of [
    ["pointerdown", 0.25],
    ["pointermove", 0.5],
    ["pointermove", 0.75],
    ["pointerup", 0.75],
  ] as const) {
    drag(type, box.width * at);
    await new Promise(requestAnimationFrame);
  }
  await expect
    .poll(() => {
      const params = new URLSearchParams(location.search);
      return Number(params.get("to")) - Number(params.get("from"));
    })
    .toBeLessThan(2 * 3_600_000);
  // Back undoes the zoom, then the range, then the service.
  history.back();
  await expect
    .element(page.getByRole("button", { name: /^Time range: \w{3} \d+, 14:00 – 16:30$/ }))
    .toBeVisible();
  history.back();
  await expect
    .element(page.getByRole("button", { name: "Time range: Last 6 hours" }))
    .toBeVisible();
  history.back();
  await expect
    .element(page.getByRole("combobox", { name: "Service" }))
    .toHaveTextContent("checkout");

  // Asking the Superagent sends the words with what the page shows, and its
  // answer shows on the page.
  await page
    .getByRole("textbox", { name: "Ask the Superagent about this dashboard" })
    .fill("payments, since 9:00");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.text).toBe("payments, since 9:00");
  expect(sent[0]!.attachments[0]!.text).toContain(
    "Checkout health (personal/checkout) is on the reader's screen in Med: service=checkout, Last 6 hours (from now-6h to now).",
  );
  expect(sent[0]!.attachments[0]!.text).toContain("run med dashboard open with only what changes");
  await expect.element(page.getByText("Asking the Superagent…")).toBeVisible();
  link = {
    ...link,
    thread: superagentThread({
      endedAt: Date.now() + 1000,
      said: "Showing payments since 09:00.",
    }),
  };
  render();
  await expect.element(page.getByText("Showing payments since 09:00.")).toBeVisible();
}, 30_000);

test("an input whose options come from a file shows them by their labels, and the options the file has now", async () => {
  const sourced = (options: string[]): DashboardFile => ({
    ...file,
    problems: [{ line: 4, message: "region's options from regions.csv: There is no file." }],
    dashboard: {
      ...dashboard,
      range: undefined,
      inputs: [
        {
          name: "env",
          label: "env",
          type: "choice",
          default: "prod",
          options,
          labels: { prod: "Production" },
          source: { file: "environments.json" },
        },
        // One whose file could not be read still takes a value.
        {
          name: "region",
          label: "region",
          type: "choice",
          default: "",
          options: [],
          source: { file: "regions.csv" },
        },
        // A text input's options are suggestions.
        {
          name: "team",
          label: "team",
          type: "text",
          default: "",
          options: ["payments", "checkout"],
          source: { file: "teams.txt" },
        },
      ],
      views: [
        { name: "Overview", panels: [{ kind: "text", width: 12, text: "${env} in ${region}" }] },
      ],
    },
  });
  let current = sourced(["prod", "staging", "qa"]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    if (url.pathname === "/api/dashboards/read") return Response.json(current);
    return Response.json({});
  });
  await show("/dashboards/personal/checkout?var-region=eu");
  const env = page.getByRole("combobox", { name: "env" });
  await expect.element(env).toHaveTextContent("Production");
  await expect
    .poll(() => document.querySelector("[data-dashboard-panel] p")?.textContent)
    .toBe("prod in eu");
  await expect.element(page.getByRole("textbox", { name: "region" })).toHaveValue("eu");
  await expect
    .poll(() => page.getByRole("alert", { name: "Problems in the file" }).element().textContent)
    .toBe("Line 4: region's options from regions.csv: There is no file.");
  // A field with suggestions is a combobox.
  const team = page.getByRole("combobox", { name: "team" }).element() as HTMLInputElement;
  expect([...(team.list?.options ?? [])].map((option) => option.value)).toEqual([
    "payments",
    "checkout",
  ]);

  // The script rewrote the file; the dashboard's own text is the same.
  current = sourced(["prod", "staging", "qa", "dev"]);
  await new Promise((done) => setTimeout(done, 2_100));
  await env.click();
  await expect.element(page.getByRole("option", { name: "dev" })).toBeVisible();
  await page.getByRole("option", { name: "staging" }).click();
  expect(new URLSearchParams(location.search).get("var-env")).toBe("staging");
}, 15_000);
