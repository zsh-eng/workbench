import { z } from "zod";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";

/** Set once a browser has seen the welcome, or already had sources. */
export const WELCOMED_KEY = "med:welcomed";

const registered = z.object({
  id: z.string(),
  kind: z.enum(["repo", "vault"]),
  path: z.string(),
  name: z.string(),
});
const loginSchema = z.object({ available: z.boolean(), enabled: z.boolean() });
export const setupSchema = z.object({
  sources: z.array(registered),
  login: loginSchema,
});
export type SetupStatus = z.infer<typeof setupSchema>;
const found = z.object({
  path: z.string(),
  name: z.string(),
  activity: z.number(),
  branch: z.string().optional(),
});
export type FoundSource = z.infer<typeof found>;
export const discoverySchema = z.object({
  home: z.string(),
  repositories: z.array(found),
  vaults: z.array(found),
  skipped: z.array(z.string()),
  truncated: z.boolean(),
});
export type Discovery = z.infer<typeof discoverySchema>;
export type SourceKind = "repo" | "vault";

/** The managed server's setup actions. Only `med web` and the login service
 * have them; a foreground review server answers 404. */
export function createSetupApi(fetcher: typeof fetch = fetch) {
  const api = createApi(fetcher, readBrowserToken());
  const post = <T>(action: string, schema: z.ZodType<T>, body: object = {}) =>
    api.json(`/api/service/${action}`, schema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    status: () => post("setup", setupSchema),
    discover: (deep: boolean) => post("discover", discoverySchema, { deep }),
    /** Without a kind, the server detects a vault from its .obsidian folder. */
    add: (path: string, kind?: SourceKind) => post("add", z.unknown(), { path, kind }),
    login: (enabled: boolean) => post("login", loginSchema, { enabled }),
  };
}
export type SetupApi = ReturnType<typeof createSetupApi>;

/** The welcome's address. */
export const WELCOME_PATH = "/welcome";

/** Opens the welcome from anywhere in Med. A full load lets the editors' unload
 * guards keep unsaved changes. */
export function openWelcome() {
  location.assign(WELCOME_PATH);
}

const remember = () => {
  try {
    localStorage.setItem(WELCOMED_KEY, "1");
  } catch {
    /* Without storage, the welcome shows while nothing is registered. */
  }
};
const welcomed = () => {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return false;
  }
};

/** On first run, a managed server with nothing registered opens the welcome.
 * Browsers that have sources remember it, so they skip the check later. */
export async function routeFirstRun(fetcher: typeof fetch = fetch) {
  if (!["/", "/sources"].includes(location.pathname) || welcomed()) return;
  try {
    const status = await createSetupApi(fetcher).status();
    if (status.sources.length) remember();
    else history.replaceState(null, "", WELCOME_PATH);
  } catch {
    /* A foreground review server has no setup. */
  }
}
export { remember as rememberWelcome };
