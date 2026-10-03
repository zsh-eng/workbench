import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./auth-schema";
import { trustedOrigins, type Bindings } from "./env";
export function createAuth(env: Bindings) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DATABASE, { schema }), {
      provider: "sqlite",
    }),
    baseURL: env.BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(env),
    advanced: { cookiePrefix: "workbench" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.LOCAL_DEVELOPMENT !== "true",
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
  });
}
