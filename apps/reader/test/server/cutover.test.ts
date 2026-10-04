import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../../server/index";

it("freezes only Reader record and file writes before shared-service cutover", async () => {
  for (const mode of ["freeze", "retired"] as const) {
    const bindings = { ...env, SYNC_CUTOVER_MODE: mode };
    for (const [method, path] of [
      ["POST", "/api/sync/v2/push"],
      ["PUT", "/api/files/xxh64:0123456789abcdef"],
      ["DELETE", "/api/files/xxh64:0123456789abcdef"],
    ]) {
      const response = await worker.fetch(
        new Request(`http://example.com${path}`, { method }),
        bindings,
      );
      expect(response.status).toBe(mode === "freeze" ? 503 : 410);
    }
    expect(
      (
        await worker.fetch(
          new Request("http://example.com/api/hello"),
          bindings,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request("http://example.com/api/files"),
          bindings,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          new Request("http://example.com/api/arctic/sync/v2/push", {
            method: "POST",
          }),
          bindings,
        )
      ).status,
    ).not.toBe(410);
  }
});
