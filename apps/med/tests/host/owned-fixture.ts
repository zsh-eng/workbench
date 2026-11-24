import { expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { applyOwnedStreamEvent, type OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { readServerEvents } from "../../src/web/data/sse";
import { removeFolder } from "./remove-folder";

// The agents that Med runs, through the production host: a review starts
// one, and its thread streams what it does. Fake agents answer (fixtures/agents).
// Each owned-*.test.ts file runs its own hosts with afterEach(cleanup).

/** A one-pixel PNG, in base64. */
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const directories: string[] = [];
const hosts: RunningHost[] = [];
export const streams: AbortController[] = [];
/** Ends the test's streams, hosts, agents, and folders. */
export async function cleanup() {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const agentScript = (name: string) =>
  fileURLToPath(new URL(`../fixtures/agents/${name}`, import.meta.url));

export async function fixture({ key, agy = true }: { key?: string; agy?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med owned sessions ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  // Pi keeps its sessions here (fake-pi.mjs), and Med's bridge finds them here.
  vi.stubEnv("PI_CODING_AGENT_DIR", join(home, ".pi", "agent"));
  const stateDir = join(directory, "state");
  const options: Parameters<typeof startHost>[0] = {
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    statusMs: 100,
    agy,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-claude.mjs")],
      },
      {
        id: "fake",
        name: "Fake ACP",
        kind: "acp",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-acp.mjs")],
      },
      {
        id: "codex",
        name: "Codex",
        kind: "codex",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-codex-app-server.mjs")],
      },
      {
        id: "agy",
        name: "Antigravity",
        kind: "agy",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-agy.mjs")],
      },
      {
        id: "pi",
        name: "Pi",
        kind: "pi",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-pi.mjs")],
      },
      { id: "missing", name: "Missing", kind: "acp", available: false, command: "x", args: [] },
    ],
  };
  let host = await startHost(options);
  hosts.push(host);
  /** Closes the host and starts it again on the same state, as a restart
   * does. With `reboot`, the agents and their holders end too, as when the
   * Mac restarts. `closed` runs while no host runs. */
  const restart = async ({
    reboot = false,
    closed,
  }: { reboot?: boolean; closed?: () => Promise<void> } = {}) => {
    await host.close();
    hosts.splice(hosts.indexOf(host), 1);
    await closed?.();
    if (reboot) {
      const agents = join(stateDir, "agents");
      for (const name of await readdir(agents).catch(() => [] as string[])) {
        if (!name.endsWith(".json")) continue;
        const info = JSON.parse(await readFile(join(agents, name), "utf8")) as {
          pid: number;
          agentPid?: number;
        };
        for (const pid of [info.pid, info.agentPid]) if (pid) process.kill(pid, "SIGKILL");
        await vi.waitFor(() => {
          for (const pid of [info.pid, info.agentPid]) if (pid && alive(pid)) throw new Error();
        });
      }
    }
    host = await startHost(options);
    hosts.push(host);
    return host;
  };
  const api = async <T>(path: string, body?: unknown, method?: "PUT") => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const review = (
    await api<SavedReview>("/api/reviews", {
      title: "Format durations",
      ...(key && { key }),
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).data;
  /** The threads of the sessions that `start` started, by session ID. */
  const keys = new Map<string, string>();
  /** The session's transcript, as the browser reads it: by its thread's key,
   * or by the ID of a session that `start` started. */
  const thread = async (session: string) => {
    const key = keys.get(session) ?? session;
    const response = await fetch(`http://127.0.0.1:${host.port}/api/sessions/${key}/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(200);
    const events: SessionEvent[] = [];
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => {
        const payload = JSON.parse(event.data) as { events: SessionEvent[] };
        if (event.event === "reset") events.length = 0;
        events.push(...payload.events);
      },
      controller.signal,
      4 * 1024 * 1024,
    ).catch(() => {});
    // The replies; `events` has every update.
    return Object.assign(
      () =>
        events.flatMap((event) =>
          event.update.sessionUpdate === "agent_message_chunk" &&
          event.update.content.type === "text"
            ? [event.update.content.text]
            : [],
        ),
      { events },
    );
  };
  /** Starts an agent on the review: the review becomes the new session's. */
  const start = async (preset: string, choices?: { model?: string; effort?: string }) => {
    const started = await api<{ thread: string; state: OwnedState }>(
      `/api/reviews/${review.id}/start`,
      { preset, choices },
    );
    expect(started.status).toBe(200);
    const id = started.data.state.sessionId;
    const threadId = started.data.thread;
    keys.set(id, threadId);
    const path = `/api/sessions/${threadId}/owned`;
    const state = async () => (await api<OwnedState>(path)).data;
    const until = (check: (state: OwnedState) => boolean) =>
      vi.waitFor(
        async () => {
          const value = await state();
          if (!check(value)) throw new Error(`Not yet: ${JSON.stringify(value)}`);
          return value;
        },
        { timeout: 5000 },
      );
    const act = (action: unknown) => api<OwnedState>(path, action);
    /** The states that the host streams to the page, from now on. */
    const follow = async () => {
      const seen: OwnedState[] = [];
      const response = await fetch(`http://127.0.0.1:${host.port}${path}/events`, {
        headers: { authorization: `Bearer ${host.token}` },
      });
      const controller = new AbortController();
      streams.push(controller);
      void readServerEvents(
        response.body!,
        (event) => {
          const next = applyOwnedStreamEvent(seen.at(-1), event);
          if (next) seen.push(next);
        },
        controller.signal,
      ).catch(() => {});
      return seen;
    };
    const saved = (await api<SavedReview>(`/api/reviews/${review.id}`)).data;
    return { id, thread: threadId, review: saved, state, until, act, follow };
  };
  /** The thread list's stream, with each thread's lead session state. */
  const threads = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const latest: { value: Thread[] } = { value: [] };
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => (latest.value = (JSON.parse(event.data) as ThreadList).threads),
      controller.signal,
    ).catch(() => {});
    return latest;
  };
  return { api, repo, home, review, stateDir, thread, start, threads, restart };
}
