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

/** The Terminal command that adds a token to the Keychain as `item`. It asks
 * for the token, so the token stays out of the shell's history. */
export const keychainCommand = (item: string) =>
  `security add-generic-password -s ${/^[\w.@-]+$/.test(item) ? item : `'${item.replaceAll("'", "'\\''")}'`} -a "$USER" -w`;

/** A Grafana in Settings: its address, and whether Med has its token. */
export const grafanaSiteSchema = z.object({
  address: z.string(),
  token: z.boolean(),
  /** A pasted token's last four characters, to tell two apart. */
  hint: z.string().optional(),
  /** The Keychain item that holds its token, which Med reads when a chart
   * needs it. */
  keychain: z.string().optional(),
});
export type GrafanaSite = z.infer<typeof grafanaSiteSchema>;

const address = z.string().min(1).max(2048);

/**
 * A chart source: links under a base address whose data a command prints.
 * Settings hold them by base (`charts.sources`). The link that a chart
 * names belongs to the longest base that it starts with, up to a `/`, `?`,
 * or `#`. A base is compared without its trailing `/`.
 */
export function chartSourceFor(sources: Record<string, string>, link: string) {
  let found: { base: string; command: string } | undefined;
  for (const [base, command] of Object.entries(sources)) {
    const stem = base.replace(/\/+$/, "");
    if (!stem || !command.trim() || !link.startsWith(stem)) continue;
    if (!/^(?:$|[/?#])/.test(link.slice(stem.length))) continue;
    if (!found || stem.length > found.base.replace(/\/+$/, "").length) found = { base, command };
  }
  return found;
}

/** A chart that a source's command printed as JSON: lines or bars, and what
 * the chart says about them. Times are milliseconds or seconds since 1970. */
export const sourceChartSchema = z
  .object({
    title: z.string().optional(),
    unit: z.string().optional(),
    scale: z.enum(["linear", "log"]).optional(),
    threshold: z.object({ value: z.number(), label: z.string().optional() }).optional(),
    marks: z.array(z.object({ at: z.number(), label: z.string() })).optional(),
    series: z.array(z.object({ name: z.string(), points: z.array(point) })).optional(),
    bars: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
    /** Where the data can be seen, if not the chart's link. */
    link: z.string().optional(),
    /** What the chart leaves out, said under it. */
    notes: z.array(z.string()).optional(),
  })
  .refine((chart) => !!chart.series || !!chart.bars, "A chart has series or bars.");
export type SourceChart = z.infer<typeof sourceChartSchema>;

/** What a chart source read for a link. */
export const linkChartSchema = z.object({
  /** The source's base, which the link starts with. */
  source: z.string(),
  /** The command's output as rows of CSV or JSON, as a file chart's. */
  rows: z.string().optional(),
  chart: sourceChartSchema.optional(),
  /** The range that Med asked for, when the block or the link names one. */
  range: z.tuple([z.number(), z.number()]).optional(),
  live: z.boolean(),
  /** When the command ran. */
  fetched: z.number(),
});
export type LinkChart = z.infer<typeof linkChartSchema>;

export const chartRoutes = {
  /** A link's data from the chart source that covers it: Med runs the
   * source's command. Med keeps what it read, as for a Grafana panel;
   * `refresh` runs the command again. */
  link: {
    method: "POST",
    path: "/api/charts/link",
    input: z.object({
      link: z.string().min(1).max(8192),
      at: z.number().optional(),
      from: z.string().max(64).optional(),
      to: z.string().max(64).optional(),
      live: z.boolean().optional(),
      refresh: z.boolean().optional(),
    }),
    output: linkChartSchema,
  },
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
  /** Checks an address and a token with Grafana, then keeps both: a pasted
   * token, or the name of the Keychain item that holds it. Neither checks
   * the token Med has. */
  connect: {
    method: "POST",
    path: "/api/grafana/connect",
    input: z.object({
      address,
      token: z.string().max(4096).optional(),
      keychain: z.string().max(255).optional(),
    }),
    output: z.object({
      site: grafanaSiteSchema,
      /** Grafana's version, and the organization that the token reads. */
      version: z.string().optional(),
      organization: z.string().optional(),
    }),
  },
  /** Forgets a Grafana, its token in Med's file, and its Keychain item's
   * name; the Keychain keeps the item. */
  remove: {
    method: "POST",
    path: "/api/grafana/remove",
    input: z.object({ address }),
    output: z.object({ sites: z.array(grafanaSiteSchema) }),
  },
} as const satisfies Record<string, RouteContract>;
