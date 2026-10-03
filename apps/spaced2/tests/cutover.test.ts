import { test, expect } from "bun:test";
import worker from "../server/index";

test("Spaced cutover gates record and file writes before touching auth or storage", async () => {
  for (const mode of ["freeze", "retired"] as const) {
    for (const [method, path] of [
      ["POST", "/api/sync/v2/push"],
      ["PUT", "/api/files/xxh64:0123456789abcdef"],
      ["DELETE", "/api/files/xxh64:0123456789abcdef"],
    ]) {
      const response = await worker.fetch(
        new Request(`http://localhost${path}`, { method }),
        { SYNC_CUTOVER_MODE: mode } as Env,
      );
      expect(response.status).toBe(mode === "freeze" ? 503 : 410);
      expect(await response.json()).toHaveProperty(
        "error",
        mode === "freeze" ? "SYNC_MAINTENANCE" : "SYNC_UPGRADE_REQUIRED",
      );
    }
  }
});
