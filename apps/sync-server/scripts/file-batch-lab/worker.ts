/**
 * The shared API with the storage delays of a production colo, for timing
 * bulk downloads (docs/FILE_BATCH.md). Local only, through
 * `wrangler.lab.jsonc`. Each D1 query waits `d1Ms` first; each R2 get waits
 * `r2Ms`, at most six at a time in one request, as a deployed Worker does.
 * `POST /__lab {"d1Ms":30,"r2Ms":135,"batch":true}` sets them; `batch: false`
 * answers the batch route as a server without it does (400).
 */
import app from "../../src/index";
import type { Bindings } from "../../src/env";

const lab = { d1Ms: 0, r2Ms: 0, batch: true };
const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined;

const statements = new WeakMap<object, D1PreparedStatement>();
function statement(real: D1PreparedStatement): D1PreparedStatement {
  const proxy = new Proxy(real, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key === "bind")
        return (...values: unknown[]) => statement(value.apply(target, values));
      if (["first", "all", "run", "raw"].includes(key as string))
        return async (...args: unknown[]) => {
          await sleep(lab.d1Ms);
          return value.apply(target, args);
        };
      return value.bind(target);
    },
  });
  statements.set(proxy, real);
  return proxy;
}
function database(real: D1Database): D1Database {
  return new Proxy(real, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "prepare")
        return (sql: string) => statement(value.call(target, sql));
      if (key === "batch")
        return async (list: D1PreparedStatement[]) => {
          await sleep(lab.d1Ms);
          return value.call(
            target,
            list.map((item) => statements.get(item) ?? item),
          );
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
/** One request's bucket: six gets wait for headers at once. */
function bucket(real: R2Bucket): R2Bucket {
  let waiting = 0;
  const queue: (() => void)[] = [];
  return new Proxy(real, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key !== "get")
        return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        if (waiting >= 6) await new Promise<void>((go) => queue.push(go));
        waiting++;
        try {
          await sleep(lab.r2Ms);
          return await value.apply(target, args);
        } finally {
          waiting--;
          queue.shift()?.();
        }
      };
    },
  });
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/__lab") {
      if (request.method === "POST") Object.assign(lab, await request.json());
      return Response.json(lab);
    }
    if (!lab.batch && url.pathname.endsWith("/files/batch"))
      return Response.json(
        { error: "Invalid file ID" },
        { status: 400, headers: cors(request) },
      );
    return app.fetch(
      request,
      { ...env, DATABASE: database(env.DATABASE), FILES: bucket(env.FILES) },
      ctx,
    );
  },
};
/** An older server's 400 still carries CORS headers, so the browser reads it. */
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      }
    : {};
}
