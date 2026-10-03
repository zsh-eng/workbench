import { SHARED_API_ORIGIN } from "./shared-api";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    SHARED_API_ORIGIN ||
    import.meta.env.VITE_BETTER_AUTH_URL ||
    "http://localhost:5173",
});

export const { signIn, signOut, useSession } = authClient;
