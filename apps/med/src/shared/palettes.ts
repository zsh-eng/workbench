import { z } from "zod";
import type { RouteContract } from "./routes";

// Custom palettes (`*.palette.yaml`): Raycast / Sourcegraph-style Tab-to-scope
// palettes backed by local commands, files, or static lists with stale-while-
// revalidate disk caching and zoxide-style frecency ranking.
//
//   title: Deployments
//   keyword: deploy
//   steps:
//     - name: env
//       placeholder: Environment
//       cache: 24h
//       source:
//         command: work-deploy list-envs --json
//         value: id
//         label: name
//     - name: product
//       placeholder: Product
//       cache: 6h
//       dependsOn: [env]
//       source:
//         command: work-deploy list-products --env "$MED_PALETTE_ENV" --json
//         value: slug
//         label: name
//         subtitle: team
//   actions:
//     - label: Open deployment status
//       default: true
//       openUrl: https://deploy.internal/${env}/${product}
//     - label: Open service dashboard
//       openMed: /dashboards/work/service-health?env=${env}&service=${product}
//     - label: Copy CLI status command
//       copy: "work-deploy status ${env} ${product}"

export const PALETTE_SUFFIX = ".palette.yaml";

const paletteItemSourceSchema = z.object({
  /** Inline static choices (string or { value, label, subtitle, keywords }). */
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        subtitle: z.string().optional(),
        keywords: z.string().optional(),
      }),
    )
    .optional(),
  /** Local file (CSV, JSON, JSONL, or one value per line). */
  file: z.string().optional(),
  /** Local shell command printing JSON array, JSONL, CSV, or lines. */
  command: z.string().optional(),
  /** Field or column names for structured output. */
  value: z.string().optional(),
  label: z.string().optional(),
  subtitle: z.string().optional(),
  keywords: z.string().optional(),
});
export type PaletteItemSource = z.infer<typeof paletteItemSourceSchema>;

export const paletteStepSchema = z.object({
  name: z.string(),
  placeholder: z.string(),
  /** Cache TTL in milliseconds (defaults to 6h for commands, 0 for static). */
  cacheMs: z.number().nonnegative(),
  /** Step names whose selected values invalidate/partition this step's cache. */
  dependsOn: z.array(z.string()).default([]),
  /** Allow typing an arbitrary value even when not in the item list. */
  allowCustom: z.boolean().default(false),
  source: paletteItemSourceSchema,
});
export type PaletteStep = z.infer<typeof paletteStepSchema>;

export const paletteActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  default: z.boolean().default(false),
  /** Open an external URL in a new tab (`${step}` placeholders substituted). */
  openUrl: z.string().optional(),
  /** Navigate inside Med (for example `/dashboards/personal/checkout?env=${env}`). */
  openMed: z.string().optional(),
  /** Copy substituted text to the clipboard. */
  copy: z.string().optional(),
  /** URL-encode substituted values inside `copy` (for copied URLs). */
  copyEncoded: z.boolean().default(false),
  /** Require confirmation before running (reserved for destructive actions). */
  confirm: z.boolean().default(false),
});
export type PaletteAction = z.infer<typeof paletteActionSchema>;

export const paletteSpecSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  keyword: z.string().optional(),
  steps: z.array(paletteStepSchema),
  actions: z.array(paletteActionSchema),
});
export type PaletteSpec = z.infer<typeof paletteSpecSchema>;

export const paletteProblemSchema = z.object({
  message: z.string(),
  line: z.number().optional(),
});
export type PaletteProblem = z.infer<typeof paletteProblemSchema>;

export const paletteEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  where: z.string(),
  relative: z.string(),
  title: z.string(),
  description: z.string().optional(),
  keyword: z.string().optional(),
  spec: paletteSpecSchema.optional(),
  problems: z.array(paletteProblemSchema),
  modified: z.number(),
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

export const paletteItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  subtitle: z.string().optional(),
  keywords: z.string().optional(),
});
export type PaletteItem = z.infer<typeof paletteItemSchema>;

export const paletteFrecencyEntrySchema = z.object({
  /** Palette ID (`personal/deployments` or `dashboard:personal/checkout`). */
  paletteId: z.string(),
  /** Canonical sorted key for the selected value tuple. */
  tupleKey: z.string(),
  /** Selected values by step name. */
  values: z.record(z.string(), z.string()),
  /** Human-readable labels by step name for display. */
  labels: z.record(z.string(), z.string()),
  /** Zoxide-style decaying hit count. */
  score: z.number().nonnegative(),
  /** Epoch ms of the most recent visit. */
  lastVisited: z.number(),
});
export type PaletteFrecencyEntry = z.infer<typeof paletteFrecencyEntrySchema>;

/** Parses a human duration such as `30s`, `15m`, `6h`, `1d` into ms, or null. */
export function parseDurationMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw !== "string") return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const scale =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;
  return Math.round(amount * scale);
}

/** Zoxide-style recency-weighted frecency score (higher ranks first). */
export function frecencyRank(
  entry: Pick<PaletteFrecencyEntry, "score" | "lastVisited">,
  now: number,
) {
  const ageMs = Math.max(0, now - entry.lastVisited);
  const hour = 3_600_000;
  const day = 86_400_000;
  const weight = ageMs < hour ? 4 : ageMs < day ? 2 : ageMs < 7 * day ? 0.5 : 0.25;
  return entry.score * weight;
}

/** Stable collision-free tuple key from step values. */
export function paletteTupleKey(values: Record<string, string>): string {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Substitutes `${stepName}` placeholders in a template string (URL-encoding inside URLs). */
export function substituteTemplate(
  template: string,
  values: Record<string, string>,
  encodeValues = false,
): string {
  return template.replace(/\$\{([A-Za-z][\w-]*)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    return encodeValues ? encodeURIComponent(value) : value;
  });
}

/** Environment variable name for a step passed to shell commands (`env` -> `MED_PALETTE_ENV`). */
export function paletteStepEnvName(name: string): string {
  return `MED_PALETTE_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

const boundedRecordSchema = z
  .record(z.string().min(1).max(256), z.string().max(4096))
  .refine((record) => Object.keys(record).length <= 32, "Too many step values");

export const paletteRoutes = {
  list: {
    method: "GET",
    path: "/api/palettes",
    input: z.object({}),
    output: z.object({
      folder: z.string(),
      palettes: z.array(paletteEntrySchema),
    }),
  },
  items: {
    method: "POST",
    path: "/api/palettes/items",
    input: z.object({
      paletteId: z.string().min(1).max(2048),
      step: z.string().min(1).max(256),
      values: boundedRecordSchema.default({}),
      refresh: z.boolean().optional(),
    }),
    output: z.object({
      items: z.array(paletteItemSchema),
      cachedAt: z.number(),
      stale: z.boolean(),
      fromCache: z.boolean(),
      error: z.string().optional(),
    }),
  },
  frecency: {
    method: "GET",
    path: "/api/palettes/frecency",
    input: z.object({}),
    output: z.object({
      entries: z.array(paletteFrecencyEntrySchema),
    }),
  },
  visit: {
    method: "POST",
    path: "/api/palettes/visit",
    input: z.object({
      paletteId: z.string().min(1).max(2048),
      values: boundedRecordSchema,
      labels: boundedRecordSchema,
    }),
    output: z.object({
      entries: z.array(paletteFrecencyEntrySchema),
    }),
  },
} as const satisfies Record<string, RouteContract>;
