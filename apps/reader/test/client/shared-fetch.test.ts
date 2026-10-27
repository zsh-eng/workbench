import { afterEach, expect, it, vi } from "vitest";

const origin = "https://api.test";
vi.mock("@/lib/shared-api", () => ({
  SHARED_API_ORIGIN: "https://api.test",
  SHARED_STORAGE_SUFFIX: ":test",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("sends the bound sync scope with file requests instead of asking before each", async () => {
  const scope = { origin, userId: "user", namespace: "reader", epoch: "one" };
  const requests: { path: string; scope: string | null }[] = [];
  let signedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace("/api/apps/reader", "");
      requests.push({
        path,
        scope: new Headers(init.headers).get("X-Sync-Scope"),
      });
      if (!signedIn) return new Response("{}", { status: 401 });
      if (path === "/sync/v3/state") return Response.json(scope);
      return new Response("cover", {
        headers: { "X-Sync-Scope": JSON.stringify(scope) },
      });
    }),
  );
  const files = ["1", "2", "3"].map(
    (n) => `/api/files/xxh64:000000000000000${n}`,
  );

  // Signed out: the refusal is the caller's answer, and is not remembered.
  const first = await import("@/lib/shared-fetch");
  expect((await first.readerApiFetch(files[0]!)).status).toBe(401);
  // Before sync has bound a scope, concurrent requests share one question.
  signedIn = true;
  await Promise.all(files.map((file) => first.readerApiFetch(file)));
  // A new page asks nothing: the scope is bound on this device.
  vi.resetModules();
  const next = await import("@/lib/shared-fetch");
  await Promise.all(files.map((file) => next.readerApiFetch(file)));

  expect(requests.map((request) => request.path)).toEqual(
    ["/sync/v3/state", "/sync/v3/state", ...files, ...files].map((path) =>
      path.replace("/api", ""),
    ),
  );
  for (const request of requests.slice(2))
    expect(request.scope).toBe(JSON.stringify(scope));
});
