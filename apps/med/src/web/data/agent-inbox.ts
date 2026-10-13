import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  agentInboxStateSchema,
  agentMessageSchema,
  type AgentInboxState,
  type AgentMessage,
  type AgentMessageInput,
} from "../../shared/agent-inbox";
import type { ContentBlock } from "../../shared/agent-session";
import type { SessionItem } from "./session-store";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Follows a review's messages to its agents, its drafts, and who waits. */
async function followInbox(
  reviewId: string,
  onState: (state: AgentInboxState) => void,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const api = createApi(fetcher, readBrowserToken());
  let delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await api.stream(
        `/api/reviews/${encodeURIComponent(reviewId)}/agent/events`,
        signal,
      );
      if (response.status === 404) return;
      if (!response.ok || !response.body) throw new Error("The inbox stream closed.");
      delay = 1000;
      await readServerEvents(
        response.body,
        (event) => {
          if (event.event !== "state") return;
          const parsed = agentInboxStateSchema.safeParse(JSON.parse(event.data));
          if (parsed.success) onState(parsed.data);
        },
        signal,
        4 * 1024 * 1024,
      );
    } catch {
      if (signal.aborted) return;
    }
    await pause(delay, signal);
    delay = Math.min(delay * 2, 30_000);
  }
}

export interface AgentInbox {
  state: AgentInboxState | null;
  send(input: AgentMessageInput): Promise<AgentMessage>;
}

/** A review's agent inbox while `reviewId` is set. */
export function useAgentInbox(
  reviewId: string | null,
  fetcher: typeof fetch = browserFetch,
): AgentInbox {
  const [state, setState] = useState<{ id: string; value: AgentInboxState } | null>(null);
  useEffect(() => {
    if (!reviewId) return;
    const controller = new AbortController();
    void followInbox(
      reviewId,
      (value) => setState({ id: reviewId, value }),
      controller.signal,
      fetcher,
    );
    return () => controller.abort();
  }, [reviewId, fetcher]);
  const send = useCallback(
    async (input: AgentMessageInput) => {
      if (!reviewId) throw new Error("This review has no agent session.");
      const api = createApi(fetcher, readBrowserToken());
      const result = await api.json(
        `/api/reviews/${encodeURIComponent(reviewId)}/agent/messages`,
        z.object({ message: agentMessageSchema, state: agentInboxStateSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      setState({ id: reviewId, value: result.state });
      return result.message;
    },
    [reviewId, fetcher],
  );
  return { state: state && state.id === reviewId ? state.value : null, send };
}

const textOf = (item: SessionItem) =>
  item.kind === "user"
    ? item.content.map((block) => (block.type === "text" ? block.text : "")).join("")
    : "";

/**
 * A message from Med as the thread shows it. `sending` is the browser's own
 * copy while the host has not answered; a failed send can go again.
 */
export type SentMessage = Omit<AgentMessage, "delivery"> & {
  delivery: AgentMessage["delivery"] | "sending";
  retry?(): void;
  discard?(): void;
};

/** What the agent reads of a message: its text, or else its first comment. */
const needleOf = (message: SentMessage) =>
  (message.text || message.comments?.[0]?.text || "").slice(0, 120);

/**
 * The thread with the messages sent from Med.
 *
 * A message joins the thread where the agent took it, not where the user
 * sent it: an agent that works takes a message only when it waits again, so
 * the send time could split its turn. A message that the agent has not taken
 * waits at the end and starts no turn. When the agent's own copy is in the
 * thread, as for a session that Med runs or a Codex queue, that copy stays,
 * with Med's text and comments.
 */
export function withSentMessages(items: SessionItem[], messages: SentMessage[]) {
  if (!messages.length) return items;
  const merged = [...items];
  const waiting: SessionItem[] = [];
  for (const message of messages) {
    const sentAt = Date.parse(message.createdAt);
    const content: ContentBlock[] =
      message.text || !message.comments?.length
        ? [
            {
              type: "text",
              text:
                message.text ||
                `${message.noteIds.length} ${message.noteIds.length === 1 ? "comment" : "comments"}`,
            },
          ]
        : [];
    const needle = needleOf(message);
    const copy = needle
      ? merged.findIndex(
          (item) =>
            item.kind === "user" &&
            !item.sent &&
            item.at >= sentAt - 1000 &&
            textOf(item).includes(needle),
        )
      : -1;
    if (copy >= 0) {
      const own = merged[copy] as Extract<SessionItem, { kind: "user" }>;
      merged[copy] = {
        ...own,
        content: [...own.content.filter((block) => block.type === "image"), ...content],
        sent: message,
      };
      continue;
    }
    const taken = message.delivery === "delivered";
    const item: SessionItem = {
      kind: "user",
      id: `med-${message.id}`,
      at: taken ? Date.parse(message.deliveredAt ?? message.createdAt) : sentAt,
      content,
      sent: message,
      ...(taken ? {} : { queued: true }),
    };
    if (!taken) {
      waiting.push(item);
      continue;
    }
    let index = merged.length;
    while (index > 0 && merged[index - 1]!.at > item.at) index--;
    merged.splice(index, 0, item);
  }
  return waiting.length ? [...merged, ...waiting.sort((a, b) => a.at - b.at)] : merged;
}
