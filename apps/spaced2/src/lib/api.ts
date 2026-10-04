// Fresh shared-profile storage keeps the previous local databases intact.
const sharedApi =
  import.meta.env?.VITE_SHARED_API_URL ??
  (import.meta.env?.PROD ? "https://api.zsheng.app" : "");
export const SHARED_API_ORIGIN = sharedApi ? new URL(sharedApi).origin : "";
export const SHARED_STORAGE_SUFFIX = SHARED_API_ORIGIN
  ? `:shared:${SHARED_API_ORIGIN}`
  : "";
export const AUTH_API_BASE = SHARED_API_ORIGIN
  ? `${SHARED_API_ORIGIN}/api`
  : "/api";
export const API_BASE = SHARED_API_ORIGIN
  ? `${AUTH_API_BASE}/apps/spaced`
  : "/api";
