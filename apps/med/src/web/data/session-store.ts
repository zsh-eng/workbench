import type {
  ContentBlock,
  PlanEntry,
  SessionEvent,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from "../../shared/agent-session";
import type { AgentMessage } from "../../shared/agent-inbox";

export interface ToolCallState {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  /** The agent's own name for the tool, such as Bash. */
  tool?: string;
  background?: { id: string; kind: "shell" | "agent" };
}

/** One row of a thread. Items never change in place; an update replaces the item. */
export type SessionItem =
  | {
      kind: "user";
      id: string;
      at: number;
      content: ContentBlock[];
      queued?: boolean;
      /** A message that the user sent from Med, and how far it got. */
      sent?: AgentMessage;
    }
  | { kind: "agent"; id: string; at: number; text: string }
  | { kind: "thought"; id: string; at: number; text: string; durationMs?: number }
  | {
      kind: "tool";
      id: string;
      at: number;
      endedAt?: number;
      call: ToolCallState;
      /** The thread of a subagent that this call started. */
      items: SessionItem[];
      plan?: PlanEntry[];
    }
  | {
      kind: "notice";
      id: string;
      at: number;
      title: string;
      severity: "info" | "warning" | "error";
      description?: string | null;
    }
  | { kind: "compaction"; id: string; at: number; summary?: string; failed?: boolean };

export interface SessionSnapshot {
  items: SessionItem[];
  plan: PlanEntry[];
  title?: string;
  usage?: { size: number; used: number };
  startedAt?: number;
  updatedAt?: number;
  /** The agent is working: the last turn has not ended. */
  running: boolean;
  toolCalls: number;
}

const ROOT = "";
const empty: SessionSnapshot = { items: [], plan: [], running: false, toolCalls: 0 };
const textOf = (block: ContentBlock) => (block.type === "text" ? block.text : "");

/**
 * Holds one session as a list of items that a thread renders. Updates arrive
 * one at a time, from a transcript, a replay, or a live agent. Each update
 * replaces only the items it changes, so a row that did not change keeps its
 * object and memoized rows do not render again.
 */
export function createSessionStore() {
  let snapshot = empty;
  // Each thread is the root or the subagent thread of one tool call.
  let threads = new Map<string, SessionItem[]>([[ROOT, []]]);
  let where = new Map<string, { thread: string; index: number }>();
  // Items without an ID take one from their kind and time, so they keep it
  // when an earlier page builds the thread again, and a pin keeps its reply.
  let named = new Map<string, number>();
  const nameOf = (kind: string, at: number) => {
    const base = `${kind}-${at}`;
    const count = (named.get(base) ?? 0) + 1;
    named.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
  // Every update so far, so an earlier page can go before them.
  let events: SessionEvent[] = [];
  // Updates of calls that have not arrived, such as results at the start of a
  // tail whose calls are on an earlier page.
  let orphans = new Map<string, SessionEvent[]>();
  const listeners = new Set<() => void>();
  let batch = 0;
  let changed = false;
  // Lists made since listeners last ran. No one holds them yet, so updates
  // add to them in place: a page of thousands of updates copies each list
  // once, not once per update.
  let fresh = new WeakSet<SessionItem[]>();
  const writable = (items: SessionItem[]) => {
    const next = fresh.has(items) ? items : items.slice();
    fresh.add(next);
    return next;
  };

  function setThread(key: string, items: SessionItem[]) {
    threads.set(key, items);
    if (key === ROOT) {
      snapshot = { ...snapshot, items };
      return;
    }
    const parent = itemOf(key);
    if (parent?.kind === "tool") setItem({ ...parent, items });
  }
  function itemOf(id: string) {
    const place = where.get(id);
    return place ? threads.get(place.thread)![place.index] : undefined;
  }
  function setItem(item: SessionItem) {
    const place = where.get(item.id)!;
    const items = writable(threads.get(place.thread)!);
    items[place.index] = item;
    setThread(place.thread, items);
  }
  function append(thread: string, item: SessionItem) {
    const items = writable(threads.get(thread) ?? []);
    items.push(item);
    where.set(item.id, { thread, index: items.length - 1 });
    setThread(thread, items);
  }

  function chunk(
    thread: string,
    kind: "user" | "agent" | "thought",
    at: number,
    update: SessionUpdate,
  ) {
    if (!("content" in update) || Array.isArray(update.content) || !update.content) return;
    const block = update.content as ContentBlock;
    const messageId = "messageId" in update ? update.messageId : undefined;
    const meta = update._meta?.med;
    const items = threads.get(thread) ?? [];
    const last = items.at(-1);
    // Chunks of one message share its ID; chunks without one join the message before them.
    const current = messageId ? itemOf(messageId) : last?.kind === kind ? last : undefined;
    if (current && current.kind === kind) {
      if (current.kind === "user") setItem({ ...current, content: [...current.content, block] });
      else if (current.kind === "agent")
        setItem({ ...current, text: current.text + textOf(block) });
      else if (current.kind === "thought")
        setItem({
          ...current,
          text: current.text + textOf(block),
          durationMs: meta?.durationMs ?? current.durationMs,
        });
      return;
    }
    const id = messageId ?? nameOf(kind, at);
    if (kind === "user")
      append(thread, { kind, id, at, content: [block], ...(meta?.queued ? { queued: true } : {}) });
    else if (kind === "agent") append(thread, { kind, id, at, text: textOf(block) });
    else
      append(thread, {
        kind,
        id,
        at,
        text: textOf(block),
        ...(meta?.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
      });
  }

  function apply(event: SessionEvent) {
    const { at, update } = event;
    const parent = update._meta?.med?.parentToolCallId;
    const thread = parent && where.has(parent) ? parent : ROOT;
    snapshot = {
      ...snapshot,
      startedAt: snapshot.startedAt ?? at,
      updatedAt: Math.max(snapshot.updatedAt ?? at, at),
    };
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        return chunk(thread, "user", at, update);
      case "agent_message_chunk":
        return chunk(thread, "agent", at, update);
      case "agent_thought_chunk":
        return chunk(thread, "thought", at, update);
      case "tool_call":
      case "tool_call_update": {
        const existing = itemOf(update.toolCallId);
        // An update without its call and without a title waits for the call.
        if (!existing && update.sessionUpdate === "tool_call_update" && !update.title) {
          orphans.set(update.toolCallId, [...(orphans.get(update.toolCallId) ?? []), event]);
          return;
        }
        const meta = update._meta?.med;
        const previous: ToolCallState =
          existing?.kind === "tool"
            ? existing.call
            : {
                toolCallId: update.toolCallId,
                title: "",
                kind: "other",
                status: "pending",
                content: [],
                locations: [],
              };
        const call: ToolCallState = {
          ...previous,
          ...(update.title !== undefined ? { title: update.title } : {}),
          ...(update.kind ? { kind: update.kind } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...(update.content ? { content: update.content } : {}),
          ...(update.locations ? { locations: update.locations } : {}),
          ...("rawInput" in update && update.rawInput !== undefined
            ? { rawInput: update.rawInput }
            : {}),
          ...("rawOutput" in update && update.rawOutput !== undefined
            ? { rawOutput: update.rawOutput }
            : {}),
          ...(meta?.tool ? { tool: meta.tool } : {}),
          ...(meta?.background ? { background: meta.background } : {}),
        };
        const ended = call.status === "completed" || call.status === "failed";
        if (existing?.kind === "tool") {
          setItem({ ...existing, call, endedAt: ended ? (existing.endedAt ?? at) : undefined });
          return;
        }
        threads.set(update.toolCallId, []);
        snapshot = { ...snapshot, toolCalls: snapshot.toolCalls + 1 };
        append(thread, {
          kind: "tool",
          id: update.toolCallId,
          at,
          call,
          items: [],
          ...(ended ? { endedAt: at } : {}),
        });
        const waiting = orphans.get(update.toolCallId);
        if (waiting) {
          orphans.delete(update.toolCallId);
          for (const orphan of waiting) apply(orphan);
        }
        return;
      }
      case "plan": {
        const item = parent ? itemOf(parent) : undefined;
        if (item?.kind === "tool") setItem({ ...item, plan: update.entries });
        else snapshot = { ...snapshot, plan: update.entries };
        return;
      }
      case "session_info_update":
        if (update.title !== undefined)
          snapshot = { ...snapshot, title: update.title ?? undefined };
        return;
      case "usage_update":
        snapshot = { ...snapshot, usage: { size: update.size, used: update.used } };
        return;
      case "notice":
        append(thread, {
          kind: "notice",
          id: nameOf("notice", at),
          at,
          title: update.title,
          severity: update.severity,
          description: update.description,
        });
        return;
      case "compaction_update": {
        const summary = update.summary?.map(textOf).join("") || undefined;
        const existing = itemOf(update.compactionId);
        if (existing?.kind === "compaction")
          setItem({
            ...existing,
            summary: summary ?? existing.summary,
            failed: update.status === "failed",
          });
        else
          append(thread, {
            kind: "compaction",
            id: update.compactionId,
            at,
            summary,
            failed: update.status === "failed",
          });
        return;
      }
    }
  }

  function applyAll(added: Iterable<SessionEvent>) {
    batch++;
    try {
      for (const event of added) {
        events.push(event);
        apply(event);
      }
      changed = true;
    } finally {
      batch--;
    }
    if (changed && !batch) {
      changed = false;
      emit();
    }
  }

  function emit() {
    if (batch) {
      changed = true;
      return;
    }
    fresh = new WeakSet();
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    apply(event: SessionEvent) {
      events.push(event);
      apply(event);
      emit();
    },
    /** Applies many updates and notifies once, as when a transcript loads. */
    applyAll,
    setRunning(running: boolean) {
      if (snapshot.running === running) return;
      snapshot = { ...snapshot, running };
      emit();
    },
    reset() {
      snapshot = empty;
      threads = new Map([[ROOT, []]]);
      where = new Map();
      named = new Map();
      events = [];
      orphans = new Map();
      emit();
    },
    /** Puts an earlier page before the updates so far. The thread builds again
     * in order, so results that waited for their calls find them. */
    prepend(page: SessionEvent[]) {
      if (!page.length) return;
      const later = events;
      const running = snapshot.running;
      snapshot = { ...empty, running };
      threads = new Map([[ROOT, []]]);
      where = new Map();
      named = new Map();
      events = [];
      orphans = new Map();
      applyAll([...page, ...later]);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
