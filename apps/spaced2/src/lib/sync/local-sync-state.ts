import { bindSyncScope, type SyncClientStateStore } from "@zsh-eng/local-sync";

// Sync has its own cursor snapshot. Publish it only under the local-write lock,
// merging clocks so a review made during a network wait cannot be overwritten.
export function createLocalSyncState(persisted: SyncClientStateStore) {
  let state = persisted.read();
  if (!state) throw new Error("Missing sync state");
  const deviceId = state.deviceId;
  const store: SyncClientStateStore = {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
  function checkpoint() {
    const latest = persisted.read();
    if (!latest || latest.deviceId !== deviceId)
      throw new Error("Sync account/device changed");
    if (latest.scope) bindSyncScope(store, latest.scope);
    const a = latest.hlc,
      b = state!.hlc;
    const hlc =
      a.wallTimeMs > b.wallTimeMs ||
      (a.wallTimeMs === b.wallTimeMs && a.counter > b.counter)
        ? a
        : b;
    state = { ...state!, hlc };
    persisted.write(state);
  }
  return { store, checkpoint };
}
