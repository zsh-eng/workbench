import type { BrowserContext } from "@playwright/test";
import {
  compareSyncVersions,
  syncPushBodySchema,
  type SyncPushChange,
  type SyncRecord,
} from "@zsh-eng/local-sync";

/** The other device in UI tests: an iPhone, as the server's device list names it. */
export const REMOTE_DEVICE_ID = "remote-test-device";

/**
 * A local, deterministic remote for UI tests. It keeps the server's rules,
 * one compacted row per key and last write wins, so a test can lose an
 * edit to a newer one; the protocol's edge cases belong in integration
 * tests.
 */
export async function mockApi(context: BrowserContext, signedIn = false) {
  const records: SyncRecord[] = [];
  const pushed: SyncPushChange[] = [];
  const unexpected: string[] = [];
  let seq = 0;
  /** Stores a change unless the key holds a newer version; returns the winner. */
  const store = (change: SyncPushChange, deviceId: string) => {
    const index = records.findIndex((record) => record.key === change.key);
    const current = records[index];
    const incoming = { ...change, deviceId, serverSeq: 0 };
    if (current && compareSyncVersions(current, incoming) >= 0)
      return { accepted: false, winner: current };
    if (current) records.splice(index, 1);
    const winner = { ...incoming, serverSeq: ++seq };
    records.push(winner);
    return { accepted: true, winner };
  };
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
        : seq;
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
          results: changes.map((change) =>
            store(change, request.headers()["x-device-id"]!),
          ),
        },
      });
      return;
    }
    if (path === "/api/devices") {
      const now = new Date().toISOString();
      await route.fulfill({
        json: {
          devices: [
            {
              clientId: request.headers()["x-device-id"],
              browser: "Chrome",
              os: "macOS",
              deviceType: "desktop",
              isCurrent: true,
            },
            {
              clientId: REMOTE_DEVICE_ID,
              browser: "Mobile Safari",
              os: "iOS",
              deviceType: "mobile",
              isCurrent: false,
            },
          ].map((device) => ({
            ...device,
            id: device.clientId,
            deviceName: null,
            createdAt: now,
            lastActiveAt: now,
          })),
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
    /** Another device's change, already on the server. */
    enqueue(change: SyncPushChange, deviceId = REMOTE_DEVICE_ID) {
      store(change, deviceId);
    },
  };
}

export type MockApi = Awaited<ReturnType<typeof mockApi>>;
