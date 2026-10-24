import type { z } from "zod";
import type { RouteContract } from "../shared/routes";

/** What a route's handler gets besides its input: the request's checks. */
export interface RouteContext {
  signal: AbortSignal;
  /** The registered repository for a path, or the default one for null. */
  requireRepo(path: string | null): Promise<string>;
}

export interface Route {
  contract: RouteContract;
  handle(input: unknown, context: RouteContext): Promise<unknown>;
}

/** A handler for a contract. It gets the parsed input, and the type checker
 * holds its answer to the shape that the browser parses. */
export function route<C extends RouteContract>(
  contract: C,
  handle: (input: z.output<C["input"]>, context: RouteContext) => Promise<z.input<C["output"]>>,
): Route {
  return { contract, handle: handle as Route["handle"] };
}

/** Finds a request's route by method and path in one lookup. */
export function routeTable(routes: readonly Route[]) {
  const byKey = new Map<string, Route>();
  for (const entry of routes) {
    const key = `${entry.contract.method} ${entry.contract.path}`;
    if (byKey.has(key)) throw new Error(`Two routes for ${key}.`);
    byKey.set(key, entry);
  }
  return {
    find(method: string | undefined, path: string) {
      const entry = byKey.get(`${method} ${path}`);
      if (!entry) return undefined;
      return async (
        url: URL,
        body: (limit?: number) => Promise<unknown>,
        context: RouteContext,
      ) => {
        const raw =
          entry.contract.method === "GET"
            ? Object.fromEntries(url.searchParams)
            : await body(entry.contract.maxBody);
        return entry.handle(entry.contract.input.parse(raw), context);
      };
    },
  };
}
