import { readServerEvents } from "./sse";

/**
 * The browser's own fetch. Event streams through it share one connection per
 * page (see `liveStream`); a fetch that a test or demo gives keeps separate
 * streams.
 */
export const browserFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** A live stream carries every channel, so it allows the largest channel event. */
const LIVE_EVENT_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

interface Live {
  token: string;
  /** The stream's ID, or undefined when the host does not offer live streams. */
  id: Promise<string | undefined>;
  channels: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  closed: boolean;
}

let current: Live | undefined;
let sequence = 0;

const headers = (token: string, input?: Record<string, string>) => {
  const result = new Headers(input);
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
};

const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
  try {
    controller.close();
  } catch {
    /* The reader cancelled the stream. */
  }
};

function connect(token: string): Live {
  const live: Live = { token, id: Promise.resolve(undefined), channels: new Map(), closed: false };
  live.id = new Promise((resolve) => {
    void (async () => {
      const response = await browserFetch("/api/live", {
        headers: headers(token, { Accept: "text/event-stream" }),
      });
      if (!response.ok || !response.body) return;
      await readServerEvents(
        response.body,
        (event) => {
          if (event.event === "live") {
            resolve((JSON.parse(event.data) as { id: string }).id);
            return;
          }
          const split = event.event.indexOf(":");
          const key = event.event.slice(0, split);
          const name = event.event.slice(split + 1);
          const controller = live.channels.get(key);
          if (!controller) return;
          if (name === "end") {
            live.channels.delete(key);
            close(controller);
            return;
          }
          const data = event.data
            .split("\n")
            .map((line) => `data: ${line}`)
            .join("\n");
          controller.enqueue(encoder.encode(`event: ${name}\n${data}\n\n`));
        },
        undefined,
        LIVE_EVENT_BYTES,
      );
    })()
      .catch(() => {})
      .finally(() => {
        // Each channel ends with the stream; its reader then connects again.
        live.closed = true;
        if (current === live) current = undefined;
        for (const controller of live.channels.values()) close(controller);
        live.channels.clear();
        resolve(undefined);
      });
  });
  return live;
}

/**
 * Open an event stream as a channel of the page's live stream. Browsers open at
 * most six connections to one host over HTTP/1.1, and each open stream keeps
 * one; separate streams for windows, repository events, the inbox, agent
 * states, and sessions would leave none for other requests. The result reads
 * like a direct stream: a channel that the host refuses has the host's status
 * and error body. Without live streams, the stream is direct.
 */
export async function liveStream(token: string, url: string, signal: AbortSignal) {
  const direct = () =>
    browserFetch(url, { headers: headers(token, { Accept: "text/event-stream" }), signal });
  if (!current || current.closed || current.token !== token) current = connect(token);
  const live = current;
  const id = await live.id;
  signal.throwIfAborted();
  if (!id || live.closed) return direct();
  const key = `c${++sequence}`;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (value) => {
      controller = value;
    },
    cancel: () => release(),
  });
  live.channels.set(key, controller);
  const post = (input: object) =>
    browserFetch(`/api/live/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
  // The open request has no signal, and a close waits for it, so the host never
  // keeps a channel that the reader left during the request.
  const opening = post({ open: [{ key, path: url }] }).catch(() => undefined);
  const release = () => {
    if (!live.channels.delete(key)) return;
    close(controller);
    if (!live.closed) void opening.then(() => post({ close: [key] })).catch(() => {});
  };
  signal.addEventListener("abort", release, { once: true });
  const reply = await opening;
  const result = reply?.ok
    ? ((await reply.json()) as { channels: { key: string; status: number; body?: unknown }[] })
        .channels[0]
    : undefined;
  if (!result) {
    release();
    signal.throwIfAborted();
    throw new Error("The live stream did not open the channel.");
  }
  signal.throwIfAborted();
  if (result.status !== 200) {
    live.channels.delete(key);
    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}
