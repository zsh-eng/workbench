import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardFile } from "../../src/shared/dashboards";
import {
  cleanUp,
  createHost,
  events,
  mount,
  prepareWindow,
  render,
  root,
  sessionThread,
  stream,
} from "./session-reviews-fixture";

// A dashboard that an agent links to in a reply, beside its thread: the
// thread's workspace, the reader's steps, and the agent's `med dashboard open`.

beforeEach(prepareWindow);
afterEach(() => {
  vi.restoreAllMocks();
  cleanUp();
});

const cluster: DashboardFile = {
  entry: {
    id: "personal/cluster",
    path: "/home/me/.config/med/dashboards/cluster.dashboard.yaml",
    where: "Personal",
    relative: "cluster.dashboard.yaml",
    title: "Cluster metrics",
    views: 1,
    panels: 1,
    modified: 1,
  },
  text: "title: Cluster metrics\n",
  problems: [],
  dashboard: {
    title: "Cluster metrics",
    range: "now-6h",
    live: false,
    inputs: [
      {
        name: "cluster",
        label: "cluster",
        type: "choice",
        default: "prod-sg",
        options: ["prod-sg", "prod-us", "staging-sg"],
      },
    ],
    views: [
      { name: "Overview", panels: [{ kind: "text", width: 12, text: "Nodes of ${cluster}" }] },
    ],
  },
};

