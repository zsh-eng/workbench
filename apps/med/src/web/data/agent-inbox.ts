import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  agentInboxStateSchema,
  agentMessageSchema,
  type AgentInboxState,
  type AgentMessage,
  type AgentMessageInput,
  type SessionPlace,
} from "../../shared/agent-inbox";
import type { ContentBlock } from "../../shared/agent-session";
import type { SessionItem } from "./session-store";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";
import { reconnectPause } from "./reconnect";

/** Follows a review's messages to its agents, its drafts, and who waits. */
async function followInbox(
  threadId: string,
  onState: (state: AgentInboxState) => void,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const api = createApi(fetcher, readBrowserToken());
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const response = await api.stream(
        `/api/sessions/${encodeURIComponent(threadId)}/agent/events`,
        signal,
      );
      if (response.status === 404) return;
      if (!response.ok || !response.body) throw new Error("The inbox stream closed.");
      attempt = 0;
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
    await reconnectPause(attempt++, signal);
  }
}

export interface AgentInbox {
  state: AgentInboxState | null;
  send(input: AgentMessageInput): Promise<AgentMessage>;
  /** Takes back a queued message that the agent has not had, and returns it. */
  takeBack?(id: string): Promise<AgentMessage>;
  /** Send now on a queued message: the agent takes it at its next step, not
   * at its turn's end. */
  sendNow?(id: string): Promise<void>;
  /** Deletes comments that wait in the message box, from wherever they are. */
  deleteComments?(ids: string[]): Promise<void>;
}

/** A thread's agent inbox while `threadId` is set. */
export function useAgentInbox(
  threadId: string | null,
  fetcher: typeof fetch = browserFetch,
): AgentInbox {
  const [state, setState] = useState<{ id: string; value: AgentInboxState } | null>(null);
  useEffect(() => {
    if (!threadId) return;
    const controller = new AbortController();
    void followInbox(
      threadId,
      (value) => setState({ id: threadId, value }),
      controller.signal,
      fetcher,
    );
    return () => controller.abort();
  }, [threadId, fetcher]);
  const send = useCallback(
    async (input: AgentMessageInput) => {
      if (!threadId) throw new Error("This thread has no agent session.");
      const api = createApi(fetcher, readBrowserToken());
      const result = await api.json(
        `/api/sessions/${encodeURIComponent(threadId)}/agent/messages`,
        z.object({ message: agentMessageSchema, state: agentInboxStateSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      setState({ id: threadId, value: result.state });
      return result.message;
    },
    [threadId, fetcher],
  );
  const takeBack = useCallback(
    async (id: string) => {
      if (!threadId) throw new Error("This thread has no agent session.");
      const api = createApi(fetcher, readBrowserToken());
      const result = await api.json(
        `/api/sessions/${encodeURIComponent(threadId)}/agent/take`,
        z.object({ message: agentMessageSchema, state: agentInboxStateSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        },
      );
      setState({ id: threadId, value: result.state });
      return result.message;
    },
    [threadId, fetcher],
  );
  const sendNow = useCallback(
    async (id: string) => {
      if (!threadId) throw new Error("This thread has no agent session.");
      const api = createApi(fetcher, readBrowserToken());
      const result = await api.json(
        `/api/sessions/${encodeURIComponent(threadId)}/agent/send-now`,
        z.object({ state: agentInboxStateSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        },
      );
      setState({ id: threadId, value: result.state });
    },
    [threadId, fetcher],
  );
  const deleteComments = useCallback(
    async (ids: string[]) => {
      if (!threadId) throw new Error("This thread has no agent session.");
      const api = createApi(fetcher, readBrowserToken());
      const result = await api.json(
        `/api/sessions/${encodeURIComponent(threadId)}/agent/delete-comments`,
        z.object({ state: agentInboxStateSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      setState({ id: threadId, value: result.state });
    },
    [threadId, fetcher],
  );
  return {
    state: state && state.id === threadId ? state.value : null,
    send,
    takeBack,
    sendNow,
    deleteComments,
  };
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
  /** A queued message: back into the message box, or gone, or into the
   * turn that runs, where the agent can take one (Send now). */
  edit?(): void;
  remove?(): void;
  sendNow?(): void;
};

/** Where another process has this session open, if one does. */
export const openIn = (state: AgentInboxState | null | undefined, sessionId: string) =>
  state && Object.hasOwn(state.elsewhere, sessionId) ? state.elsewhere[sessionId] : undefined;

/** How Med names where another process has a session open. */
export const SESSION_PLACES: Record<SessionPlace, { open: string }> = {
  terminal: { open: "in a terminal" },
  "claude-app": { open: "in the Claude app" },
  "other-app": { open: "in another app" },
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
