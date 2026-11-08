import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** Codex's CLI: MED_CODEX_PATH, `codex` on the PATH, or the one in the ChatGPT app. */
export async function findCodex(environment: NodeJS.ProcessEnv = process.env) {
  const candidates = [
    environment.MED_CODEX_PATH,
    ...(environment.PATH ?? "")
      .split(delimiter)
      .map((directory) => directory && join(directory, "codex")),
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  ].filter((path): path is string => !!path);
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next place.
    }
  }
  return undefined;
}
