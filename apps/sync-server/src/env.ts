import type { Session, User } from "better-auth/types";
export interface Bindings {
  DATABASE: D1Database;
  FILES: R2Bucket;
  BASE_URL: string;
  APP_ORIGINS: string;
  BETTER_AUTH_SECRET: string;
  MIGRATION_MODE?: "closed";
  LOCAL_DEVELOPMENT?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: User;
    session: Session;
    namespace: "reader" | "spaced";
    scope: { origin: string; userId: string; namespace: string; epoch: string };
  };
};
export const trustedOrigins = (env: Bindings) => [
  env.BASE_URL,
  ...env.APP_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];
