import type { BrowserContext } from "@playwright/test";
import {
  syncPushBodySchema,
  type SyncPushChange,
  type SyncRecord,
} from "@zsh-eng/local-sync";

/** A local, deterministic remote for UI tests. Protocol conflicts belong in integration tests. */
export async function mockApi(context: BrowserContext, signedIn = false) {
  const records: SyncRecord[] = [];
  const pushed: SyncPushChange[] = [];
  const unexpected: string[] = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/get-session") {
      const now = new Date().toISOString();
      await route.fulfill({
        json: signedIn
          ? {
              user: {
                id: "test-user",
                name: "Test Reader",
                email: "reader@example.test",
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              },
              session: {
                id: "test-session",
                userId: "test-user",
                token: "local-test",
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                createdAt: now,
                updatedAt: now,
              },
            }
          : null,
      });
      return;
    }
    if (path === "/api/sync/v2/pull") {
      const cursor = Number(url.searchParams.get("cursor"));
      const head = url.searchParams.has("head")
        ? Number(url.searchParams.get("head"))
        : records.length;
      await route.fulfill({
        json: {
          records: records.filter(
            (record) =>
              record.serverSeq > cursor &&
              record.serverSeq <= head &&
              (url.searchParams.get("excludeOwnDevice") !== "true" ||
                record.deviceId !== request.headers()["x-device-id"]),
          ),
          cursor: head,
          head,
          hasMore: false,
        },
      });
      return;
    }
    if (path === "/api/sync/v2/push") {
      // The server's own validation: a client must never send what it rejects.
      const body = syncPushBodySchema.safeParse(request.postDataJSON());
      if (!body.success) {
        unexpected.push(`Invalid push: ${body.error.message}`);
        await route.fulfill({ status: 400, json: { error: "Invalid push" } });
        return;
      }
      const { changes } = body.data;
      pushed.push(...changes);
      await route.fulfill({
        json: {
          results: changes.map((change) => {
            const winner = {
              ...change,
              deviceId: request.headers()["x-device-id"],
              serverSeq: records.length + 1,
            };
            records.push(winner);
            return { accepted: true, winner };
          }),
        },
      });
      return;
    }
    unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({
      status: 501,
      json: { error: "Unexpected test API request" },
    });
  });
  return {
    pushed,
    unexpected,
    enqueue(change: SyncPushChange) {
      records.push({
        ...change,
        deviceId: "remote-test-device",
        serverSeq: records.length + 1,
      });
    },
  };
}

export type MockApi = Awaited<ReturnType<typeof mockApi>>;
