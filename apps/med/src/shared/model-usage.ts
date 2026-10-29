import { z } from "zod";
import prices from "./model-prices.json";
import type { RouteContract } from "./routes";

// What a thread's agents spent and how full the current session's context
// is (docs/SESSIONS.md#spend-and-context). The host reads both from the
// transcripts (src/host/session-usage.ts); this file holds the price table
// and the rules that the host and the page share.

/** A model's price per million tokens (model-prices.json). */
export interface ModelPrice {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  fast?: { input: number; output: number };
  longContext?: { over: number } & Omit<ModelPrice, "fast" | "longContext">;
}

const table = prices as {
  version: number;
  source: string;
  readAt: string;
  webSearchPerThousand: number;
  dataResidency: number;
  models: Record<string, ModelPrice>;
};

/** Where the prices come from, for the page to say. */
export const PRICE_TABLE = { version: table.version, source: table.source, readAt: table.readAt };

/**
 * The canonical ID of a model ID as a transcript or a provider writes it:
 * without `[1m]`, a provider's prefix (`us.anthropic.`), a Bedrock version
 * (`-v1:0`), or a snapshot date (`-20251001`, `@20251001`).
 */
export function canonicalModel(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "")
    .replace(/^(?:[a-z]+\.)?anthropic\./, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/[-@]\d{8}$/, "");
}

/** The model's list price, or undefined for a model that the table lacks. */
export const priceOf = (model: string): ModelPrice | undefined =>
  table.models[canonicalModel(model)];

/** One API request's tokens, as the Messages API reports its `usage`. */
export interface RequestTokens {
  input: number;
  output: number;
  /** Cache writes with a 5-minute and a 1-hour lifetime. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  webSearches: number;
  /** `usage.speed`: "fast" for fast mode. */
  speed?: string;
  /** `usage.inference_geo`: "us" costs more. */
  geo?: string;
}

/** A request's cost in dollars at list price, or undefined for a model without a price. */
export function requestCost(model: string, tokens: RequestTokens): number | undefined {
  const price = priceOf(model);
  if (!price) return undefined;
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;
  let rates: Omit<ModelPrice, "fast" | "longContext"> =
    price.longContext && prompt > price.longContext.over ? price.longContext : price;
  if (tokens.speed === "fast" && price.fast) {
    // Fast mode prices input and output; caching keeps its multipliers.
    const scale = price.fast.input / price.input;
    rates = {
      input: price.fast.input,
      output: price.fast.output,
      cacheWrite5m: price.cacheWrite5m * scale,
      cacheWrite1h: price.cacheWrite1h * scale,
      cacheRead: price.cacheRead * scale,
    };
  }
  const geo = tokens.geo === "us" ? table.dataResidency : 1;
  return (
    ((tokens.input * rates.input +
      tokens.output * rates.output +
      tokens.cacheWrite5m * rates.cacheWrite5m +
      tokens.cacheWrite1h * rates.cacheWrite1h +
      tokens.cacheRead * rates.cacheRead) /
      1_000_000) *
      geo +
    (tokens.webSearches * table.webSearchPerThousand) / 1000
  );
}

/**
 * A Claude model's context window in Claude Code, from
 * https://code.claude.com/docs/en/model-config: 1M for the Fable and Mythos
 * models, Opus 4.7 and later, Sonnet 5 and later, and Haiku 5.5; Opus 4.6
 * and Sonnet 4.6 have 200K unless the session asks for `[1m]`, which a
 * transcript does not record. Claude Code assumes 200K for a model that it
 * does not know.
 */
export function claudeWindow(model: string): { size: number; known: boolean } {
  const id = canonicalModel(model);
  const native =
    /^claude-(?:fable|mythos)-/.test(id) ||
    /^claude-opus-(?:4-[7-9]|[5-9])/.test(id) ||
    /^claude-sonnet-[5-9]/.test(id) ||
    /^claude-haiku-(?:5-5|[6-9])/.test(id);
  return { size: native ? 1_000_000 : 200_000, known: native || !!priceOf(id) };
}

/** Where Claude Code compacts when nothing sets the window: at about 967K
 * on a model with a native 1M window, else at the window's end
 * (https://code.claude.com/docs/en/model-config#default-auto-compact-thresholds). */
export const defaultCompaction = (window: number) => (window >= 1_000_000 ? 967_000 : window);

const tokensSchema = z.object({
  /** Input tokens that were not read from the cache. */
  input: z.number(),
  output: z.number(),
  cacheWrite5m: z.number(),
  cacheWrite1h: z.number(),
  cacheRead: z.number(),
  webSearches: z.number(),
});
export type TokenCounts = z.infer<typeof tokensSchema>;

export const threadUsageSchema = z.object({
  /** How full the current session's context is, after its last request. */
  context: z
    .object({
      sessionId: z.string(),
      agent: z.enum(["claude", "codex"]),
      model: z.string().optional(),
      /** Tokens that the last request sent: its input, cache reads, and cache writes. */
      used: z.number(),
      window: z.number(),
      /** `agent`: the agent reported the window. `model`: Med's table for
       * the model. `assumed`: a model that Med does not know. */
      windowFrom: z.enum(["agent", "model", "assumed"]),
      /** Where the agent compacts on its own. */
      compaction: z
        .object({
          /** Tokens; none when the agent does not compact by itself. */
          at: z.number().optional(),
          /** What sets it, such as "modelSettings in ~/.claude/settings.json". */
          from: z.string(),
          /** The agent's own default, which Med knows only about. */
          approximate: z.boolean(),
        })
        .optional(),
      /** The session compacted after its last request; the next one tells the new size. */
      compacted: z.boolean(),
      /** When the last request ended. */
      at: z.number().optional(),
    })
    .optional(),
  spend: z.object({
    /** Dollars at list price, for the requests of models with a price. */
    total: z.number(),
    /** Of the total, what subagents spent, and how many ran. */
    subagents: z.object({ count: z.number(), cost: z.number() }),
    models: z.array(
      tokensSchema.extend({
        model: z.string(),
        requests: z.number(),
        /** Null for a model without a price, such as Codex's. */
        cost: z.number().nullable(),
      }),
    ),
    /** Sessions whose transcripts have no token counts, such as ACP agents'. */
    missing: z.array(z.string()),
  }),
  prices: z.object({ version: z.number(), source: z.string(), readAt: z.string() }),
});
export type ThreadUsage = z.infer<typeof threadUsageSchema>;

export const usageRoutes = {
  /** A thread's spend, and the context of `session`, or of its latest session. */
  thread: {
    method: "GET",
    path: "/api/thread-usage",
    input: z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
      session: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
    }),
    output: threadUsageSchema,
  },
} as const satisfies Record<string, RouteContract>;
