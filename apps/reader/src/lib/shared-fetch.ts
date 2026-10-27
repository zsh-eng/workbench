import { createNamespacedHttpClient, SyncHttpError } from "@zsh-eng/local-sync";
import { SHARED_API_ORIGIN } from "./shared-api";
import { getOrCreateDeviceId } from "./device";
import {
  getOrCreateSyncClientState,
  readerSyncStateStore,
} from "./sync-v2/client-state";

/**
 * One client for the page's file and account requests. Each request sends
 * the scope that sync bound, and the server refuses it (409) if the account
 * or its sync epoch has changed since. Asking for the scope before every
 * request cost a round trip each, and the browser sends identical requests
 * one at a time, so a new device's covers downloaded one after another.
 */
let client: ReturnType<typeof createNamespacedHttpClient> | undefined;

export function readerApiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!SHARED_API_ORIGIN) return fetch(input, init);
  getOrCreateSyncClientState(getOrCreateDeviceId());
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    window.location.origin,
  );
  client ??= createNamespacedHttpClient({
    origin: SHARED_API_ORIGIN,
    namespace: "reader",
    stateStore: readerSyncStateStore(),
  });
  return client
    .request(url.pathname.replace(/^\/api/, "") + url.search, init, false)
    .catch((error: unknown) => {
      // Preserve fetch semantics for Hono callers and the file manager's 401/404 handling.
      if (error instanceof SyncHttpError && error.response)
        return error.response;
      throw error;
    });
}
