// The explicit shared profile keeps local data separate from existing installations.
export const SHARED_API_ORIGIN = import.meta.env?.VITE_SHARED_API_URL
  ? new URL(import.meta.env.VITE_SHARED_API_URL).origin
  : "";
export const SHARED_STORAGE_SUFFIX = SHARED_API_ORIGIN
  ? `:shared:${SHARED_API_ORIGIN}`
  : "";
export const AUTH_API_BASE = SHARED_API_ORIGIN
  ? `${SHARED_API_ORIGIN}/api`
  : "/api";
export const API_BASE = SHARED_API_ORIGIN
  ? `${AUTH_API_BASE}/apps/spaced`
  : "/api";
