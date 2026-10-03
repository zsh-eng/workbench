import { createNamespacedHttpClient, SyncHttpError } from "@zsh-eng/local-sync";
import { SHARED_API_ORIGIN } from "./shared-api";
import { getOrCreateDeviceId } from "./device";
import {
  getOrCreateSyncClientState,
  readerSyncStateStore,
} from "./sync-v2/client-state";
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
  return createNamespacedHttpClient({
    origin: SHARED_API_ORIGIN,
    namespace: "reader",
    stateStore: readerSyncStateStore(),
  })
    .request(url.pathname.replace(/^\/api/, "") + url.search, init)
    .catch((error: unknown) => {
      // Preserve fetch semantics for Hono callers and the file manager's 401/404 handling.
      if (error instanceof SyncHttpError && error.response)
        return error.response;
      throw error;
    });
}
