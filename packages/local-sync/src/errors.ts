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

/**
 * A value larger than one synced record can hold. Encoders, the Dexie
 * middleware and push batching throw it before any request, so an app can
 * say what is too large instead of showing a schema failure.
 */
export class SyncValueTooLargeError extends SyncRecordError {
  constructor(
    public readonly bytes: number,
    public readonly limit: number,
    public readonly key?: string,
  ) {
    super(
      `Cannot synchronize ${key ? `record ${key}` : "a record"}: it is ${bytes} bytes, more than the ${limit} that one record can hold`,
    );
    this.name = "SyncValueTooLargeError";
  }
}
