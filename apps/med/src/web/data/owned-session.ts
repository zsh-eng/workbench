import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  agentOptionsSchema,
  agentPresetSchema,
  ownedStateSchema,
  type AgentOptions,
  type AgentPreset,
  type OwnedAction,
  type OwnedState,
} from "../../shared/owned-session";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";
import { reconnectPause } from "./reconnect";

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

// Kept for the window: Claude Code answers in about a second the first time.
const agentOptions = new Map<string, AgentOptions>();

/** The models and efforts that an agent offers for a new session. */
export function useAgentOptions(preset: string | undefined, fetcher: typeof fetch = browserFetch) {
  const [options, setOptions] = useState(() => (preset ? agentOptions.get(preset) : undefined));
  const [shown, setShown] = useState(preset);
  if (shown !== preset) {
    setShown(preset);
    setOptions(preset ? agentOptions.get(preset) : undefined);
  }
  useEffect(() => {
    if (!preset) return;
    const controller = new AbortController();
    createApi(fetcher, readBrowserToken())
      .json(`/api/agents/${encodeURIComponent(preset)}/choices`, agentOptionsSchema, {
        signal: controller.signal,
      })
      .then((result) => {
        agentOptions.set(preset, result);
        setOptions(result);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [preset, fetcher]);
  return options;
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
 * that waits for the user. A session that Med only reads has no state. A new
 * `generation` asks again, as when Med resumes a session that it only read.
 */
export function useOwnedSession(
  reviewId: string,
  sessionId: string,
  fetcher: typeof fetch = browserFetch,
  generation = "",
): OwnedSession {
  const [state, setState] = useState<{ id: string; value: OwnedState } | null>(null);
  const path = ownedPath(reviewId, sessionId);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        try {
          const response = await api.stream(`${path}/events`, signal);
          // Med does not run this session; its thread comes from the transcript only.
          if (response.status === 404) return setState(null);
          if (!response.ok || !response.body) throw new Error("The session stream closed.");
          attempt = 0;
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
        await reconnectPause(attempt++, signal);
      }
    })();
    return () => controller.abort();
    // A new generation follows the session again.
  }, [path, sessionId, fetcher, generation]);
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
