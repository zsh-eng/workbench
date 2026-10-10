import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** An error that a JSON-RPC peer returned. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

interface Handlers {
  /** A request from the peer; the result or error goes back to it. */
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
}

/**
 * JSON-RPC 2.0 as newline-delimited JSON on two streams, as the Agent Client
 * Protocol uses on an agent's stdin and stdout. Both sides can send requests.
 */
export function createJsonRpc(input: Writable, output: Readable, handlers: Handlers) {
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const write = (message: object) => {
    if (input.writable) input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const lines = createInterface({ input: output, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let message: {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      const id = message.id;
      handlers.request(message.method, message.params).then(
        (result) => write({ id, result: result ?? null }),
        (error: unknown) =>
          write({
            id,
            error: {
              code: error instanceof RpcError ? error.code : -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      );
    } else if (message.method !== undefined) handlers.notify(message.method, message.params);
    else if (typeof message.id === "number") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error)
        entry.reject(
          new RpcError(
            message.error.message ?? "The agent returned an error.",
            message.error.code ?? 0,
          ),
        );
      else entry.resolve(message.result);
    }
  });
  return {
    request<T = unknown>(method: string, params: unknown): Promise<T> {
      const id = ++next;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        write({ id, method, params });
      });
    },
    notify(method: string, params: unknown) {
      write({ method, params });
    },
    /** Rejects the requests that wait for an answer, as when the peer exits. */
    close(reason: string) {
      lines.close();
      for (const entry of pending.values()) entry.reject(new Error(reason));
      pending.clear();
    },
  };
}
export type JsonRpc = ReturnType<typeof createJsonRpc>;
