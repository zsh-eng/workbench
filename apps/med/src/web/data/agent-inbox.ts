import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  agentInboxStateSchema,
  agentMessageSchema,
  type AgentInboxState,
  type AgentMessage,
  type AgentMessageInput,
} from "../../shared/agent-inbox";
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
 * The thread with the messages sent from Med, each at the time it was sent.
 * A Codex session writes a queued message into its rollout once it reads it,
 * and a session that Med runs takes it as a prompt; then the thread's copy
 * stays and Med's copy goes.
 */
export function withSentMessages(items: SessionItem[], messages: AgentMessage[]) {
  if (!messages.length) return items;
  const sent: SessionItem[] = messages
    .filter((message) => {
      if (!message.text) return true;
      const start = Date.parse(message.createdAt);
      const needle = message.text.slice(0, 120);
      return !items.some(
        (item) => item.kind === "user" && item.at >= start - 1000 && textOf(item).includes(needle),
      );
    })
    .map((message) => ({
      kind: "user",
      id: `med-${message.id}`,
      at: Date.parse(message.createdAt),
      content: [
        {
          type: "text",
          text:
            message.text ||
            `${message.noteIds.length} ${message.noteIds.length === 1 ? "comment" : "comments"}`,
        },
      ],
      sent: message,
    }));
  const merged = [...items];
  for (const item of sent) {
    let index = merged.length;
    while (index > 0 && merged[index - 1]!.at > item.at) index--;
    merged.splice(index, 0, item);
  }
  return merged;
}
