import { z } from "zod";
import type { RouteContract } from "./routes";
import { threadUsageSchema } from "./model-usage";

// The Usage page: what every session on this Mac spent in a range of days,
// by day, agent and model (usage-report.ts on the host).

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One day's requests of one model in one agent. */
export const usageRowSchema = z.object({
  day,
  /** The agent's ID, such as claude, codex, agy or pi. */
  agent: z.string(),
  /** The model's canonical ID. */
  model: z.string(),
  requests: z.number(),
  /** Input that no cache served. */
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  /** Dollars, of the requests with a price. */
  cost: z.number(),
  /** Requests without a price, in Med's table or the agent's. */
  unpriced: z.number(),
  /** Requests at the agent's own price, for a model that Med has none for. */
  agentPriced: z.number(),
});
export type UsageRow = z.infer<typeof usageRowSchema>;

export const usageReportSchema = z.object({
  from: day,
  to: day,
  rows: z.array(usageRowSchema),
  /** How many files Med read for the range. */
  files: z.number(),
  prices: threadUsageSchema.shape.prices,
});
export type UsageReport = z.infer<typeof usageReportSchema>;

export const usageReportRoutes = {
  /** The spend of the days from `from` to `to`, both included, in the host's time zone. */
  report: {
    method: "GET",
    path: "/api/usage",
    input: z.object({ from: day, to: day }),
    output: usageReportSchema,
  },
} as const satisfies Record<string, RouteContract>;
