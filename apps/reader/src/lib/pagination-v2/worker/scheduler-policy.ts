import type { PaginationCommand } from "../protocol";

export const PAGINATION_TASK_YIELD_BUDGET_MS = 24;

export type PaginationJobPriority = "user" | "layout" | "background";

/** Command coalescing key. Null means command is never coalesced. */
export function getCoalesceKey(command: PaginationCommand): string | null {
  switch (command.type) {
    case "updatePaginationConfig":
    case "updateSpreadConfig":
    case "nextSpread":
    case "prevSpread":
    case "goToPage":
    case "goToAnchor":
    case "goToChapter":
    case "goToTarget":
    case "goToTextOffset":
      return command.type;
    case "locateAnchors":
    case "locateTextOffsets":
      return `${command.type}:${command.scope}`;
    case "updateChapter":
      return `${command.type}:${command.chapterIndex}`;
    default:
      return null;
  }
}

/** Command types whose events should start a fresh layout epoch. */
export const LAYOUT_ADVANCING_COMMANDS = new Set<PaginationCommand["type"]>([
  "init",
  "updatePaginationConfig",
  "updateChapter",
]);

/** Navigation command types always scheduled ahead of layout/background work. */
export const NAVIGATION_COMMANDS = new Set<PaginationCommand["type"]>([
  "nextSpread",
  "prevSpread",
  "goToPage",
  "goToAnchor",
  "goToChapter",
  "goToTarget",
  "goToTextOffset",
]);

export interface QueuedPaginationCommand {
  command: PaginationCommand;
}

/**
 * Keep only the last occurrence of each coalescable command key.
 * `init` and `addChapter` are never coalesced (always kept in order).
 */
export function coalesceQueuedCommands(
  commands: QueuedPaginationCommand[],
): QueuedPaginationCommand[] {
  const lastIndex = new Map<string, number>();
  for (let i = commands.length - 1; i >= 0; i--) {
    const command = commands[i]?.command;
    if (!command) continue;
    const key = getCoalesceKey(command);
    if (!key || lastIndex.has(key)) continue;
    lastIndex.set(key, i);
  }

  const result: QueuedPaginationCommand[] = [];
  for (let i = 0; i < commands.length; i++) {
    const item = commands[i];
    if (!item) continue;
    const key = getCoalesceKey(item.command);
    if (!key) {
      result.push(item);
      continue;
    }
    if (lastIndex.get(key) === i) result.push(item);
  }
  return result;
}

export function getCommandPriority(
  command: PaginationCommand,
): PaginationJobPriority {
  if (
    NAVIGATION_COMMANDS.has(command.type) ||
    command.type === "updateSpreadConfig"
  ) {
    return "user";
  }

  if (command.type === "addChapter") {
    return "background";
  }

  return "layout";
}

export function startsLayoutEpoch(command: PaginationCommand): boolean {
  return LAYOUT_ADVANCING_COMMANDS.has(command.type);
}