test("a dashboard that a reply links to opens beside the thread with the agent's values; the reader's changes are steps Back undoes, the thread keeps it, and the thread's agent changes it in place", async () => {
  const link = (name: string) =>
    `${location.origin}/dashboards/personal/cluster?var-cluster=${name}&from=now-6h&to=now`;
  const reply = [
    "node-3 ran out of memory at 22:41, and the API's p99 went with it.",
    "",
    `[Cluster metrics · prod-sg](${link("prod-sg")})`,
    "",
    "prod-us stayed flat.",
    "",
    `[Cluster metrics · prod-us](${link("prod-us")})`,
  ].join("\n");
  const host = createHost([sessionThread(Date.now())]);
  const windows = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/sessions/claude-s1/events") {
      const said = {
        at: 6000,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "m2",
          content: { type: "text", text: reply },
        },
      };
      return stream(
        init,
        `event: reset\ndata: ${JSON.stringify({ events: [...events, said], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      );
    }
    if (url.pathname === "/api/windows")
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            windows.add(controller);
            init?.signal?.addEventListener("abort", () => {
              windows.delete(controller);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    return host.fetcher(input, init);
  };
  // The dashboard's page reads through the window's own fetch.
  const kept: { values: Record<string, string>; by?: string }[] = [];
  const reports: { values: Record<string, string>; showing: boolean }[] = [];
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/dashboards/read") return Response.json(cluster);
    if (url.pathname === "/api/dashboards/history") return Response.json({ entries: [] });
    if (url.pathname === "/api/dashboards/history/keep") {
      kept.push(body);
      return Response.json({ entries: [] });
    }
    if (url.pathname === "/api/dashboards/report") {
      reports.push(body);
      return Response.json({});
    }
    // The host's other routes are the fake's; the page's own files, the test server's.
    return url.pathname.startsWith("/api/") ? fetcher(input, init) : original(input, init);
  });
  /** The agent's `med dashboard open`, as the host tells the windows. */
  const agentShows = (path: string, thread?: string) => {
    const event = JSON.stringify({ type: "show", path, ...(thread ? { thread } : {}) });
    for (const controller of windows)
      controller.enqueue(new TextEncoder().encode(`event: show\ndata: ${event}\n\n`));
  };
  const app = { ...host, fetcher };
  render(app);
  // Room for the session's rail beside the dashboard.
  await page.viewport(2600, 900);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );

  // A link on a line of its own is the dashboard's card, with its values;
  // the rail lists the thread's dashboards, newest first.
  const card = page.getByRole("button", { name: "Open the dashboard: Cluster metrics · prod-sg" });
  // (The reply renders in a worker, which a busy test run slows.)
  await expect.element(card, { timeout: 15_000 }).toBeVisible();
  expect(card.element().textContent).toBe(
    "Cluster metrics · prod-sgprod-sg · Last 6 hoursOpen beside",
  );
  const rail = page.getByRole("region", { name: "Dashboards" });
  await expect
    .poll(() => [...rail.element().querySelectorAll("button")].map((row) => row.textContent))
    .toEqual([
      expect.stringContaining("Cluster metrics · prod-us"),
      expect.stringContaining("Cluster metrics · prod-sg"),
    ]);

  // The card opens it beside the thread, with the agent's values.
  await card.click();
  const pane = page.getByRole("region", { name: "Dashboard" });
  const text = () => pane.element().querySelector("[data-dashboard-panel] p")?.textContent;
  await expect.poll(text).toBe("Nodes of prod-sg");
  expect(location.pathname).toBe("/review/claude-s1");
  await expect.poll(() => card.element().textContent).toMatch(/Beside$/);
  // History says that the agent chose them; `med dashboard` names it.
  await expect
    .poll(() => kept[0], { timeout: 3_000 })
    .toEqual({
      id: "personal/cluster",
      values: { cluster: "prod-sg", from: "now-6h", to: "now" },
      by: "agent",
    });
  expect(reports.at(-1)).toMatchObject({ values: { cluster: "prod-sg" }, showing: true });

  // The reader's change is a step: Back undoes it, and Back again closes it.
  await pane.getByRole("combobox", { name: "cluster" }).click();
  await page.getByRole("option", { name: "staging-sg" }).click();
  await expect.poll(text).toBe("Nodes of staging-sg");
  history.back();
  await expect.poll(text).toBe("Nodes of prod-sg");
  history.back();
  // (A pane stays mounted once shown, out of sight.)
  const paneShown = () =>
    !!document
      .querySelector("[data-dashboard-pane]")
      ?.checkVisibility({ visibilityProperty: true });
  await expect.poll(paneShown).toBe(false);
  history.forward();
  await expect.poll(paneShown).toBe(true);
  await expect.poll(text).toBe("Nodes of prod-sg");

  // The thread's agent shows another cluster: it changes in place, and
  // the window stays on the thread.
  agentShows("/dashboards/personal/cluster?var-cluster=prod-us&from=now-6h&to=now", "claude-s1");
  await expect.poll(text).toBe("Nodes of prod-us");
  expect(location.pathname).toBe("/review/claude-s1");

  // Too narrow for the rail beside it: the pane's own menu lists them.
  await page.viewport(1400, 900);
  await expect.poll(() => rail.query()?.checkVisibility() ?? false).toBe(false);
  await pane.getByRole("button", { name: "This thread's dashboards" }).click();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Cluster metrics · prod-us" }))
    .toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Cluster metrics · prod-sg" }).click();
  await expect.poll(text).toBe("Nodes of prod-sg");

  // The thread keeps it: after a reload, it is beside the thread again.
  await new Promise((done) => setTimeout(done, 300));
  root!.unmount();
  mount!.remove();
  render(app);
  await expect
    .poll(
      () => document.querySelector("[data-dashboard-pane] [data-dashboard-panel] p")?.textContent,
    )
    .toBe("Nodes of prod-sg");

  // An agent of another thread shows it as the window's page: the window
  // that the reader used last, as this one is once it has focus again.
  window.dispatchEvent(new Event("focus"));
  await expect.poll(() => windows.size).toBe(1);
  agentShows("/dashboards/personal/cluster?var-cluster=staging-sg", "claude-other");
  await expect.poll(() => location.pathname).toBe("/dashboards/personal/cluster");
  expect(new URLSearchParams(location.search).get("var-cluster")).toBe("staging-sg");
  // While that page covers the thread, the thread's own agent changes the
  // page, as the Superagent does from the page's ask bar.
  agentShows("/dashboards/personal/cluster?var-cluster=prod-us", "claude-s1");
  await expect.poll(() => new URLSearchParams(location.search).get("var-cluster")).toBe("prod-us");
}, 40_000);
