import { z } from "zod/mini";
import { en } from "zod/locales";
import { SyncRecordError, SyncValueTooLargeError } from "./errors.js";

// zod/mini ships without messages; English keeps the issue text that
// classic zod gave (it appears in rejected-record failures).
z.config(en());

export const SYNC_PROTOCOL_VERSION = 2;
export const SYNC_DEVICE_ID_HEADER = "X-Device-ID";

export const MAX_SYNC_PUSH_CHANGES = 500;
export const DEFAULT_SYNC_PULL_LIMIT = 500;
export const MAX_SYNC_PULL_LIMIT = 500;
export const MAX_SYNC_KEY_BYTES = 1_024;
export const MAX_SYNC_VALUE_BYTES = 64 * 1_024;
export const MAX_SYNC_PUSH_BODY_BYTES = 1_024 * 1_024;
export const MAX_SYNC_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const textEncoder = new TextEncoder();
const safeNonNegativeInteger = z
  .int()
  .check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const safePositiveInteger = z
  .int()
  .check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));

export const syncDeviceIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9_-]+$/));

export const syncKeySchema = z.string().check(
  z.minLength(1),
  z.refine((key) => utf8ByteLength(key) <= MAX_SYNC_KEY_BYTES, {
    message: `key must not exceed ${MAX_SYNC_KEY_BYTES} UTF-8 bytes`,
  }),
);

export const syncValueSchema = z.string().check(
  z.refine((value) => utf8ByteLength(value) <= MAX_SYNC_VALUE_BYTES, {
    message: `value must not exceed ${MAX_SYNC_VALUE_BYTES} UTF-8 bytes`,
  }),
);

export const syncHlcSchema = z.strictObject({
  wallTimeMs: safeNonNegativeInteger,
  counter: safeNonNegativeInteger,
});

export const syncPushChangeSchema = z.strictObject({
  key: syncKeySchema,
  value: syncValueSchema,
  isDeleted: z.boolean(),
  schemaVersion: safePositiveInteger,
  hlc: syncHlcSchema,
});

export const syncPushBodySchema = z
  .strictObject({
    changes: z
      .array(syncPushChangeSchema)
      .check(z.maxLength(MAX_SYNC_PUSH_CHANGES)),
  })
  .check(
    z.superRefine((body, context) => {
      const keys = new Set<string>();

      body.changes.forEach((change, index) => {
        if (keys.has(change.key)) {
          context.addIssue({
            code: "custom",
            message: "push batch contains a duplicate key",
            path: ["changes", index, "key"],
          });
        }
        keys.add(change.key);
      });

      if (utf8ByteLength(JSON.stringify(body)) > MAX_SYNC_PUSH_BODY_BYTES) {
        context.addIssue({
          code: "custom",
          message: `push body must not exceed ${MAX_SYNC_PUSH_BODY_BYTES} encoded bytes`,
          path: ["changes"],
        });
      }
    }),
  );

export const syncRecordSchema = z.extend(syncPushChangeSchema, {
  deviceId: syncDeviceIdSchema,
  serverSeq: safePositiveInteger,
});

export const syncPushResponseSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        accepted: z.boolean(),
        winner: syncRecordSchema,
      }),
    )
    .check(z.maxLength(MAX_SYNC_PUSH_CHANGES)),
});

export const syncPullBodySchema = z
  .strictObject({
    cursor: safeNonNegativeInteger,
    head: z.optional(safeNonNegativeInteger),
    limit: z.optional(
      safePositiveInteger.check(z.maximum(MAX_SYNC_PULL_LIMIT)),
    ),
    excludeOwnDevice: z.boolean(),
  })
  .check(
    z.refine((body) => body.head === undefined || body.cursor <= body.head, {
      message: "cursor must not exceed head",
      path: ["cursor"],
    }),
  );

const syncQueryIntegerSchema = z.pipe(
  z.pipe(z.string().check(z.regex(/^(0|[1-9]\d*)$/)), z.transform(Number)),
  safeNonNegativeInteger,
);

/** Parse the read-only pull contract from HTTP query parameters. */
export const syncPullQuerySchema = z.pipe(
  z.strictObject({
    cursor: syncQueryIntegerSchema,
    head: z.optional(syncQueryIntegerSchema),
    limit: z.optional(syncQueryIntegerSchema),
    excludeOwnDevice: z.pipe(
      z.enum(["true", "false"]),
      z.transform((value) => value === "true"),
    ),
  }),
  syncPullBodySchema,
);

