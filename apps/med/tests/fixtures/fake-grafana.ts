import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for a Grafana, for tests and demos: the API paths Med calls,
// one dashboard of panels whose data has a shape (a deploy that slows
// checkout, a day of traffic, a backlog that grows), and one dashboard the
// token cannot read. It answers as Grafana 11 does, in data frames.

export const FAKE_TOKEN = "glsa_fake_0123456789abcdef";

/** A repeatable wobble for a series at a time. */
function noise(seed: string, time: number) {
  let hash = 2166136261;
  for (const char of `${seed}:${Math.round(time / 1000)}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000 - 0.5;
}

const quantiles = { "0.5": 40, "0.95": 120, "0.99": 260 } as const;
const MINUTE = 60_000;

/** When things happened, before `anchor`: a deploy that slowed checkout,
 * its rollback, and the consumer restart that drained the queue. */
export function fakeEvents(anchor: number) {
  const minute = Math.floor(anchor / MINUTE) * MINUTE;
  return {
    deploy: minute - 76 * MINUTE,
    rollback: minute - 53 * MINUTE,
    restart: minute - 41 * MINUTE,
  };
}

/** Values for a query at a time: what each panel's queries measure. */
function values(expr: string, time: number, events: ReturnType<typeof fakeEvents>) {
  const latency = /histogram_quantile\((0\.\d+)/.exec(expr)?.[1] as
    | keyof typeof quantiles
    | undefined;
  if (latency) {
    // Slower from the deploy, recovering after the rollback.
    const base = quantiles[latency];
    const tail = latency === "0.99" ? 9 : latency === "0.95" ? 3.4 : 1.4;
    const slow =
      time < events.deploy
        ? 0
        : time < events.rollback
          ? 1
          : Math.exp(-(time - events.rollback) / (7 * MINUTE));
    const spike = latency === "0.99" && noise(`${expr}spike`, time) > 0.47 ? 2.2 : 1;
    return (base * (1 + slow * (tail - 1)) * (1 + noise(expr, time) * 0.18) * spike) / 1000;
  }
  if (expr.includes("http_requests_total")) {
    const hour = new Date(time).getHours() + new Date(time).getMinutes() / 60;
    return 300 + 1100 * Math.exp(-((hour - 14) ** 2) / 10) + noise(expr, time) * 60;
  }
  if (expr.includes("queue_depth")) {
    // Ten thousand times over the slow half hour, then drained.
    const grow = (time - events.deploy) / (events.restart - events.deploy);
    const depth =
      time < events.deploy
        ? 1
        : time < events.restart
          ? 10_000 ** grow
          : 10_000 * Math.exp(-(time - events.restart) / (2.5 * MINUTE));
    return Math.max(1, 40 * depth * (1 + noise(expr, time) * 0.1));
  }
  return 0;
}

const latencyTarget = (quantile: string, legend: string) => ({
  refId: legend.toUpperCase(),
  expr: `histogram_quantile(${quantile}, sum by (le) (rate(http_request_duration_seconds_bucket{service="checkout", env="$env"}[$__rate_interval])))`,
  legendFormat: legend,
});

export const fakeDashboard = {
  uid: "checkout",
  title: "Checkout",
  templating: {
    list: [
      { name: "ds", type: "datasource", query: "prometheus", current: { value: "Prometheus" } },
      {
        name: "env",
        type: "custom",
        current: { value: "prod" },
        options: [{ value: "prod" }, { value: "staging" }],
      },
    ],
  },
  panels: [
    {
      id: 1,
      type: "row",
      title: "Requests",
      collapsed: true,
      panels: [
        {
          id: 4,
          type: "timeseries",
          title: "Latency",
          datasource: { type: "prometheus", uid: "${ds}" },
          fieldConfig: {
            defaults: {
              unit: "s",
              thresholds: { mode: "absolute", steps: [{ value: null }, { value: 0.5 }] },
              custom: { thresholdsStyle: { mode: "dashed" } },
            },
            overrides: [],
          },
          targets: [
            latencyTarget("0.5", "p50"),
            latencyTarget("0.95", "p95"),
            latencyTarget("0.99", "p99"),
          ],
        },
      ],
    },
    {
      id: 6,
      type: "timeseries",
      title: "Traffic",
      datasource: "Prometheus",
      fieldConfig: { defaults: { unit: "reqps" }, overrides: [] },
      targets: [
        {
          refId: "A",
          expr: 'sum(rate(http_requests_total{env="$env"}[5m]))',
          legendFormat: "checkout-api",
        },
      ],
    },
    {
      id: 9,
      type: "timeseries",
      title: "Queue depth",
      datasource: { type: "prometheus", uid: "prom" },
      fieldConfig: {
        defaults: { unit: "short", custom: { scaleDistribution: { type: "log", log: 10 } } },
        overrides: [],
      },
      targets: [{ refId: "A", expr: "max(queue_depth)", legendFormat: "messages" }],
    },
    {
      id: 12,
      type: "timeseries",
      title: "Reused",
      datasource: { type: "datasource", uid: "-- Dashboard --" },
      targets: [{ refId: "A", panelId: 4 }],
    },
  ],
};

export interface FakeGrafana {
  address: string;
  /** Each request's path, and each query that Grafana was asked to run. */
  requests: string[];
  queries: { expr?: string; datasource?: { uid?: string } }[];
  close(): Promise<void>;
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

/** A fake Grafana on 127.0.0.1 (or `host`), under `base`, such as "/grafana". */
export async function startFakeGrafana({
  port = 0,
  host = "127.0.0.1",
  base = "",
  token = FAKE_TOKEN,
  anchor = Date.now(),
  delay = 0,
}: {
  port?: number;
  host?: string;
  base?: string;
  token?: string;
  /** The time that events are placed before; now, by default. */
  anchor?: number;
  /** How long a query takes, in milliseconds, as a busy Grafana's would. */
  delay?: number;
} = {}): Promise<FakeGrafana> {
  const events = fakeEvents(anchor);
  const requests: string[] = [];
  const queries: FakeGrafana["queries"] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://grafana");
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (!url.pathname.startsWith(`${base}/api/`)) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Grafana</title>");
      return;
    }
    const path = url.pathname.slice(base.length);
    requests.push(path);
    if (path === "/api/health") return send(200, { database: "ok", version: "11.3.0" });
    if (request.headers.authorization !== `Bearer ${token}`)
      return send(401, { message: "Invalid API key" });
    if (path === "/api/org") return send(200, { id: 1, name: "Acme" });
    if (path === "/api/frontend/settings")
      return send(200, {
        defaultDatasource: "Prometheus",
        datasources: { Prometheus: { uid: "prom", type: "prometheus", name: "Prometheus" } },
      });
    if (path === "/api/dashboards/uid/checkout")
      return send(200, { dashboard: fakeDashboard, meta: { slug: "checkout" } });
    if (path === "/api/dashboards/uid/payments")
      return send(403, { message: "Access denied to this dashboard" });
    if (path.startsWith("/api/dashboards/uid/"))
      return send(404, { message: "Dashboard not found" });
    if (path === "/api/annotations") {
      const from = Number(url.searchParams.get("from"));
      const to = Number(url.searchParams.get("to"));
      return send(
        200,
        [
          { id: 1, time: events.deploy, text: "Deploy v412", tags: ["deploy"], panelId: 0 },
          { id: 2, time: events.rollback, text: "<b>Rollback</b> to v411", tags: [], panelId: 4 },
          { id: 3, time: events.restart, text: "Consumers restarted", panelId: 9 },
        ].filter((entry) => entry.time >= from && entry.time <= to),
      );
    }
    if (path === "/api/ds/query" && request.method === "POST") {
      const input = await body(request);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const from = Number(input.from);
      const to = Number(input.to);
      const results: Record<string, unknown> = {};
      for (const query of input.queries ?? []) {
        queries.push(query);
        if (query.datasource?.uid !== "prom") {
          results[query.refId] = {
            status: 400,
            error: `data source ${query.datasource?.uid} not found`,
          };
          continue;
        }
        const step = Math.max(query.intervalMs ?? 15_000, (to - from) / 600);
        const times: number[] = [];
        const numbers: (number | null)[] = [];
        for (let time = Math.ceil(from / step) * step; time <= to; time += step) {
          times.push(time);
          numbers.push(values(query.expr ?? "", time, events));
        }
        results[query.refId] = {
          status: 200,
          frames: [
            {
              schema: {
                refId: query.refId,
                fields: [
                  { name: "Time", type: "time" },
                  {
                    name: "Value",
                    type: "number",
                    labels: { service: "checkout" },
                    config: query.legendFormat ? { displayNameFromDS: query.legendFormat } : {},
                  },
                ],
              },
              data: { values: [times, numbers] },
            },
          ],
        };
      }
      return send(200, { results });
    }
    send(404, { message: "Not found" });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: bound } = server.address() as AddressInfo;
  return {
    address: `http://127.0.0.1:${bound}${base}`,
    requests,
    queries,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
