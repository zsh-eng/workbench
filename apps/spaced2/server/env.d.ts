interface Env {
  SYNC_CUTOVER_MODE?: "freeze" | "retired";
  DATABASE: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MAIL_MODE?: "console" | "resend";
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
