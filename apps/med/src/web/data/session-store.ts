import {
  taskCallId,
  type ContentBlock,
  type PlanEntry,
  type SessionEvent,
  type SessionUpdate,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from "../../shared/agent-session";
import type { SentMessage } from "./agent-inbox";
import type { ScheduleCall } from "../../shared/schedules";

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
  /** A restart cut the call before it ended. */
  interrupted?: boolean;
  /** What a schedule tool's call schedules or cancels (shared/schedules.ts). */
  schedule?: ScheduleCall;
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
      sent?: SentMessage;
    }
  | {
      kind: "agent";
      id: string;
      at: number;
      text: string;
      /** The message ended the agent's turn; later work came without a prompt. */
      endsTurn?: boolean;
      /** A reply that streamed and whose text is whole, before the transcript has it. */
      settled?: boolean;
    }
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
      /** A prompt that a schedule enqueued ran: it starts a turn. */
      scheduled?: boolean;
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

function sameBlock(a: ContentBlock, b: ContentBlock) {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.type === "text" && b.type === "text") return a.text === b.text;
  if (a.type === "image" && b.type === "image")
    return a.data === b.data && a.mimeType === b.mimeType;
  return false;
}

function sameToolContent(a: ToolCallContent, b: ToolCallContent) {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.type === "content" && b.type === "content") return sameBlock(a.content, b.content);
  if (a.type === "diff" && b.type === "diff")
    return a.path === b.path && a.oldText === b.oldText && a.newText === b.newText;
  return false;
}

function samePlan(a: PlanEntry[] | undefined, b: PlanEntry[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.content === b[index]!.content &&
      entry.status === b[index]!.status &&
      entry.priority === b[index]!.priority,
  );
}

