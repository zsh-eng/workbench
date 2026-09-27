/** The installed executable starts its own server/index modes without a Bun dependency. */
export function selfCommand(args: string[]) {
  const script = process.argv[1];
  const compiled = !script || script.includes("$bunfs") || script.includes("~BUN");
  return { executable: process.execPath, args: [...(compiled ? [] : [script]), ...args] };
}
