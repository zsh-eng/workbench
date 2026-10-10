import type { SessionItem } from "../../data/session-store";

// The thread as units: the rows that the session thread renders one by one.

export type ToolItem = Extract<SessionItem, { kind: "tool" }>;
export type Unit = { key: string; item: SessionItem } | { key: string; explore: ToolItem[] };

/** The last turn starts at the reader's last prompt that the agent took; a
 * tail without one starts at its first update. Subagent calls count too. */
export function lastTurn(items: SessionItem[], startedAt?: number) {
  const prompt = items.findLastIndex((item) => item.kind === "user" && !item.queued);
  let toolCalls = 0;
  const count = (list: SessionItem[]) => {
    for (const item of list)
      if (item.kind === "tool") {
        toolCalls++;
        count(item.items);
      }
  };
  count(prompt < 0 ? items : items.slice(prompt + 1));
  return { startedAt: prompt < 0 ? startedAt : items[prompt]!.at, toolCalls };
}

/** A thought shows when it has text or took a while; short silent thoughts only show while they run. */
const LONG_THOUGHT = 2000;
const visible = (item: SessionItem) =>
  item.kind !== "thought" || item.text.trim() !== "" || (item.durationMs ?? 0) >= LONG_THOUGHT;
const exploring = (item: SessionItem): item is ToolItem =>
  item.kind === "tool" &&
  (item.call.kind === "read" || item.call.kind === "search") &&
  item.items.length === 0;

/** Reads and searches in a row become one "Explored" group, as in Codex. */
export function units(items: SessionItem[]): Unit[] {
  const result: Unit[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length > 1) result.push({ key: `explore-${run[0]!.id}`, explore: run });
    else if (run.length === 1) result.push({ key: run[0]!.id, item: run[0]! });
    run = [];
  };
  for (const item of items) {
    if (!visible(item)) continue;
    if (exploring(item)) {
      run.push(item);
      continue;
    }
    flush();
    result.push({ key: item.id, item });
  }
  flush();
  return result;
}

/** The reply that ends each turn: the last agent text before the user's next
 * message, or at the end of a finished thread. */
export function finalReplies(list: Unit[], live: boolean) {
  const result = new Set<string>();
  let open = !live;
  for (let index = list.length - 1; index >= 0; index--) {
    const unit = list[index]!;
    if ("explore" in unit) continue;
    if (unit.item.kind === "user") open = true;
    else if (unit.item.kind === "agent" && open) {
      result.add(unit.item.id);
      open = false;
    }
  }
  return result;
}
