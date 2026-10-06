import type Dexie from "dexie";
import type { Table, TransactionMode, PromiseExtended } from "dexie";

/** Elapsed intervals, not CPU samples. Nested/overlapping spans are intentional. */
export function createTrace(enabled: boolean, nativeTiming = false) {
  const origin = performance.now();
  const native = { putCalls: 0, putMs: 0 };
  let restoreNative = () => {};
  const spans: { name: string; start: number; end: number }[] = [];
  function begin(name: string) {
    const start = performance.now() - origin;
    return () => {
      if (enabled) spans.push({ name, start, end: performance.now() - origin });
    };
  }
  function instrument(db: Dexie) {
    if (!enabled) return;
    if (nativeTiming) {
      const originalPut = window.IDBObjectStore.prototype.put;
      window.IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const start = performance.now();
        try {
          return originalPut.apply(this, args);
        } finally {
          native.putCalls++;
          native.putMs += performance.now() - start;
        }
      };
      restoreNative = () => {
        window.IDBObjectStore.prototype.put = originalPut;
      };
    }
    // Dexie table instances can be recreated inside transactions. Wrap the prototype.
    // Both methods forward their original arguments and preserve their receiver.
    const proto = db.Table.prototype as unknown as Record<
      "bulkPut" | "count",
      (this: unknown, ...args: unknown[]) => PromiseExtended<unknown>
    >;
    for (const method of ["bulkPut", "count"] as const) {
      const original = proto[method];
      proto[method] = function (...args: unknown[]) {
        const end = begin(method === "count" ? "outbox-count" : "bulk-put");
        try {
          return original.apply(this, args).finally(end);
        } catch (error) {
          end();
          throw error;
        }
      };
    }
    // All Dexie transaction overloads end with the scope callback. Keep their
    // argument list intact while timing entry and completion of that scope.
    type Scope = (this: unknown, ...args: unknown[]) => unknown;
    type Transaction = (
      ...args: [
        TransactionMode,
        ...tables: (string | Table | readonly (string | Table)[])[],
        scope: Scope,
      ]
    ) => PromiseExtended<unknown>;
    const transaction = db.transaction as Transaction;
    db.transaction = function (this: Dexie, ...args: Parameters<Transaction>) {
      const endStart = begin("transaction-start");
      const callback = args.pop() as Scope;
      let endCommit: (() => void) | undefined;
      args.push(function (this: unknown, ...inner: unknown[]) {
        endStart();
        return Promise.resolve(callback.apply(this, inner)).then((value) => {
          endCommit = begin("transaction-commit");
          return value;
        });
      });
      return transaction.apply(this, args).finally(() => endCommit?.());
    } as Dexie["transaction"];
  }
  return { begin, instrument, spans, native, dispose: () => restoreNative() };
}
