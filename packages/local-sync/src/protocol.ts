import { z } from "zod/v4";

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
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const safePositiveInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const syncDeviceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const syncKeySchema = z
  .string()
  .min(1)
  .refine((key) => utf8ByteLength(key) <= MAX_SYNC_KEY_BYTES, {
    message: `key must not exceed ${MAX_SYNC_KEY_BYTES} UTF-8 bytes`,
  });

export const syncValueSchema = z
  .string()
  .refine((value) => utf8ByteLength(value) <= MAX_SYNC_VALUE_BYTES, {
    message: `value must not exceed ${MAX_SYNC_VALUE_BYTES} UTF-8 bytes`,
  });

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
    changes: z.array(syncPushChangeSchema).max(MAX_SYNC_PUSH_CHANGES),
  })
  .superRefine((body, context) => {
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
  });

export const syncRecordSchema = syncPushChangeSchema.extend({
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
    .max(MAX_SYNC_PUSH_CHANGES),
});

export const syncPullBodySchema = z
  .strictObject({
    cursor: safeNonNegativeInteger,
    head: safeNonNegativeInteger.optional(),
    limit: safePositiveInteger.max(MAX_SYNC_PULL_LIMIT).optional(),
    excludeOwnDevice: z.boolean(),
  })
  .refine((body) => body.head === undefined || body.cursor <= body.head, {
    message: "cursor must not exceed head",
    path: ["cursor"],
  });

const syncQueryIntegerSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform(Number)
  .pipe(safeNonNegativeInteger);

/** Parse the read-only pull contract from HTTP query parameters. */
export const syncPullQuerySchema = z
  .strictObject({
    cursor: syncQueryIntegerSchema,
    head: syncQueryIntegerSchema.optional(),
    limit: syncQueryIntegerSchema.optional(),
    excludeOwnDevice: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
  })
  .pipe(syncPullBodySchema);

export const syncPullResponseSchema = z
  .strictObject({
    records: z.array(syncRecordSchema).max(MAX_SYNC_PULL_LIMIT),
    cursor: safeNonNegativeInteger,
    head: safeNonNegativeInteger,
    hasMore: z.boolean(),
  })
  .superRefine((response, context) => {
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
  });

export const syncScopeSchema = z.strictObject({
  origin: z.string().url(),
  userId: z.string().min(1),
  namespace: z.string().regex(/^[a-z][a-z0-9-]*$/),
  epoch: z.string().min(1),
});
export type SyncScope = z.infer<typeof syncScopeSchema>;

export const syncClientStateSchema = z.strictObject({
  deviceId: syncDeviceIdSchema,
  hlc: syncHlcSchema,
  pullCursor: safeNonNegativeInteger,
  bootstrapped: z.boolean(),
  scope: syncScopeSchema.optional(),
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

  return syncKeySchema.parse(JSON.stringify([tableName, recordId]));
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

  return syncValueSchema.parse(encoded);
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
