import { resolve } from "node:path";

const compiled = (script: string | undefined): script is undefined =>
  !script || script.includes("$bunfs") || script.includes("~BUN");

/** The installed executable starts its own server/index modes without a Bun dependency. */
export function selfCommand(args: string[]) {
  const script = process.argv[1];
  return { executable: process.execPath, args: [...(compiled(script) ? [] : [script]), ...args] };
}

/** The file that holds this process's code: the CLI script, or the compiled executable. */
export function codePath() {
  const script = process.argv[1];
  return compiled(script) ? process.execPath : resolve(script);
}
