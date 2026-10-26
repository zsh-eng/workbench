import type { FullConfig } from "@playwright/test";
import { dirname } from "node:path";

/**
 * Locally, Playwright reuses a stack that already runs on the app's port.
 * That can be a stale one from another worktree. The dev server answers
 * `/__e2e` with the directory it runs in.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const root = dirname(config.configFile!);
  const response = await fetch(new URL("/__e2e", baseURL), {
    headers: { accept: "application/json" },
  }).catch(() => undefined);
  const marker = (
    response?.ok ? await response.json().catch(() => ({})) : {}
  ) as { root?: string };
  if (marker.root === root) return;
  throw new Error(
    `${baseURL} is not this checkout's dev server: it runs from ` +
      `${marker.root ?? "another app"}, not ${root}. Stop it, or set ` +
      `E2E_PORT and E2E_API_PORT to free ports.`,
  );
}
