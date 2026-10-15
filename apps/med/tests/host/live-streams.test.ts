import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { createApi } from "../../src/web/data/api";
import { browserFetch } from "../../src/web/data/live";
import { readServerEvents, type ServerEvent } from "../../src/web/data/sse";

const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllGlobals();
});

test("a page reads all its event streams over one connection", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med live ")));
  directories.push(directory);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: directory });
  await writeFile(join(directory, "a.ts"), "export const a = 1;\n");
  const host = await startHost({ repo: directory, repos: [directory], port: 0 });
  hosts.push(host);
  const base = `http://127.0.0.1:${host.port}`;
  // The browser's fetch, with the page's origin, and each request it makes.
  const requests: string[] = [];
  const nodeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${input}`);
    return nodeFetch(new URL(input, base), init);
  });
  const api = createApi(browserFetch, host.token);
  const plain = async <T>(path: string, body: unknown) =>
    (await browserFetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json())) as T;
  const review = await plain<SavedReview>("/api/reviews", {
    title: "Live",
    targets: [{ repo: directory, comparison: { kind: "working" } }],
  });

  const open = async (path: string) => {
    const controller = new AbortController();
    streams.push(controller);
    const response = await api.stream(path, controller.signal);
    const events: ServerEvent[] = [];
    const done = response.ok
      ? readServerEvents(response.body!, (event) => events.push(event), controller.signal)
      : Promise.resolve();
    return { response, events, done, close: () => controller.abort() };
  };
  // More streams than a browser opens connections to one host.
  const paths = [
    "/api/windows",
    "/api/windows",
    `/api/events?repo=${encodeURIComponent(directory)}`,
    `/api/events?repo=${encodeURIComponent(directory)}`,
    "/api/threads/events",
    `/api/reviews/${review.id}/agent/events`,
    `/api/reviews/${review.id}/agent/events`,
    "/api/threads/events",
  ];
  const opened = await Promise.all(paths.map(open));
  await vi.waitFor(() => {
    for (const stream of opened) expect(stream.events.length).toBeGreaterThan(0);
  });
  expect(opened.map((stream) => stream.events[0]!.event)).toEqual([
    "ready",
    "ready",
    "ready",
    "ready",
    "state",
    "state",
    "state",
    "state",
  ]);
  expect(JSON.parse(opened[5]!.events[0]!.data)).toEqual({
    messages: [],
    waiting: [],
    drafts: [],
    elsewhere: {},
    resumable: [],
  });
  // The thread list names the saved review and the repository.
  expect(JSON.parse(opened[7]!.events[0]!.data)).toMatchObject({
    threads: [{ id: review.id, title: "Live", checkout: directory }],
    repositories: [{ path: directory }],
  });
  expect(requests.filter((request) => request.startsWith("GET"))).toEqual(["GET /api/live"]);

  // Later events reach their channels; a closed channel stops on the host.
  const [first, second] = opened;
  expect(await plain("/api/windows/review", { id: review.id })).toEqual({ windows: 2 });
  await vi.waitFor(() => expect(second!.events.at(-1)?.event).toBe("review"));
  expect(JSON.parse(first!.events.at(-1)!.data)).toMatchObject({ id: review.id, title: "Live" });
  first!.close();
  await vi.waitFor(async () =>
    expect(await plain("/api/windows/review", { id: review.id })).toEqual({ windows: 1 }),
  );

  // A channel that the host refuses reads like a refused stream.
  const missing = await open(`/api/reviews/${review.id}/sessions/nothing/events`);
  expect(missing.response.status).toBe(404);
  expect(await missing.response.json()).toMatchObject({ error: { code: "session-not-found" } });

  // When the host stops, each channel ends, so its reader connects again.
  await host.close();
  hosts.splice(0);
  await Promise.all(opened.slice(1).map((stream) => stream.done));
});

test("the live stream takes a WebSocket from the page, with its cookie, and refuses others", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med socket ")));
  directories.push(directory);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: directory });
  const host = await startHost({ repo: directory, repos: [directory], port: 0 });
  hosts.push(host);
  const url = `ws://127.0.0.1:${host.port}/api/live`;
  const origin = `http://127.0.0.1:${host.port}`;
  const cookie = `med_session_${host.port}=${host.token}`;
  // Node's WebSocket takes headers that a page's browser sends for it.
  const connect = (headers: Record<string, string>) =>
    new Promise<{ messages: string[]; socket: WebSocket } | "refused">((resolve) => {
      const socket = new WebSocket(url, { headers } as unknown as string[]);
      const messages: string[] = [];
      socket.onmessage = (event) => {
        messages.push(String(event.data));
        resolve({ messages, socket });
      };
      socket.onerror = () => resolve("refused");
    });

  const page = await connect({ origin, cookie });
  if (page === "refused") throw new Error("The host refused the page's WebSocket.");
  const { id } = JSON.parse(/^data: (.*)$/m.exec(page.messages[0]!)![1]!) as { id: string };
  // A channel opened over HTTP sends its events down the socket.
  const response = await fetch(`${origin}/api/live/${id}`, {
    method: "POST",
    headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
    body: JSON.stringify({ open: [{ key: "c1", path: "/api/threads/events" }], close: [] }),
  });
  expect(await response.json()).toEqual({ channels: [{ key: "c1", status: 200 }] });
  await vi.waitFor(() =>
    expect(page.messages.some((message) => message.startsWith("event: c1:state\n"))).toBe(true),
  );
  page.socket.close();

  expect(await connect({ origin })).toBe("refused");
  expect(await connect({ origin: "http://example.com", cookie })).toBe("refused");
});
