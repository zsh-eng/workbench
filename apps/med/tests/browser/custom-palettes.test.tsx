import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { CommandDialog, type ReviewCommand } from "../../src/web/components/Controls";
import { clearPaletteClientCache } from "../../src/web/data/palettes";
import type { DashboardFile } from "../../src/shared/dashboards";
import type { PaletteEntry, PaletteFrecencyEntry } from "../../src/shared/palettes";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  clearPaletteClientCache();
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
  history.replaceState(null, "", "/");
});

const deploymentsEntry: PaletteEntry = {
  id: "personal/deployments",
  path: "/home/me/.config/med/palettes/deployments.palette.yaml",
  where: "Personal",
  relative: "deployments.palette.yaml",
  title: "Deployments",
  description: "Check environment deployments",
  keyword: "deploy",
  modified: Date.now(),
  problems: [],
  spec: {
    title: "Deployments",
    description: "Check environment deployments",
    keyword: "deploy",
    steps: [
      {
        name: "env",
        placeholder: "Environment",
        cacheMs: 86_400_000,
        dependsOn: [],
        allowCustom: false,
        source: {
          command: "work-deploy list-envs",
        },
      },
      {
        name: "product",
        placeholder: "Product",
        cacheMs: 21_600_000,
        dependsOn: ["env"],
        allowCustom: false,
        source: {
          command: "work-deploy list-products",
        },
      },
    ],
    actions: [
      {
        id: "open-dashboard",
        label: "Open service dashboard",
        default: true,
        openMed: "/dashboards/personal/service-health?var-env=${env}&var-service=${product}",
        copyEncoded: false,
        confirm: false,
      },
      {
        id: "copy-cli",
        label: "Copy deploy status command",
        default: false,
        copy: "work-deploy status ${env} ${product}",
        copyEncoded: false,
        confirm: false,
      },
    ],
  },
};

const dashboardFile: DashboardFile = {
  entry: {
    id: "personal/service-health",
    path: "/home/me/.config/med/dashboards/service-health.dashboard.yaml",
    where: "Personal",
    relative: "service-health.dashboard.yaml",
    title: "Service Health",
    description: "Latency and error rates",
    views: 2,
    panels: 3,
    modified: Date.now(),
  },
  text: "title: Service Health\n",
  problems: [],
  dashboard: {
    title: "Service Health",
    description: "Latency and error rates",
    range: "now-6h",
    live: false,
    inputs: [
      {
        name: "env",
        label: "Environment",
        type: "choice",
        default: "prod",
        options: ["prod", "staging"],
        labels: { prod: "Production", staging: "Staging" },
      },
      {
        name: "service",
        label: "Service",
        type: "choice",
        default: "checkout-api",
        options: ["checkout-api", "search-index"],
        labels: { "checkout-api": "Checkout API", "search-index": "Search Index" },
      },
    ],
    views: [
      { name: "Overview", panels: [] },
      { name: "Latency", panels: [] },
    ],
  },
};

const baseCommands: ReviewCommand[] = [
  {
    id: "open-settings",
    icon: "settings",
    group: "Settings",
    label: "Settings",
    run: () => {},
  },
];

function setupFetchMock(options?: {
  frecency?: PaletteFrecencyEntry[];
  onItems?: (body: Record<string, unknown>) => void;
  onVisit?: (body: Record<string, unknown>) => void;
}) {
  let frecency: PaletteFrecencyEntry[] = options?.frecency ?? [
    {
      paletteId: "personal/deployments",
      tupleKey: "env=prod&product=checkout-api",
      values: { env: "prod", product: "checkout-api" },
      labels: { env: "Production", product: "Checkout API" },
      score: 5,
      lastVisited: Date.now() - 60_000,
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/palettes") {
      return Response.json({
        folder: "/home/me/.config/med/palettes",
        palettes: [deploymentsEntry],
      });
    }
    if (url.pathname === "/api/palettes/frecency") {
      return Response.json({ entries: frecency });
    }
    if (url.pathname === "/api/palettes/visit") {
      options?.onVisit?.(body);
      frecency = [
        {
          paletteId: body.paletteId,
          tupleKey: Object.keys(body.values)
            .sort()
            .map((k) => `${k}=${body.values[k]}`)
            .join("&"),
          values: body.values,
          labels: body.labels,
          score: 1,
          lastVisited: Date.now(),
        },
        ...frecency,
      ];
      return Response.json({ entries: frecency });
    }
    if (url.pathname === "/api/palettes/items") {
      options?.onItems?.(body);
      if (body.step === "env") {
        return Response.json({
          items: [
            { value: "prod", label: "Production", subtitle: "us-east-1" },
            { value: "staging", label: "Staging", subtitle: "us-west-2" },
          ],
          cachedAt: Date.now() - 120_000,
          stale: false,
          fromCache: !body.refresh,
        });
      }
      if (body.step === "product") {
        const isStaging = body.values?.env === "staging";
        return Response.json({
          items: isStaging
            ? [
                { value: "billing-worker", label: "Billing Worker", subtitle: "Finance" },
                { value: "search-index", label: "Search Index", subtitle: "Discovery" },
              ]
            : [{ value: "checkout-api", label: "Checkout API", subtitle: "Payments" }],
          cachedAt: Date.now() - 120_000,
          stale: false,
          fromCache: !body.refresh,
        });
      }
    }
    if (url.pathname === "/api/dashboards") {
      return Response.json({
        folder: "/home/me/.config/med/dashboards",
        dashboards: [dashboardFile.entry],
      });
    }
    if (url.pathname === "/api/dashboards/read") {
      return Response.json(dashboardFile);
    }
    return new Response("Not found", { status: 404 });
  });
}

