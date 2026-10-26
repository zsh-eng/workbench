import type { Session, User } from "better-auth/types";
/** Each app's records and files. `arctic-content` holds Arctic's article
 * text, `arctic-annotations` its highlights and notes, and `arctic-reading`
 * its reading sessions; native Arctic's library reads only `arctic`, so each
 * new record family has its own namespace. */
export const NAMESPACES = [
  "reader",
  "spaced",
  "arctic",
  "arctic-content",
  "arctic-annotations",
  "arctic-reading",
] as const;
/** Namespaces that sync records only. */
export const RECORDS_ONLY: readonly Namespace[] = [
  "arctic",
  "arctic-annotations",
  "arctic-reading",
];
export type Namespace = (typeof NAMESPACES)[number];
export const isNamespace = (value: string): value is Namespace =>
  (NAMESPACES as readonly string[]).includes(value);
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
    /** Set when a Workbench Backup credential (`wb`) authenticated the request. */
    cli?: boolean;
    namespace: Namespace;
    scope: { origin: string; userId: string; namespace: string; epoch: string };
  };
};
export const trustedOrigins = (env: Bindings) => [
  env.BASE_URL,
  ...env.APP_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];
