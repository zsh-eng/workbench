import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  agentMessageInputSchema,
  sentCommentSchema,
  type AgentMessageInput,
  type SentComment,
} from "../../shared/agent-inbox";
import { unanswered } from "./api";
import { reconnectPause } from "./reconnect";

// What the reader writes to an agent stays in this browser until Med has it.
// A session's message box keeps its draft across a reload. A message that the
// page sent and Med did not confirm stays in the session's outbox, with its
// ID, which Med takes once. While Med does not answer, as during a restart,
// the message waits and goes again. After a reload, the page sends again the
// messages that were on their way, and one that failed comes back with its
// reason and Retry. Storage can be unavailable or full; then both last for
// this page only.

const DRAFT = "med:draft:";
const OUTBOX = "med:outbox:";
/** Images can be megabytes; over this size the outbox keeps a message
 * without them, and says so. */
const MOST_KEPT = 1_000_000;

/** A message box's text, and the paths of its @ mentions. */
export interface Draft {
  text: string;
  mentions: { label: string; path: string }[];
}

const draftSchema = z.object({
  text: z.string().max(1_000_000),
  mentions: z.array(z.object({ label: z.string(), path: z.string() })).max(200),
});

export function readDraft(key: string): Draft | undefined {
  try {
    const result = draftSchema.safeParse(JSON.parse(localStorage.getItem(DRAFT + key) ?? "null"));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the draft; an empty one is removed. */
export function writeDraft(key: string, draft: Draft) {
  try {
    if (draft.text.trim()) localStorage.setItem(DRAFT + key, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT + key);
  } catch {
    /* The draft lasts for this page. */
  }
}

/** A message that the browser sent, until the host has it. */
export interface Outgoing {
  id: string;
  input: AgentMessageInput;
  createdAt: string;
  /** The comments as they read when sent, to show at once. */
  comments: SentComment[];
  error?: string;
  /** Images that the outbox could not keep across a reload. */
  lostImages?: number;
}

const outgoingSchema = z.object({
  id: z.string().uuid(),
  input: agentMessageInputSchema,
  createdAt: z.string(),
  comments: z.array(sentCommentSchema),
  error: z.string().optional(),
  lostImages: z.number().int().positive().optional(),
});

/** The session's messages that Med did not confirm, as the last page left them. */
function readOutbox(key: string): Outgoing[] {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(OUTBOX + key) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const result = outgoingSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

function writeOutbox(key: string, list: readonly Outgoing[]) {
  const kept = list.map((message) => {
    const images = message.input.images ?? [];
    const size = images.reduce((total, image) => total + image.data.length, 0);
    if (size <= MOST_KEPT) return message;
    return {
      ...message,
      input: { ...message.input, images: [] },
      lostImages: images.length,
    };
  });
  try {
    if (kept.length) localStorage.setItem(OUTBOX + key, JSON.stringify(kept));
    else localStorage.removeItem(OUTBOX + key);
    return true;
  } catch {
    // The outbox lasts for this page.
    return false;
  }
}

/** Sends a message to Med, which keeps the message's ID. */
export type Deliver = (input: AgentMessageInput) => Promise<unknown>;

/** Attempts while Med does not answer: about 20 seconds (reconnect.ts). */
const ATTEMPTS = 10;
/** The outboxes that a panel shows or that this page sends from. */
const lists = new Map<string, readonly Outgoing[]>();
/** The messages that this page sends now: their outboxes, by ID. */
const posting = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
/** Outboxes that storage did not take; the page keeps them. */
const unstored = new Set<string>();
/** Forgets an outbox that no panel shows and no send uses; storage has it. */
function release(key: string) {
  if (!listeners.get(key)?.size && !unstored.has(key) && ![...posting.values()].includes(key))
    lists.delete(key);
}

function list(key: string) {
  let value = lists.get(key);
  if (!value) {
    value = readOutbox(key).map((message) =>
      message.lostImages && !message.error
        ? {
            ...message,
            error: `Its ${message.lostImages === 1 ? "image was" : "images were"} too large to keep after a reload. Retry sends the text.`,
          }
        : message,
    );
    lists.set(key, value);
  }
  return value;
}
function change(key: string, next: (list: readonly Outgoing[]) => readonly Outgoing[]) {
  const before = list(key);
  const after = next(before);
  if (after === before) return;
  lists.set(key, after);
  if (writeOutbox(key, after)) unstored.delete(key);
  else unstored.add(key);
  for (const listener of listeners.get(key) ?? []) listener();
}
const without = (id: string) => (list: readonly Outgoing[]) =>
  list.some((entry) => entry.id === id) ? list.filter((entry) => entry.id !== id) : list;

async function post(key: string, id: string, deliver: Deliver) {
  if (posting.has(id)) return;
  posting.set(id, key);
  const forever = new AbortController().signal;
  try {
    for (let attempt = 0; ; attempt++) {
      const message = list(key).find((entry) => entry.id === id);
      if (!message) return;
      try {
        await deliver({ ...message.input, id });
        change(key, without(id));
        return;
      } catch (reason) {
        const restarting = unanswered(reason);
        if (restarting && attempt + 1 < ATTEMPTS) {
          await reconnectPause(attempt, forever);
          continue;
        }
        const error = restarting
          ? "Med is not running."
          : reason instanceof Error
            ? reason.message
            : "Not sent.";
        change(key, (list) => list.map((entry) => (entry.id === id ? { ...entry, error } : entry)));
        return;
      }
    }
  } finally {
    posting.delete(id);
    release(key);
  }
}

/**
 * A session's outbox, by `key`. Messages in it show in the thread until Med
 * has them; those that this page did not send yet go when `deliver` is set.
 * `known` is the IDs of the messages that Med has, as from another window.
 */
export function useOutbox(key: string, deliver: Deliver | undefined, known?: ReadonlySet<string>) {
  const outgoing = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const own = listeners.get(key) ?? new Set();
        listeners.set(key, own.add(listener));
        return () => {
          own.delete(listener);
          release(key);
        };
      },
      [key],
    ),
    () => list(key),
  );
  useEffect(() => {
    if (!deliver) return;
    for (const message of list(key)) if (!message.error) void post(key, message.id, deliver);
  }, [key, deliver]);
  useEffect(() => {
    if (known?.size)
      change(key, (list) =>
        list.some((entry) => known.has(entry.id))
          ? list.filter((entry) => !known.has(entry.id))
          : list,
      );
  }, [key, known]);
  return {
    outgoing,
    send(message: Outgoing) {
      change(key, (list) => [...list, message]);
      if (deliver) void post(key, message.id, deliver);
    },
    retry(id: string) {
      change(key, (list) =>
        list.map((entry) => (entry.id === id ? { ...entry, error: undefined } : entry)),
      );
      if (deliver) void post(key, id, deliver);
    },
    discard: (id: string) => change(key, without(id)),
  };
}
