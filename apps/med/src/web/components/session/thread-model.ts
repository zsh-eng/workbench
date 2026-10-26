import type { SessionItem } from "../../data/session-store";

// The thread as units: the rows that the session thread renders one by one.

export type ToolItem = Extract<SessionItem, { kind: "tool" }>;
/** A finished turn's work: its thoughts, commentary, and tool calls. */
export type WorkUnit = {
  key: string;
  work: Unit[];
  open: boolean;
  durationMs: number;
  toolCalls: number;
};
export type Unit =
  | { key: string; item: SessionItem }
  | { key: string; explore: ToolItem[] }
  | WorkUnit;

/** The skill's `med review wait`, in the agent's own command or a path to the CLI. */
const MED_WAIT = /(?:^|[\s;&|(])(?:\S*\/)?med review wait\b/;
/** The agent waits for the user's next message from Med; it does no work. */
export function isMedWait(call: ToolItem["call"]) {
  const input = call.rawInput as { command?: unknown } | undefined;
  return typeof input?.command === "string" && MED_WAIT.test(input.command);
}

/** Tool calls, with the calls of their subagents. */
const countCalls = (list: SessionItem[]): number =>
  list.reduce((sum, item) => sum + (item.kind === "tool" ? 1 + countCalls(item.items) : 0), 0);

/** The last turn starts at the reader's last prompt that the agent took; a
 * tail without one starts at its first update. Subagent calls count too. */
export function lastTurn(items: SessionItem[], startedAt?: number) {
  const prompt = items.findLastIndex(
    (item) =>
      (item.kind === "user" && !item.queued) || (item.kind === "notice" && item.scheduled === true),
  );
  return {
    startedAt: prompt < 0 ? startedAt : items[prompt]!.at,
    toolCalls: countCalls(prompt < 0 ? items : items.slice(prompt + 1)),
  };
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

/** The replies that end each turn: the last agent text before the user's next
 * message, before the agent waits for one in `med review wait`, or at the end
 * of a finished thread; and each text that ended the agent's own turn, since
 * a background task's report can start more work without a prompt. */
export function finalReplies(list: Unit[], live: boolean) {
  const result = new Set<string>();
  let open = !live;
  for (let index = list.length - 1; index >= 0; index--) {
    const unit = list[index]!;
    if (!("item" in unit)) continue;
    const { item } = unit;
    if (item.kind === "user" || (item.kind === "tool" && isMedWait(item.call))) open = true;
    else if (item.kind === "agent" && (open || item.endsTurn)) {
      result.add(item.id);
      open = false;
    }
  }
  return result;
}

// A prompt that the agent took starts a turn; a queued one waits in the turn that runs.
// A prompt that a schedule enqueued starts one too.
const isPrompt = (unit: Unit) =>
  "item" in unit &&
  ((unit.item.kind === "user" && !unit.item.queued) ||
    (unit.item.kind === "notice" && unit.item.scheduled === true));
/** The items of a unit, in order. */
export const itemsOf = (unit: Unit): SessionItem[] =>
  "item" in unit ? [unit.item] : "explore" in unit ? unit.explore : unit.work.flatMap(itemsOf);

/** Each finished turn's work, between its prompt and its final reply, folds
 * into one "Worked for" row, as in Codex. An open turn shows its work after
 * that row, in order. Errors stay in view; the turn that runs does not fold. */
export function fold(
  list: Unit[],
  finals: ReadonlySet<string>,
  live: boolean,
  isOpen: (key: string) => boolean,
): Unit[] {
  const result: Unit[] = [];
  for (let at = 0; at < list.length; ) {
    let end = at + 1;
    while (end < list.length && !isPrompt(list[end]!)) end++;
    const turn = list.slice(at, end);
    at = end;
    const prompt = isPrompt(turn[0]!) ? turn[0] : undefined;
    const rest = prompt ? turn.slice(1) : turn;
    const shown = (unit: Unit) =>
      "item" in unit &&
      (finals.has(unit.item.id) ||
        unit.item.kind === "user" ||
        // A schedule's card stays in view when its turn's work folds.
        (unit.item.kind === "tool" && !!unit.item.call.schedule) ||
        (unit.item.kind === "notice" && unit.item.severity === "error"));
    const work = rest.filter((unit) => !shown(unit));
    if (!work.length || (live && end === list.length)) {
      result.push(...turn);
      continue;
    }
    const items = work.flatMap(itemsOf);
    const final = rest.find((unit) => "item" in unit && finals.has(unit.item.id));
    const startedAt = prompt && "item" in prompt ? prompt.item.at : items[0]!.at;
    const endedAt =
      final && "item" in final
        ? final.item.at
        : Math.max(
            ...items.map((item) => (item.kind === "tool" ? (item.endedAt ?? item.at) : item.at)),
          );
    const key = `work-${(prompt ?? work[0]!).key}`;
    const open = isOpen(key);
    if (prompt) result.push(prompt);
    result.push(
      {
        key,
        work,
        open,
        durationMs: Math.max(0, endedAt - startedAt),
        toolCalls: countCalls(items),
      },
      ...(open ? rest : rest.filter(shown)),
    );
  }
  return result;
}

/** The replies in the last `count` units of a thread as it opens, with its
 * work folded: the Markdown that it waits for before it shows, which a read
 * ahead renders first. A reply that is still streaming is left out. */
export function endReplies(items: SessionItem[], live: boolean, count: number) {
  const list = units(items);
  const all = fold(list, finalReplies(list, live), live, () => false);
  return all
    .slice(-count)
    .flatMap((unit) =>
      "item" in unit && unit.item.kind === "agent" && !(live && unit === all.at(-1))
        ? [unit.item.text]
        : [],
    );
}
