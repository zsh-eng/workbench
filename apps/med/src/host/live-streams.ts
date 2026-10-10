import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

/**
 * A page's live stream carries its other event streams as channels. Browsers
 * open at most six connections to one host over HTTP/1.1, and each open event
 * stream keeps one; with a stream for each view, a page had no connection left
 * for its other requests.
 */
export const liveInputSchema = z.object({
  open: z
    .array(z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), path: z.string().max(4096) }))
    .max(16)
    .default([]),
  close: z.array(z.string().max(40)).max(64).default([]),
});

/** The event streams that a channel can carry. */
export const LIVE_PATH =
  /^\/api\/(?:events|windows|agent-status\/events|pulls\/[A-Za-z0-9-]+\/events|reviews\/[A-Za-z0-9_-]+\/(?:agent|sessions\/[A-Za-z0-9_-]+|owned\/[A-Za-z0-9_-]+)\/events)(?:\?[^#]*)?$/;

/** The GET request that a channel gives to its stream handler. */
export function channelRequest(request: IncomingMessage, path: string) {
  const { host, origin, authorization, cookie } = request.headers;
  return Object.assign(new EventEmitter(), {
    method: "GET",
    url: path,
    headers: {
      host,
      accept: "text/event-stream",
      ...(origin ? { origin } : {}),
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
  }) as unknown as IncomingMessage;
}

/**
 * The response that a stream handler writes for one channel. It sends each
 * server event to the live stream with the channel's key, as `key:event`, and
 * `key:end` when the handler ends the stream. A refused channel keeps its
 * status and body for the reply.
 */
export class ChannelResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  body = "";
  /** Settles when the handler sends its status or stops. */
  readonly head: Promise<void>;
  private settle!: () => void;
  private pending = "";
  private closed = false;

  constructor(
    private readonly key: string,
    private readonly forward: (text: string) => void,
  ) {
    super();
    this.head = new Promise((resolve) => (this.settle = resolve));
  }

  setHeader() {
    return this;
  }

  writeHead(status: number) {
    this.statusCode = status;
    this.headersSent = true;
    this.settle();
    return this;
  }

  write(chunk: string | Uint8Array) {
    if (this.closed) return false;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (this.statusCode !== 200) {
      this.body += text;
      return true;
    }
    this.pending += text;
    for (let end = this.pending.indexOf("\n\n"); end >= 0; end = this.pending.indexOf("\n\n")) {
      const frame = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 2);
      let name = "message";
      const fields: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else fields.push(line);
      }
      if (fields.length) this.forward(`event: ${this.key}:${name}\n${fields.join("\n")}\n\n`);
    }
    return true;
  }

  end(chunk?: string | Uint8Array) {
    if (chunk !== undefined) this.write(chunk);
    this.writableEnded = true;
    this.finish();
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.finish();
    return this;
  }

  private finish() {
    if (this.closed) return;
    this.closed = true;
    this.settle();
    if (this.headersSent && this.statusCode === 200)
      this.forward(`event: ${this.key}:end\ndata: {}\n\n`);
    this.emit("close");
  }
}
