import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  agentPresetSchema,
  ownedStateSchema,
  type AgentPreset,
  type OwnedAction,
  type OwnedState,
} from "../../shared/owned-session";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** The agents that Med can start on this computer, once `enabled`. */
export function useAgentPresets(enabled: boolean, fetcher: typeof fetch = browserFetch) {
  const [agents, setAgents] = useState<AgentPreset[] | null>(null);
  useEffect(() => {
    if (!enabled || agents) return;
    const controller = new AbortController();
    createApi(fetcher, readBrowserToken())
      .json("/api/agents", z.object({ agents: z.array(agentPresetSchema) }), {
        signal: controller.signal,
      })
      .then((result) => setAgents(result.agents))
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, agents, fetcher]);
  return agents;
}

export interface OwnedSession {
  /** Null until the host answers, and for a session that Med does not run. */
  state: OwnedState | null;
  act(action: OwnedAction): Promise<void>;
}

const ownedPath = (reviewId: string, sessionId: string) =>
  `/api/reviews/${encodeURIComponent(reviewId)}/owned/${encodeURIComponent(sessionId)}`;

/** Sends an action to a session that Med runs, such as the answer to its question. */
export function sendOwnedAction(
  reviewId: string,
  sessionId: string,
  action: OwnedAction,
  fetcher: typeof fetch = browserFetch,
) {
  return createApi(fetcher, readBrowserToken()).json(
    ownedPath(reviewId, sessionId),
    ownedStateSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    },
  );
}

/**
 * A session that Med runs: its status, settings, commands, and the question
 * that waits for the user. A session that Med only reads has no state.
 */
export function useOwnedSession(
  reviewId: string,
  sessionId: string,
  fetcher: typeof fetch = browserFetch,
): OwnedSession {
  const [state, setState] = useState<{ id: string; value: OwnedState } | null>(null);
  const path = ownedPath(reviewId, sessionId);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        try {
          const response = await api.stream(`${path}/events`, signal);
          // Med does not run this session; its thread comes from the transcript only.
          if (response.status === 404) return setState(null);
          if (!response.ok || !response.body) throw new Error("The session stream closed.");
          delay = 1000;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const parsed = ownedStateSchema.safeParse(JSON.parse(event.data));
              if (parsed.success) setState({ id: sessionId, value: parsed.data });
            },
            signal,
            1024 * 1024,
          );
        } catch {
          if (signal.aborted) return;
        }
        await pause(delay, signal);
        delay = Math.min(delay * 2, 30_000);
      }
    })();
    return () => controller.abort();
  }, [path, sessionId, fetcher]);
  const act = useCallback(
    async (action: OwnedAction) => {
      setState({
        id: sessionId,
        value: await sendOwnedAction(reviewId, sessionId, action, fetcher),
      });
    },
    [reviewId, sessionId, fetcher],
  );
  return { state: state?.id === sessionId ? state.value : null, act };
}