function sameJson(a: unknown, b: unknown) {
  if (a === b) return true;
  if (a === undefined || b === undefined || typeof a !== typeof b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Structural equality for SessionItems so `prepend` can preserve unchanged
 * item references, keeping Pretext, height, and React memo caches warm. */
function sameItem(a: SessionItem, b: SessionItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id || a.at !== b.at) return false;
  switch (a.kind) {
    case "user": {
      const other = b as typeof a;
      return (
        a.queued === other.queued &&
        a.sent === other.sent &&
        a.content.length === other.content.length &&
        a.content.every((block, index) => sameBlock(block, other.content[index]!))
      );
    }
    case "agent": {
      const other = b as typeof a;
      return a.text === other.text && a.endsTurn === other.endsTurn && a.settled === other.settled;
    }
    case "thought": {
      const other = b as typeof a;
      return a.text === other.text && a.durationMs === other.durationMs;
    }
    case "notice": {
      const other = b as typeof a;
      return (
        a.title === other.title &&
        a.severity === other.severity &&
        a.description === other.description &&
        a.scheduled === other.scheduled
      );
    }
    case "compaction": {
      const other = b as typeof a;
      return a.summary === other.summary && a.failed === other.failed;
    }
    case "tool": {
      const other = b as typeof a;
      const ca = a.call;
      const cb = other.call;
      if (
        a.endedAt !== other.endedAt ||
        ca.title !== cb.title ||
        ca.kind !== cb.kind ||
        ca.status !== cb.status ||
        ca.tool !== cb.tool ||
        ca.interrupted !== cb.interrupted ||
        ca.background?.id !== cb.background?.id ||
        ca.background?.kind !== cb.background?.kind ||
        ca.content.length !== cb.content.length ||
        ca.locations.length !== cb.locations.length ||
        a.items.length !== other.items.length ||
        !samePlan(a.plan, other.plan) ||
        !sameJson(ca.rawInput, cb.rawInput) ||
        !sameJson(ca.rawOutput, cb.rawOutput) ||
        !sameJson(ca.schedule, cb.schedule)
      )
        return false;
      return (
        ca.content.every((part, index) => sameToolContent(part, cb.content[index]!)) &&
        ca.locations.every(
          (loc, index) =>
            loc.path === cb.locations[index]!.path && loc.line === cb.locations[index]!.line,
        ) &&
        a.items.every((child, index) => child === other.items[index])
      );
    }
  }
}

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
  // The call that started each background task, by `taskCallId`.
  let tasks = new Map<string, string>();
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
        setItem({
          ...current,
          text: current.text + textOf(block),
          ...(meta?.endsTurn ? { endsTurn: true } : {}),
        });
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
    else if (kind === "agent")
      append(thread, {
        kind,
        id,
        at,
        text: textOf(block),
        ...(meta?.endsTurn ? { endsTurn: true } : {}),
      });
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
      // A transcript's tail can start on a line with no time, such as its
      // title; the session starts at its first dated update.
      startedAt: snapshot.startedAt ?? (at > 0 ? at : undefined),
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
        // An update for a task goes to the call that started it, now or when
        // the call arrives.
        if (update.toolCallId.startsWith(taskCallId(""))) {
          const call = tasks.get(update.toolCallId);
          if (call) apply({ ...event, update: { ...update, toolCallId: call } });
          else orphans.set(update.toolCallId, [...(orphans.get(update.toolCallId) ?? []), event]);
          return;
        }
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
          ...(meta?.interrupted ? { interrupted: true } : {}),
          ...(meta?.schedule ? { schedule: meta.schedule } : {}),
        };
        const ended = call.status === "completed" || call.status === "failed";
        // Updates that waited for this call, or for the task it started.
        const adopt = (key: string) => {
          const waiting = orphans.get(key);
          orphans.delete(key);
          for (const orphan of waiting ?? []) apply(orphan);
        };
        const task = meta?.background ? taskCallId(meta.background.id) : undefined;
        const started = task !== undefined && !tasks.has(task);
        if (started) tasks.set(task, update.toolCallId);
        if (existing?.kind === "tool") {
          setItem({ ...existing, call, endedAt: ended ? (existing.endedAt ?? at) : undefined });
          if (started) adopt(task);
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
        adopt(update.toolCallId);
        if (started) adopt(task);
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
      // A request's tokens are the thread's spend, which the host counts.
      case "token_usage":
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
          ...(update._meta?.med?.scheduled ? { scheduled: true } : {}),
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

  function clear() {
    snapshot = empty;
    threads = new Map([[ROOT, []]]);
    where = new Map();
    named = new Map();
    events = [];
    orphans = new Map();
    tasks = new Map();
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
    /** How many updates the thread holds, to tell whether it changed. */
    size: () => events.length,
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
      clear();
      emit();
    },
    /** Replaces the thread with a new first view and notifies once, so a
     * reconnect never shows an empty thread between the two. */
    replace(added: Iterable<SessionEvent>) {
      const running = snapshot.running;
      clear();
      snapshot = { ...empty, running };
      applyAll(added);
    },
    /** Puts an earlier page before the updates so far. The thread builds again
     * in order, so results that waited for their calls find them, while
     * unchanged items keep their previous object references so height and
     * memo caches stay warm. */
    prepend(page: SessionEvent[]) {
      if (!page.length) return;
      const previous = new Map<string, SessionItem>();
      for (const items of threads.values()) for (const item of items) previous.set(item.id, item);
      const later = events;
      const running = snapshot.running;
      batch++;
      try {
        snapshot = { ...empty, running };
        threads = new Map([[ROOT, []]]);
        where = new Map();
        named = new Map();
        events = [];
        orphans = new Map();
        tasks = new Map();
        for (const event of page) {
          events.push(event);
          apply(event);
        }
        for (const event of later) {
          events.push(event);
          apply(event);
        }
        // Reconcile subagent threads before the root thread so unchanged tool
        // items see identical child arrays and keep their references too.
        const reconcile = (key: string) => {
          const items = threads.get(key);
          if (!items) return;
          for (let at = 0; at < items.length; at++) {
            let item = items[at]!;
            if (item.kind === "tool") {
              reconcile(item.id);
              const children = threads.get(item.id);
              if (children && children !== item.items) item = { ...item, items: children };
            }
            const prior = previous.get(item.id);
            if (prior && sameItem(prior, item)) {
              items[at] = prior;
              if (prior.kind === "tool") threads.set(prior.id, prior.items);
            } else {
              items[at] = item;
            }
          }
        };
        reconcile(ROOT);
        snapshot = { ...snapshot, items: threads.get(ROOT) ?? [] };
        changed = true;
      } finally {
        batch--;
      }
      if (changed && !batch) {
        changed = false;
        emit();
      }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
