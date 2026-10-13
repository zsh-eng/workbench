import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** The largest frame a page may send; pages only send pings and close. */
const MAX_FRAME = 64 * 1024;

/**
 * The host's end of a WebSocket (RFC 6455) that sends text messages. Med's
 * live stream needs no more: a page opens and closes its channels over HTTP.
 * A WebSocket does not take one of the six HTTP connections that a browser
 * allows each host, which every Med window's event stream used to hold.
 */
export interface WebSocketPeer {
  send(text: string): void;
  /** Ends `write` and `end` callers, as a response does. */
  readonly writableEnded: boolean;
  write(text: string): boolean;
  end(): void;
  onClose(listener: () => void): void;
}

function frame(opcode: number, payload: Buffer) {
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65_536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), bigLength(length)]);
  return Buffer.concat([head, payload]);
}
function bigLength(length: number) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(length));
  return bytes;
}

/** Completes the handshake of an upgrade request, or returns undefined when it is not one. */
export function acceptWebSocket(
  request: IncomingMessage,
  socket: Duplex,
): WebSocketPeer | undefined {
  const key = request.headers["sec-websocket-key"];
  if (
    typeof key !== "string" ||
    request.headers.upgrade?.toLowerCase() !== "websocket" ||
    request.headers["sec-websocket-version"] !== "13"
  )
    return undefined;
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  if ("setNoDelay" in socket && typeof socket.setNoDelay === "function") socket.setNoDelay(true);

  let closed = false;
  const listeners = new Set<() => void>();
  const finish = () => {
    if (closed) return;
    closed = true;
    socket.destroy();
    for (const listener of listeners) listener();
    listeners.clear();
  };
  let buffered: Buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    while (buffered.length >= 2) {
      const opcode = buffered[0]! & 0x0f;
      const masked = (buffered[1]! & 0x80) !== 0;
      let length = buffered[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const long = buffered.readBigUInt64BE(2);
        length = long > BigInt(MAX_FRAME) ? MAX_FRAME + 1 : Number(long);
        offset = 10;
      }
      // A page's frames are masked and small; anything else ends the socket.
      if (!masked || length > MAX_FRAME) return finish();
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4);
      const payload = Buffer.from(buffered.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
      buffered = buffered.subarray(offset + 4 + length);
      if (opcode === 0x8) {
        socket.write(frame(0x8, Buffer.alloc(0)));
        return finish();
      }
      if (opcode === 0x9) socket.write(frame(0xa, payload));
    }
  });
  socket.on("close", finish);
  socket.on("end", finish);
  socket.on("error", finish);

  const write = (text: string) => !closed && socket.write(frame(0x1, Buffer.from(text, "utf8")));
  return {
    send: (text) => void write(text),
    write,
    get writableEnded() {
      return closed;
    },
    end() {
      if (closed) return;
      socket.write(frame(0x8, Buffer.alloc(0)));
      finish();
    },
    onClose: (listener) => {
      if (closed) listener();
      else listeners.add(listener);
    },
  };
}