export const syncPullResponseSchema = z
  .strictObject({
    records: z.array(syncRecordSchema).check(z.maxLength(MAX_SYNC_PULL_LIMIT)),
    cursor: safeNonNegativeInteger,
    head: safeNonNegativeInteger,
    hasMore: z.boolean(),
  })
  .check(
    z.superRefine((response, context) => {
      if (response.cursor > response.head) {
        context.addIssue({
          code: "custom",
          message: "cursor must not exceed head",
          path: ["cursor"],
        });
      }

      for (let index = 0; index < response.records.length; index += 1) {
        const record = response.records[index];
        const previous = response.records[index - 1];

        if (record !== undefined && record.serverSeq > response.head) {
          context.addIssue({
            code: "custom",
            message: "record serverSeq must not exceed head",
            path: ["records", index, "serverSeq"],
          });
        }

        if (
          record !== undefined &&
          previous !== undefined &&
          record.serverSeq <= previous.serverSeq
        ) {
          context.addIssue({
            code: "custom",
            message: "records must have ascending unique serverSeq values",
            path: ["records", index, "serverSeq"],
          });
        }
      }

      const lastRecord = response.records.at(-1);
      if (response.hasMore) {
        if (
          lastRecord === undefined ||
          response.cursor !== lastRecord.serverSeq
        ) {
          context.addIssue({
            code: "custom",
            message: "a partial page cursor must equal its last serverSeq",
            path: ["cursor"],
          });
        }
        return;
      }

      if (response.cursor !== response.head) {
        context.addIssue({
          code: "custom",
          message: "a complete page must advance its cursor to head",
          path: ["cursor"],
        });
      }
    }),
  );

export const syncScopeSchema = z.strictObject({
  origin: z.url(),
  userId: z.string().check(z.minLength(1)),
  namespace: z.string().check(z.regex(/^[a-z][a-z0-9-]*$/)),
  epoch: z.string().check(z.minLength(1)),
});
export type SyncScope = z.infer<typeof syncScopeSchema>;

export const syncClientStateSchema = z.strictObject({
  deviceId: syncDeviceIdSchema,
  hlc: syncHlcSchema,
  pullCursor: safeNonNegativeInteger,
  bootstrapped: z.boolean(),
  scope: z.optional(syncScopeSchema),
});

export type SyncHlc = z.infer<typeof syncHlcSchema>;
export type SyncPushChange = z.infer<typeof syncPushChangeSchema>;
export type SyncPushBody = z.infer<typeof syncPushBodySchema>;
export type SyncRecord = z.infer<typeof syncRecordSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncPullBody = z.infer<typeof syncPullBodySchema>;
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
export type SyncClientState = z.infer<typeof syncClientStateSchema>;

/** The client owns this encoding. The server treats the result as opaque text. */
export function encodeSyncKey(tableName: string, recordId: string): string {
  if (tableName.length === 0 || recordId.length === 0) {
    throw new Error("sync key components must not be empty");
  }

  const key = JSON.stringify([tableName, recordId]);
  if (utf8ByteLength(key) > MAX_SYNC_KEY_BYTES) {
    throw new SyncRecordError(
      `Cannot synchronize a ${tableName} record: its ID makes a key longer than ${MAX_SYNC_KEY_BYTES} bytes`,
    );
  }
  return key;
}

export function decodeSyncKey(key: string): readonly [string, string] {
  syncKeySchema.parse(key);

  const decoded: unknown = JSON.parse(key);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== "string" ||
    decoded[0].length === 0 ||
    typeof decoded[1] !== "string" ||
    decoded[1].length === 0
  ) {
    throw new Error("sync key must encode [tableName, recordId]");
  }

  return [decoded[0], decoded[1]];
}

/** Version one uses JSON only. The server never calls this decoder. */
export function encodeSyncValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("sync value must be JSON serializable");
  }

  return checkSyncValueSize(encoded);
}

/**
 * The encoded value, if one record can hold it. Throws SyncValueTooLargeError
 * otherwise: the check `syncValueSchema` makes, as a typed failure.
 */
export function checkSyncValueSize(value: string, key?: string): string {
  const bytes = utf8ByteLength(value);
  if (bytes > MAX_SYNC_VALUE_BYTES) {
    throw new SyncValueTooLargeError(bytes, MAX_SYNC_VALUE_BYTES, key);
  }
  return value;
}

export function decodeSyncValue<Value>(value: string): Value {
  return JSON.parse(value) as Value;
}

/** LWW order is wall time, then counter, then the trusted device ID. */
export function compareSyncVersions(
  left: Pick<SyncRecord, "hlc" | "deviceId">,
  right: Pick<SyncRecord, "hlc" | "deviceId">,
): -1 | 0 | 1 {
  if (left.hlc.wallTimeMs !== right.hlc.wallTimeMs) {
    return left.hlc.wallTimeMs < right.hlc.wallTimeMs ? -1 : 1;
  }

  if (left.hlc.counter !== right.hlc.counter) {
    return left.hlc.counter < right.hlc.counter ? -1 : 1;
  }

  if (left.deviceId === right.deviceId) {
    return 0;
  }

  return left.deviceId < right.deviceId ? -1 : 1;
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}
