import { resolve } from "node:path";
import { DEFAULT_PORT, defaultStateDirectory } from "./connection";
import { shellWord } from "./shell-word";

export { shellWord };

/** The Med instance that a command talks to: its port and state folder. */
export interface Instance {
  port?: number;
  stateDir?: string;
}

/** The options that name this instance, when it is not the user's own Med. */
export function instanceOptions(instance: Instance) {
  const words: string[] = [];
  if (instance.port !== undefined && instance.port !== DEFAULT_PORT)
    words.push("--port", String(instance.port));
  if (instance.stateDir && resolve(instance.stateDir) !== defaultStateDirectory())
    words.push("--state-dir", shellWord(instance.stateDir));
  return words.join(" ");
}

/**
 * A command for the agent to run next: `med <command>`, then the instance's
 * options, then `rest`. Run as printed, it reaches the same instance.
 */
export const medCommand = (instance: Instance, command: string, rest = "") =>
  ["med", command, instanceOptions(instance), rest].filter(Boolean).join(" ");
