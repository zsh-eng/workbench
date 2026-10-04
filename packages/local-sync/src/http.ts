import { bindSyncScope, type SyncClientStateStore } from "./client-state.js";
import {
  syncScopeSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncScope,
} from "./protocol.js";
import type { SyncRemote } from "./storage.js";
import { readSyncPullStream } from "./stream.js";

export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly response?: Response,
  ) {
    super(`Shared API request failed (${status})`);
  }
}

/** One transport per local store. The server authenticates every request. */
export function createNamespacedHttpClient(options: {
  origin: string;
  namespace: string;
  stateStore: SyncClientStateStore;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}) {
  const origin = new URL(options.origin).origin;
  const base = `${origin}/api/apps/${encodeURIComponent(options.namespace)}`;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  let scope: SyncScope | undefined;
  const signal = (other?: AbortSignal | null) =>
    AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      ...(other ? [other] : []),
      AbortSignal.timeout(30_000),
    ]);
  async function getScope() {
    const response = await send(`${base}/sync/v3/state`, {
      credentials: "include",
      signal: signal(),
    });
    if (!response.ok) throw new SyncHttpError(response.status, response);
    const next = syncScopeSchema.parse(await response.json());
    if (next.origin !== origin || next.namespace !== options.namespace)
      throw new Error("Incorrect sync server scope");
    options.signal?.throwIfAborted();
    bindSyncScope(options.stateStore, next);
    scope = next;
    return next;
  }
  async function request(path: string, init: RequestInit = {}, refresh = true) {
    const expected = refresh || !scope ? await getScope() : scope;
    const headers = new Headers(init.headers);
    headers.set("X-Sync-Scope", JSON.stringify(expected));
    const response = await send(`${base}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: signal(init.signal),
    });
    options.signal?.throwIfAborted();
    bindSyncScope(options.stateStore, expected);
    if (!response.ok) throw new SyncHttpError(response.status, response);
    if (response.headers.get("X-Sync-Scope") !== JSON.stringify(expected))
      throw new Error("Sync response scope changed");
    return response;
  }
  const remote: SyncRemote = {
    getScope,
    async pull(deviceId, query) {
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      );
      return syncPullResponseSchema.parse(
        await (
          await request(
            `/sync/v3/pull?${params}`,
            { headers: { "X-Device-ID": deviceId } },
            false,
          )
        ).json(),
      );
    },
    async *pullStream(deviceId, query, streamSignal) {
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      );
      const response = await request(
        `/sync/v3/pull-stream?${params}`,
        { headers: { "X-Device-ID": deviceId }, signal: streamSignal },
        false,
      );
      for await (const page of readSyncPullStream(response, streamSignal)) {
        bindSyncScope(options.stateStore, scope!);
        yield page;
      }
    },
    async push(deviceId, changes) {
      return syncPushResponseSchema.parse(
        await (
          await request(
            "/sync/v3/push",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Device-ID": deviceId,
              },
              body: JSON.stringify({ changes }),
            },
            false,
          )
        ).json(),
      );
    },
  };
  return { remote, request };
}