async function mountDialog(onOpenChange: (open: boolean) => void) {
  await page.viewport(1280, 800);
  initializeTheme();
  frame = document.createElement("div");
  document.body.append(frame);
  root = createRoot(frame);
  root.render(
    <CommandDialog open onOpenChange={onOpenChange} enablePalettes commands={baseCommands} />,
  );
}

test("Tab scopes into a custom palette, supports 0-Tab frequent jump, chip pop, refresh, and actions", async () => {
  const itemCalls: Record<string, unknown>[] = [];
  const visits: Record<string, unknown>[] = [];
  setupFetchMock({
    onItems: (body) => itemCalls.push(body),
    onVisit: (body) => visits.push(body),
  });

  let closed = false;
  await mountDialog((next) => {
    if (!next) closed = true;
  });

  // Search by keyword "deploy" -> Tab scopes into Deployments.
  const search = page.getByRole("combobox", { name: "Search commands" });
  await expect.element(search).toBeVisible();
  await userEvent.type(search, "deploy");
  await expect.element(page.getByRole("option", { name: /Deployments/ })).toBeVisible();
  await userEvent.keyboard("{Tab}");

  // Root chip appears and Frequent section shows Production › Checkout API.
  await expect
    .element(page.getByRole("button", { name: "Exit Deployments palette" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("option", { name: /Production › Checkout API/ }))
    .toBeVisible();

  // Type "st" -> Staging ranks first -> Tab locks [Staging] chip and fetches staging products.
  const scopeInput = page.getByRole("combobox", { name: "Search environment…" });
  await userEvent.type(scopeInput, "st");
  await expect
    .element(page.getByRole("option", { name: /Staging/ }))
    .toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Tab}");

  await expect.element(page.getByRole("button", { name: "Remove Staging" })).toBeVisible();
  await expect.element(page.getByRole("option", { name: /Billing Worker/ })).toBeVisible();

  // Trigger ⌘R force refresh on the active step.
  await userEvent.keyboard("{Meta>}r{/Meta}");
  await expect
    .poll(() => itemCalls.some((call) => call.step === "product" && call.refresh === true))
    .toBe(true);

  // Backspace on empty query pops [Staging] chip cleanly back to Step 0.
  await userEvent.keyboard("{Backspace}");
  await expect
    .element(page.getByRole("button", { name: "Remove Staging" }))
    .not.toBeInTheDocument();

  // Type "ch" -> 0-Tab Enter runs default openMed action for Production › Checkout API.
  const envInputAgain = page.getByRole("combobox", { name: "Search environment…" });
  await userEvent.type(envInputAgain, "ch");
  await expect
    .element(page.getByRole("option", { name: /Production › Checkout API/ }))
    .toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");

  await expect.poll(() => closed).toBe(true);
  expect(`${location.pathname}${location.search}`).toBe(
    "/dashboards/personal/service-health?var-env=prod&var-service=checkout-api",
  );
  expect(visits[0]).toMatchObject({
    paletteId: "personal/deployments",
    values: { env: "prod", product: "checkout-api" },
  });
});

test("Tab-into-Dashboard scopes inputs and views and jumps directly to pre-filled dashboard URL", async () => {
  setupFetchMock({ frecency: [] });

  let closed = false;
  await mountDialog((next) => {
    if (!next) closed = true;
  });

  const search = page.getByRole("combobox", { name: "Search commands" });
  await expect.element(search).toBeVisible();
  await userEvent.type(search, "service health");
  await expect.element(page.getByRole("option", { name: /Service Health/ })).toBeVisible();
  await userEvent.keyboard("{Tab}");

  // Step 1: Environment -> pick Staging
  const envInput = page.getByRole("combobox", { name: "Search environment…" });
  await expect.element(envInput).toBeVisible();
  await userEvent.type(envInput, "staging");
  await userEvent.keyboard("{Tab}");

  // Step 2: Service -> pick Search Index
  const serviceInput = page.getByRole("combobox", { name: "Search service…" });
  await expect.element(serviceInput).toBeVisible();
  await userEvent.type(serviceInput, "search");
  await userEvent.keyboard("{Tab}");

  // Step 3: View -> pick Latency and press Enter
  const viewInput = page.getByRole("combobox", { name: "Search view…" });
  await expect.element(viewInput).toBeVisible();
  await userEvent.type(viewInput, "latency");
  await userEvent.keyboard("{Enter}");

  await expect.poll(() => closed).toBe(true);
  expect(`${location.pathname}${location.search}`).toBe(
    "/dashboards/personal/service-health?var-env=staging&var-service=search-index&view=Latency",
  );
});

test("Command+Enter opens the Actions sub-view and runs secondary copy action", async () => {
  setupFetchMock();
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn<(text: string) => Promise<void>>(async (text) => {
        copied.push(text);
      }),
    },
  });

  let closed = false;
  await mountDialog((next) => {
    if (!next) closed = true;
  });

  const search = page.getByRole("combobox", { name: "Search commands" });
  await userEvent.type(search, "deploy");
  await userEvent.keyboard("{Tab}");

  await expect
    .element(page.getByRole("option", { name: /Production › Checkout API/ }))
    .toBeVisible();
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

  // Actions sub-view shows all actions with resolved command preview.
  await expect.element(page.getByRole("combobox", { name: "Choose action…" })).toBeVisible();
  await expect
    .element(page.getByRole("option", { name: /Copy deploy status command/ }))
    .toBeVisible();

  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => copied[0]).toBe("work-deploy status prod checkout-api");
  await expect.poll(() => closed).toBe(true);
});
