// Run in each existing Reader/Spaced browser profile before the write freeze.
// Read-only: prints counts and readiness, never record contents or account IDs.
(async () => {
  const stores = await indexedDB.databases();
  const results = [];
  for (const name of ["epub-reader-db-v2", "SpacedRecordsV3"]) {
    if (!stores.some((entry) => entry.name === name)) continue;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.transaction.abort();
        reject(
          new Error("Database changed during preflight; reload and retry"),
        );
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const pending = {};
      for (const table of [
        "_sync_outbox",
        "fileUploadOperations",
        "noteDrafts",
      ]) {
        if (!db.objectStoreNames.contains(table)) continue;
        pending[table] = await new Promise((resolve, reject) => {
          const request = db
            .transaction(table, "readonly")
            .objectStore(table)
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      results.push({
        database: name,
        pending,
        ready: Object.values(pending).every((count) => count === 0),
      });
    } finally {
      db.close();
    }
  }
  const response = await fetch("/api/me", {
    credentials: "include",
    signal: AbortSignal.timeout(15000),
  });
  const report = {
    checkedAt: new Date().toISOString(),
    origin: location.origin,
    authenticated: response.ok,
    stores: results,
    ready: response.ok && results.every((row) => row.ready),
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
