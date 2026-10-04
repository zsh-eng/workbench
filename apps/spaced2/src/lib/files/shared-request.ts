import { createNamespacedHttpClient, SyncHttpError } from "@zsh-eng/local-sync";
import { SHARED_API_ORIGIN } from "../api";
import { persistenceReady, stateStore } from "../db/persistence";

export async function requestSharedFile(path: string, init?: RequestInit) {
  await persistenceReady;
  return createNamespacedHttpClient({
    origin: SHARED_API_ORIGIN,
    namespace: "spaced",
    stateStore,
  })
    .request(path, init)
    .catch((error: unknown) => {
      if (error instanceof SyncHttpError && error.response)
        return error.response;
      throw error;
    });
}
