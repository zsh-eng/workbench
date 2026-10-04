/** Production uses shared sync; an explicit empty override retains the legacy profile. */
const sharedApi =
  import.meta.env.VITE_SHARED_API_URL ??
  (import.meta.env.PROD ? "https://api.zsheng.app" : "");
export const SHARED_API_ORIGIN = sharedApi ? new URL(sharedApi).origin : "";
export const SHARED_STORAGE_SUFFIX = SHARED_API_ORIGIN
  ? `:shared:${SHARED_API_ORIGIN}`
  : "";
