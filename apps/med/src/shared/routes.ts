import type { z } from "zod";

/**
 * One HTTP route, as the host and the browser both read it. The host parses
 * `input` from the query of a GET or the JSON body of a POST; its handler must
 * answer with `output`'s shape, which the browser parses.
 */
export interface RouteContract<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  method: "GET" | "POST";
  path: `/api/${string}`;
  input: I;
  output: O;
  /** The most bytes a POST body may have. The host's default is 128 KB. */
  maxBody?: number;
}
