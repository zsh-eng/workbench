import { createNamespacedHttpClient, SyncHttpError } from "@zsh-eng/local-sync";
import { SHARED_API_ORIGIN } from "../api";
import { persistenceReady, stateStore } from "../db/persistence";

let client: ReturnType<typeof createNamespacedHttpClient> | undefined;

/**
 * A request to Spaced's shared files, answered with any status. One client
 * keeps the account's scope, so a read does not ask for it first; the server
 * still refuses a changed account (409). A write checks the scope first, and
 * so does a read after sign-out cleared the stored scope, so that it never
 * binds the last account's scope to a new state.
 */
export async function requestSharedFile(path: string, init?: RequestInit) {
  await persistenceReady;
  client ??= createNamespacedHttpClient({
    origin: SHARED_API_ORIGIN,
    namespace: "spaced",
    stateStore,
  });
  const read =
    ["GET", "HEAD"].includes(init?.method ?? "GET") || path === "/files/batch";
  return client
    .request(path, init, !read || !stateStore.read()?.scope)
    .catch((error: unknown) => {
      if (error instanceof SyncHttpError && error.response)
        return error.response;
      throw error;
    });
}

/** Many files in one streamed answer (packages/file-batch). */
export const requestSharedFileBatch = (ids: string[], signal: AbortSignal) =>
  requestSharedFile("/files/batch", {
    method: "POST",
    body: JSON.stringify({ ids }),
    headers: { "Content-Type": "application/json" },
    signal,
  });
