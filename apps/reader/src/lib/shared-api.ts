/** Opt-in local shared-service profile; production storage is not adopted implicitly. */
export const SHARED_API_ORIGIN = import.meta.env.VITE_SHARED_API_URL
  ? new URL(import.meta.env.VITE_SHARED_API_URL).origin
  : "";
export const SHARED_STORAGE_SUFFIX = SHARED_API_ORIGIN
  ? `:shared:${SHARED_API_ORIGIN}`
  : "";
