// The part of Bun's own `ws` module that the host uses under Bun. Bun builds
// the module in; Node has none, and Med installs no `ws` package.
declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";
  export class WebSocket {
    send(text: string): void;
    close(): void;
    on(event: "close" | "error", listener: () => void): this;
  }
  export class WebSocketServer {
    constructor(options: { noServer: true; maxPayload?: number });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void;
  }
}
