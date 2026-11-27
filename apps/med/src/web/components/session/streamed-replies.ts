// What the thread shows of the replies that stream, until the transcript has
// them. A reply shows in whole blocks: a paragraph after its blank line, a
// heading after its line, a code block after its closing fence. Text never
// lands mid-word, and each block arrives once, so SessionMarkdown fades it
// in. A reply whose text ended shows all of it.
//
// A reply that the host stops streaming stays until the transcript has it.
// The host drops it when the agent's next message starts or the turn ends, a
// moment before the transcript's copy comes: the thread would get shorter for
// that moment, and the browser would move the reader's place, to the end or
// far above it.
import { useEffect, useState } from "react";
import type { SessionItem } from "../../data/session-store";

/** A reply from the host: the text that has streamed, and whether it ended. */
export interface Streaming {
  id: string;
  text: string;
  ended?: boolean;
}

/** A reply that the thread shows after the transcript's items; `settled`
 * when its text is whole, as the transcript's copy will be. */
export interface StreamedReply {
  id: string;
  at: number;
  text: string;
  settled: boolean;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const MATH_DOLLAR_OPEN = /^\s*\$\$\s*$/;
const MATH_BRACKET_OPEN = /^\s*\\\[\s*$/;
const MATH_BRACKET_CLOSE = /(?<!\\)(?:\\\\)*\\\]\s*$/;

/** The start of `text` that ends with a finished block, without the blank
 * line after it; empty while the first block is still arriving. */
export function finishedBlocks(text: string) {
  let end = 0;
  // The marker of the code block that is open, such as "```".
  let fence = "";
  let math: "$$" | "\\[" | "" = "";
  for (let at = 0; ; ) {
    const next = text.indexOf("\n", at);
    // The last line is still arriving.
    if (next < 0) break;
    const line = text.slice(at, next);
    at = next + 1;
    if (fence) {
      const close = FENCE.exec(line)?.[1];
      if (
        close &&
        close[0] === fence[0] &&
        close.length >= fence.length &&
        !line.trim().slice(close.length)
      ) {
        fence = "";
        end = at;
      }
    } else if (math) {
      if (
        (math === "$$" && MATH_DOLLAR_OPEN.test(line)) ||
        (math === "\\[" && MATH_BRACKET_CLOSE.test(line))
      ) {
        math = "";
        end = at;
      }
    } else if (FENCE.test(line)) fence = FENCE.exec(line)![1]!;
    else if (MATH_DOLLAR_OPEN.test(line)) math = "$$";
    else if (MATH_BRACKET_OPEN.test(line)) math = "\\[";
    else if (!line.trim() || HEADING.test(line)) end = at;
  }
  return text.slice(0, end).trimEnd();
}

/** How many of the latest items a streamed reply's copy can be among. */
const RECENT = 12;
/** How much of a reply's start tells it apart. */
const HEAD = 200;
/** How long a reply that stopped streaming waits for the transcript's copy. */
const KEEP_MS = 10_000;

/** Whether the transcript already holds the reply that streamed as `id`.
 * Checks exact ID first (immune to repeated text and tool bursts), then
 * prefix-matches only items that arrived after this reply started streaming
 * so a repeated short reply from an earlier turn does not suppress it. */
function transcriptHas(items: SessionItem[], id: string, reply: Kept) {
  const recent = Math.max(0, items.length - RECENT);
  for (let at = Math.max(0, items.length - 48); at < items.length; at++) {
    const item = items[at]!;
    if (item.kind === "agent" && item.id === id) return true;
  }
  const head = reply.text.trim().slice(0, HEAD);
  if (!head) return false;
  let from = recent;
  if (reply.afterId !== undefined) {
    const at = items.findLastIndex((item) => item.id === reply.afterId);
    if (at >= 0) from = at + 1;
  }
  for (let at = from; at < items.length; at++) {
    const item = items[at]!;
    if (item.kind === "agent" && item.text.trim().startsWith(head)) return true;
  }
  return false;
}

interface Kept {
  text: string;
  /** When it shows: after the transcript's latest item. */
  at: number;
  /** The transcript's last item when this reply started streaming live. */
  afterId?: string;
  /** The host stopped streaming it. */
  stopped?: boolean;
}

interface State {
  items: SessionItem[];
  streaming: Streaming | undefined;
  /** The replies that streamed, by the host's ID, oldest first. */
  kept: ReadonlyMap<string, Kept>;
  shown: StreamedReply[];
}

/** The state for the transcript's `items` and the host's reply; `expired`
 * drops the replies that stopped and still wait. */
function advance(
  state: State | undefined,
  items: SessionItem[],
  streaming: Streaming | undefined,
  expired = false,
): State {
  const live = streaming?.text.trim() ? streaming : undefined;
  const kept = new Map(state?.kept);
  for (const [id, reply] of kept) {
    if (id === live?.id) continue;
    if (transcriptHas(items, id, reply) || (expired && reply.stopped)) kept.delete(id);
    else if (!reply.stopped) kept.set(id, { ...reply, stopped: true });
  }
  // The text as it came, so the transcript's copy renders from the same cache entry.
  if (live) {
    const existing = kept.get(live.id);
    kept.set(live.id, {
      text: live.text,
      at: existing?.at ?? items.at(-1)?.at ?? 0,
      afterId: existing ? existing.afterId : state ? items.at(-1)?.id : undefined,
    });
  }
  const shown: StreamedReply[] = [];
  for (const [id, reply] of kept) {
    if (transcriptHas(items, id, reply)) continue;
    const settled = id !== live?.id || !!live.ended;
    const text = settled ? reply.text : finishedBlocks(reply.text);
    if (text) shown.push({ id: `streaming-${id}`, at: reply.at, text, settled });
  }
  const before = state?.shown ?? [];
  const same =
    shown.length === before.length &&
    shown.every(
      (reply, index) =>
        reply.id === before[index]!.id &&
        reply.text === before[index]!.text &&
        reply.settled === before[index]!.settled,
    );
  return { items, streaming, kept, shown: same ? before : shown };
}

/**
 * The replies to show after the transcript's `items`: the one that streams
 * now, in whole blocks, and those that stopped streaming whose copy the
 * transcript does not have yet. The same replies return the same array.
 */
export function useStreamedReplies(
  items: SessionItem[],
  streaming: Streaming | undefined,
): StreamedReply[] {
  const [state, setState] = useState(() => advance(undefined, items, streaming));
  // New items or a new reply adjust the state as this renders.
  const current =
    state.items === items && state.streaming === streaming
      ? state
      : advance(state, items, streaming);
  if (current !== state) setState(current);
  // A reply that waits for the transcript leaves after a while, even with
  // nothing else to show.
  const waiting = [...current.kept]
    .filter(([, reply]) => reply.stopped)
    .map(([id]) => id)
    .join(" ");
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(
      () => setState((state) => advance(state, state.items, state.streaming, true)),
      KEEP_MS,
    );
    return () => clearTimeout(timer);
  }, [waiting]);
  return current.shown;
}

/** `items` with the streamed replies after them. */
export function withStreamedReplies(items: SessionItem[], replies: StreamedReply[]) {
  if (!replies.length) return items;
  return [...items, ...replies.map((reply) => ({ kind: "agent" as const, ...reply }))];
}
