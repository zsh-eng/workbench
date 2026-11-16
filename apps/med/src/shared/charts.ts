import { z } from "zod";
import type { RouteContract } from "./routes";

// A chart in a reply can draw a Grafana panel. Med's server reads the panel
// with a token from Settings, which never reaches the page or an agent.

const point = z.tuple([z.number(), z.number().nullable()]);

/** A Grafana panel's data, as Med draws it. */
export const grafanaPanelSchema = z.object({
  /** The panel's title, and its dashboard's. */
  title: z.string(),
  dashboard: z.string(),
  /** In Med's terms: ms, s, %, B, or a word such as req/s. */
  unit: z.string().optional(),
  scale: z.enum(["linear", "log"]).optional(),
  /** A level that the panel draws as a line; the chart labels it with its value. */
  threshold: z.object({ value: z.number(), label: z.string() }).optional(),
  marks: z.array(z.object({ at: z.number(), label: z.string() })),
  series: z.array(z.object({ name: z.string(), points: z.array(point) })),
  /** The range that Med asked for, in milliseconds. */
  range: z.tuple([z.number(), z.number()]),
  /** The range ends now, and each fetch moves it. */
  live: z.boolean(),
  /** When Med read it from Grafana. */
  fetched: z.number(),
  /** The panel in Grafana, over this range. */
  link: z.string(),
  /** What Med left out, such as the panel's transformations. */
  notes: z.array(z.string()),
});
export type GrafanaPanel = z.infer<typeof grafanaPanelSchema>;

/** A Grafana in Settings: its address, and whether Med holds its token. */
export const grafanaSiteSchema = z.object({
  address: z.string(),
  token: z.boolean(),
  /** The token's last four characters, to tell two apart. */
  hint: z.string().optional(),
});
export type GrafanaSite = z.infer<typeof grafanaSiteSchema>;

const address = z.string().min(1).max(2048);

export const chartRoutes = {
  /** A panel's data, over the link's range. A range relative to now, such as
   * `now-6h`, counts from `at`, the reply's time, unless `live`. Med keeps
   * what it read, so the chart shows the same data later; `refresh` reads
   * Grafana again. */
  grafana: {
    method: "POST",
    path: "/api/charts/grafana",
    input: z.object({
      link: z.string().min(1).max(8192),
      at: z.number().optional(),
      from: z.string().max(64).optional(),
      to: z.string().max(64).optional(),
      live: z.boolean().optional(),
      refresh: z.boolean().optional(),
    }),
    output: grafanaPanelSchema,
  },
  /** The Grafanas in Settings. */
  sites: {
    method: "GET",
    path: "/api/grafana",
    input: z.object({}),
    output: z.object({ sites: z.array(grafanaSiteSchema) }),
  },
  /** Checks an address and a token with Grafana, then keeps both. A token
   * left out keeps the one Med holds. */
  connect: {
    method: "POST",
    path: "/api/grafana/connect",
    input: z.object({ address, token: z.string().max(4096).optional() }),
    output: z.object({
      site: grafanaSiteSchema,
      /** Grafana's version, and the organization that the token reads. */
      version: z.string().optional(),
      organization: z.string().optional(),
    }),
  },
  /** Forgets a Grafana and its token. */
  remove: {
    method: "POST",
    path: "/api/grafana/remove",
    input: z.object({ address }),
    output: z.object({ sites: z.array(grafanaSiteSchema) }),
  },
} as const satisfies Record<string, RouteContract>;
