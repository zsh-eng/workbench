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

/** A JSON-RPC message, as one line of newline-delimited JSON. */
export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function parseRpc(line: string): RpcMessage | undefined {
  try {
    const message = JSON.parse(line) as unknown;
    return message && typeof message === "object" ? (message as RpcMessage) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * JSON-RPC 2.0 as newline-delimited JSON, as the Agent Client Protocol uses
 * on an agent's stdin and stdout. Both sides can send requests. `send`
 * writes a line to the peer, and `receive` takes each line from it.
 */
export function createJsonRpc(send: (line: string) => void, handlers: Handlers) {
  let next = 0;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: RpcError): void }
  >();
  const write = (message: object) => send(JSON.stringify({ jsonrpc: "2.0", ...message }));
  const answer = (id: number | string, method: string, params: unknown) =>
    handlers.request(method, params).then(
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
  return {
    receive(line: string) {
      const message = parseRpc(line);
      if (!message) return;
      if (message.method !== undefined && message.id !== undefined)
        void answer(message.id, message.method, message.params);
      else if (message.method !== undefined) handlers.notify(message.method, message.params);
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
    },
    /** `settle` runs as the answer arrives, before the promise settles. */
    request<T = unknown>(
      method: string,
      params: unknown,
      settle?: (result: unknown, error?: RpcError) => void,
    ): Promise<T> {
      const id = ++next;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve(value) {
            settle?.(value);
            resolve(value as T);
          },
          reject(error) {
            settle?.(undefined, error);
            reject(error);
          },
        });
        write({ id, method, params });
      });
    },
    notify(method: string, params: unknown) {
      write({ method, params });
    },
    /** The ID of the last request that this side sent. */
    last: () => next,
    /**
     * Takes up the work of an earlier host, read from the session's log:
     * requests that it sent wait for their answers here, and the peer's
     * requests that it did not answer get answers now.
     */
    resume(
      sent: Map<number, (result: unknown, error?: RpcError) => void>,
      asked: Map<number | string, { method: string; params: unknown }>,
      lastId: number,
    ) {
      next = Math.max(next, lastId);
      for (const [id, done] of sent)
        pending.set(id, {
          resolve: (value) => done(value),
          reject: (error) => done(undefined, error),
        });
      for (const [id, { method, params }] of asked) void answer(id, method, params);
    },
    /** Rejects the requests that wait for an answer, as when the peer exits. */
    close(reason: string) {
      for (const entry of pending.values()) entry.reject(new RpcError(reason, 0));
      pending.clear();
    },
  };
}
export type JsonRpc = ReturnType<typeof createJsonRpc>;
