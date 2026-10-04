import { readerApiFetch } from "./shared-fetch";
import { getLabRuntime } from "@/features/sync-lab/runtime";
import type { AppType } from "@server/index";
import { hc } from "hono/client";
import { getOrCreateDeviceId } from "./device";

export const honoClient = hc<AppType>(import.meta.env.BASE_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    if (getLabRuntime())
      return Promise.reject(
        new Error("Production API requests are disabled in Sync Lab."),
      );
    return readerApiFetch(input, init);
  },
  init: {
    credentials: "include",
  },
  headers: () => ({
    "X-Device-ID": getOrCreateDeviceId(),
  }),
});
