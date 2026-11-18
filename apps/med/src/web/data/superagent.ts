import { createContext, useContext } from "react";
import { z } from "zod";
import { agentMessageSchema, type AgentMessageInput } from "../../shared/agent-inbox";
import type { Thread } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// The Superagent for a page that talks to it in place, as a dashboard does:
// the page sends the reader's words with what it shows, and reads the
// thread's last turn from the thread list to show the answer. Workspaces
// gives it, as its thread list has it.

export interface SuperagentLink {
  /** Its thread, once Med has made it. */
  thread: Thread | undefined;
  /** Its thread's id, made the first time, without opening it. */
  start(): Promise<{ thread: string; created: boolean }>;
  /** Opens the thread, as its row in the sidebar does. */
  open(): void;
}

export const SuperagentContext = createContext<SuperagentLink | null>(null);
export const useSuperagent = () => useContext(SuperagentContext);

/** Makes the Superagent's thread the first time; then it is the same one. */
export const startSuperagent = (fetcher: typeof fetch = browserFetch) =>
  createApi(fetcher, readBrowserToken()).json(
    "/api/superagent",
    z.object({ thread: z.string(), created: z.boolean() }),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );

/** Sends a message to a thread's agent, as its message box does. */
export async function sendToThread(threadId: string, input: AgentMessageInput) {
  const result = await createApi(browserFetch, readBrowserToken()).json(
    `/api/sessions/${encodeURIComponent(threadId)}/agent/messages`,
    z.object({ message: agentMessageSchema }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.message;
}
