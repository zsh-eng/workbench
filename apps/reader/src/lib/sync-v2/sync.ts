import { SHARED_API_ORIGIN } from "../shared-api";
/** Reader composition: shared engine plus this app's database, codecs and transport. */
import { getLabRuntime, getRuntimeStorage } from "@/features/sync-lab/runtime";
import { honoClient } from "@/lib/api";
import {
  readerSyncStateStore,
  type SyncClientStateStorage,
} from "./client-state";
import type { EPUBReaderSyncV2DB } from "./db";
import { READER_SYNC_TABLES } from "./tables";
import {
  SyncClient,
  createNamespacedHttpClient,
  SYNC_DEVICE_ID_HEADER,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncRemote,
  type SyncRunResult,
  type SyncEvent,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
} from "@zsh-eng/local-sync";
import {
  DexieSyncStorage,
  type PreparedRemoteRecord,
} from "@zsh-eng/local-sync/dexie";

export type {
  SyncRemote as SyncV2Remote,
  SyncRunResult as SyncV2RunResult,
  SyncEvent as SyncV2Event,
};
export interface SyncV2ClientOptions {
  syncDb: EPUBReaderSyncV2DB;
  remote?: SyncRemote;
  stateStorage?: SyncClientStateStorage;
  onEvent?: (event: SyncEvent) => void;
  signal?: AbortSignal;
}
export class SyncV2Client extends SyncClient<readonly PreparedRemoteRecord[]> {
  constructor(options: SyncV2ClientOptions) {
    super({
      signal: options.signal,
      storage: new DexieSyncStorage({
        db: options.syncDb,
        tables: READER_SYNC_TABLES,
        onEvent: options.onEvent,
      }),
      stateStore: readerSyncStateStore(
        options.stateStorage ?? getRuntimeStorage(),
      ),
      remote:
        options.remote ??
        getLabRuntime()?.syncRemote ??
        (SHARED_API_ORIGIN
          ? createNamespacedHttpClient({
              origin: SHARED_API_ORIGIN,
              namespace: "reader",
              signal: options.signal,
              stateStore: readerSyncStateStore(
                options.stateStorage ?? getRuntimeStorage(),
              ),
            }).remote
          : new HonoSyncV2Remote()),
    });
  }
}

export class SyncRemoteRequestError extends Error {
  readonly status: number;
  constructor(operation: string, status: number) {
    super(`Sync ${operation} failed with status ${status}`);
    this.name = "SyncRemoteRequestError";
    this.status = status;
  }
}

export class HonoSyncV2Remote implements SyncRemote {
  async pull(
    deviceId: string,
    request: SyncPullBody,
  ): Promise<SyncPullResponse> {
    const response = await honoClient.api.sync.v2.pull.$get(
      {
        query: {
          cursor: String(request.cursor),
          excludeOwnDevice: request.excludeOwnDevice ? "true" : "false",
          ...(request.head === undefined ? {} : { head: String(request.head) }),
          ...(request.limit === undefined
            ? {}
            : { limit: String(request.limit) }),
        },
      },
      { headers: { [SYNC_DEVICE_ID_HEADER]: deviceId } },
    );
    if (!response.ok) {
      throw new SyncRemoteRequestError("pull", response.status);
    }
    return syncPullResponseSchema.parse(await response.json());
  }

  async push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse> {
    const response = await honoClient.api.sync.v2.push.$post(
      { json: { changes: [...changes] } },
      { headers: { [SYNC_DEVICE_ID_HEADER]: deviceId } },
    );
    if (!response.ok) {
      throw new SyncRemoteRequestError("push", response.status);
    }
    return syncPushResponseSchema.parse(await response.json());
  }
}
