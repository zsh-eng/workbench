import { createNativeAuthRoutes } from "@workbench/arctic-sync-server/native-auth";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";

// Keep the native one-time-code protocol independent from Google credentials.
// Google still returns to this host's existing Better Auth callback.
export const nativeAuth = createNativeAuthRoutes<AppEnv>({
  sessionCookieName: "__Secure-workbench.session_token",
  database: (c) => c.env.DATABASE,
  secret: (c) => c.env.BETTER_AUTH_SECRET,
  origin: (c) => c.env.BASE_URL,
  startGoogle: (c, callbackURL, errorCallbackURL) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Content-Length");
    headers.set("Origin", new URL(c.env.BASE_URL).origin);
    return createAuth(c.env).handler(
      new Request(new URL("/api/auth/sign-in/social", c.env.BASE_URL), {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "google",
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
        }),
      }),
    );
  },
  authenticate: async (c, cookie) => {
    const session = await createAuth(c.env).api.getSession({
      headers: new Headers({ Cookie: cookie }),
    });
    return session ? { id: session.user.id, email: session.user.email } : null;
  },
});
