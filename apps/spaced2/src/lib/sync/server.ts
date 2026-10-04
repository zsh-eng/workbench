import { API_BASE, SHARED_API_ORIGIN } from "@/lib/api";
import {
  syncPullResponseSchema,
  readSyncPullStream,
  syncPushResponseSchema,
  type SyncRemote,
  type SyncClientStateStore,
  createNamespacedHttpClient,
} from "@zsh-eng/local-sync";

export function createRemote(
  signal: AbortSignal,
  stateStore?: SyncClientStateStore,
): SyncRemote {
  if (SHARED_API_ORIGIN) {
    if (!stateStore)
      throw new Error("Shared sync requires a local state store");
    return createNamespacedHttpClient({
      origin: SHARED_API_ORIGIN,
      namespace: "spaced",
      stateStore,
      signal,
    }).remote;
  }
  let supportsStreaming = true;
  const request = async (
    path: string,
    deviceId: string,
    body?: unknown,
    requestSignal = signal,
  ) => {
    const response = await fetch(`${API_BASE}/sync/v2/${path}`, {
      credentials: "include",
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(15000)]),
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-ID": deviceId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    signal.throwIfAborted();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Sign in to sync"
          : `Sync failed (${response.status}). The server must be migrated first.`,
      );
    return response.json();
  };
  return {
    async pull(deviceId, query) {
      const params = new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      );
      return syncPullResponseSchema.parse(
        await request(`pull?${params}`, deviceId),
      );
    },
    async *pullStream(deviceId, query, streamSignal) {
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      );
      const streamLifetime = AbortSignal.any([signal, streamSignal]);
      if (!supportsStreaming) {
        yield syncPullResponseSchema.parse(
          await request(`pull?${params}`, deviceId, undefined, streamLifetime),
        );
        return;
      }
      const headersDeadline = new AbortController();
      const combinedSignal = AbortSignal.any([
        signal,
        streamSignal,
        headersDeadline.signal,
      ]);
      const timer = setTimeout(
        () => headersDeadline.abort(new Error("Sync response timeout")),
        15000,
      );
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/sync/v2/pull-stream?${params}`, {
          credentials: "include",
          signal: combinedSignal,
          headers: { "X-Device-ID": deviceId },
        });
      } finally {
        clearTimeout(timer);
      }
      combinedSignal.throwIfAborted();
      // Old servers can still serve the ordinary paginated protocol. Do not
      // downgrade auth failures, broken streams, or server errors silently.
      if (response.status === 404 || response.status === 405) {
        supportsStreaming = false;
        await response.body?.cancel();
        yield syncPullResponseSchema.parse(
          await request(`pull?${params}`, deviceId, undefined, combinedSignal),
        );
        return;
      }
      yield* readSyncPullStream(response, combinedSignal);
    },
    async push(deviceId, changes) {
      return syncPushResponseSchema.parse(
        await request("push", deviceId, { changes }),
      );
    },
  };
}
