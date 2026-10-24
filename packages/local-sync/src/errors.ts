/**
 * Typed failures let a client say what happened without reading messages.
 * `classifySyncFailure` maps them, and plain HTTP statuses, to user states.
 */

/** The server answered with a non-success status. */
export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly response?: Response,
  ) {
    super(`Shared API request failed (${status})`);
    this.name = "SyncHttpError";
  }
}

/** No usable answer arrived: no connection, a timeout, a dropped or foreign response. */
export class SyncNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SyncNetworkError";
  }
}

/** Local state belongs to another account, server, namespace or epoch. */
export class SyncScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncScopeError";
  }
}

/** A local change that this protocol cannot send, such as an oversized value. */
export class SyncRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRecordError";
  }
}
