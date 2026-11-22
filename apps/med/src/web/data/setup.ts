import { z } from "zod";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";

/** Set once a browser has seen a server that has sources, so later loads
 * skip the first-run check. The key keeps the name of a page that Med no
 * longer has. */
const HAS_SOURCES_KEY = "med:welcomed";

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

/** A path as people know it: ~/code/med, or iCloud › Obsidian › Notes. */
export function displayPath(path: string, home?: string) {
  if (!home) return path;
  const cloud = `${home}/Library/Mobile Documents/`;
  if (path.startsWith(cloud)) {
    const [container = "", ...rest] = path.slice(cloud.length).split("/");
    const inside = rest[0] === "Documents" ? rest.slice(1) : rest;
    if (container === "com~apple~CloudDocs") return ["iCloud Drive", ...rest].join(" › ");
    if (container === "iCloud~md~obsidian") return ["iCloud", "Obsidian", ...inside].join(" › ");
    return ["iCloud", ...inside].join(" › ");
  }
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Short relative time, such as 3d for three days ago. */
export function since(time: number, now: number) {
  if (!time) return "";
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 63) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** The registered sources changed while this window showed them: a review
 * that found no repository reads the list again. */
export const SOURCES_CHANGED = "med:sources";

const SOURCES_PATH = "/sources";
let finding = false;

/** Opens Sources with what Med found on this computer, from anywhere in Med.
 * The page takes the request when it shows, so the address stays /sources. */
export function findSources() {
  finding = true;
  if (location.pathname !== SOURCES_PATH) history.pushState(null, "", SOURCES_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Whether Sources was asked for what Med found. The request is taken once. */
export function takeFindSources() {
  const asked = finding;
  finding = false;
  return asked;
}

const rememberSources = () => {
  try {
    localStorage.setItem(HAS_SOURCES_KEY, "1");
  } catch {
    /* Without storage, each load of "/" asks the server again. */
  }
};
const hasSources = () => {
  try {
    return localStorage.getItem(HAS_SOURCES_KEY) === "1";
  } catch {
    return false;
  }
};

/** On first run, a managed server with nothing registered opens on Sources,
 * which shows what Med found on this computer. Browsers that have sources
 * remember it, so they skip the check later. */
export async function routeFirstRun(fetcher: typeof fetch = fetch) {
  if (location.pathname !== "/" || hasSources()) return;
  try {
    const status = await createSetupApi(fetcher).status();
    if (status.sources.length) rememberSources();
    else history.replaceState(null, "", SOURCES_PATH);
  } catch {
    /* A foreground review server has no setup. */
  }
}
