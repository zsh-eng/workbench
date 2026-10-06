import Dexie from "dexie";
import type { SyncPushChange } from "@zsh-eng/local-sync";

/** Benchmark-only interceptor; the library still owns its apply transaction. */
export function instrumentOutbox(
  db: {
    _sync_outbox: {
      count(): Promise<number>;
      bulkGet(keys: string[]): Promise<(SyncPushChange | undefined)[]>;
    };
  },
  fast: boolean,
  metrics: { outboxChecks: number; outboxGets: number },
) {
  const bulkGet = db._sync_outbox.bulkGet.bind(db._sync_outbox);
  db._sync_outbox.bulkGet = async (keys: string[]) => {
    if (fast) {
      if (
        !Dexie.currentTransaction ||
        Dexie.currentTransaction.mode !== "readwrite"
      )
        throw Error("Outbox check must share the apply transaction");
      metrics.outboxChecks++;
      if ((await db._sync_outbox.count()) === 0)
        return keys.map(() => undefined);
    }
    metrics.outboxGets += keys.length;
    return bulkGet(keys);
  };
}
