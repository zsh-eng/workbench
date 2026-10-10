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
import { readServerEvents } from "./sse";

const browserFetch: typeof fetch = (...args) => globalThis.fetch(...args);

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
  const path = `/api/reviews/${encodeURIComponent(reviewId)}/owned/${encodeURIComponent(sessionId)}`;
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
      const next = await createApi(fetcher, readBrowserToken()).json(path, ownedStateSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      setState({ id: sessionId, value: next });
    },
    [path, sessionId, fetcher],
  );
  return { state: state?.id === sessionId ? state.value : null, act };
}
