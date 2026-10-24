import { SyncProvider, useSync } from "@/hooks/use-sync";
import { useFileUploads } from "@/hooks/use-file-uploads";
import { files } from "@/lib/files";
import { syncService } from "@/lib/sync-service";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { db, addBook, getBook } from "@/lib/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signedIn: true,
  sessionId: undefined as string | undefined,
}));
vi.mock("@/hooks/use-auth", () => ({
  observeAuthSession: () => () => {},
  useAuth: () => ({
    isAuthenticated: auth.signedIn,
    isLoading: false,
    session: auth.sessionId ? { id: auth.sessionId } : undefined,
  }),
}));
beforeEach(async () => {
  auth.signedIn = true;
  auth.sessionId = undefined;
  await db.open();
});

/** A browser changes navigator.onLine and then fires the event. */
function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => window.dispatchEvent(new Event(online ? "online" : "offline")));
}

it("forwards confirmed session changes from auth while upload and sync transport stay offline", async () => {
  setOnline(false);
  const uploadIdentity = vi.spyOn(files, "setSessionIdentity");
  const resume = vi.spyOn(files, "resumeUploads").mockImplementation(() => {});
  vi.spyOn(files, "pauseUploads").mockImplementation(() => {});
  const manualRetry = vi
    .spyOn(files, "retryUploads")
    .mockImplementation(() => {});
  const record = mountSync();
  const upload = renderHook(useFileUploads);
  auth.sessionId = "restored-offline";
  record.rerender();
  upload.rerender();
  expect(uploadIdentity).toHaveBeenLastCalledWith("restored-offline");
  expect(resume).not.toHaveBeenCalled();
  expect(manualRetry).not.toHaveBeenCalled();
  setOnline(true);
  expect(resume).toHaveBeenCalledOnce();
});
afterEach(async () => {
  cleanup();
  syncService.stopPeriodicSync();
  window.dispatchEvent(new Event("online"));
  vi.restoreAllMocks();
  await db.delete();
});
function mountSync() {
  vi.spyOn(syncService, "startPeriodicSync").mockImplementation(() => {});
  const client = new QueryClient();
  return renderHook(useSync, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(SyncProvider, {}, children),
      ),
  });
}
it("rejects a manual offline race without changing the last completed timestamp", async () => {
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = mountSync();
  await act(() => result.current.triggerSync());
  const completedAt = syncService.getSnapshot().lastSyncedAt;
  expect(completedAt).toEqual(expect.any(Number));
  setOnline(false);
  await act(async () => {
    await expect(result.current.triggerSync()).rejects.toThrow(
      "Connect to the internet to sync.",
    );
  });
  expect(syncService.getSnapshot()).toMatchObject({
    connection: "offline",
    lastSyncedAt: completedAt,
  });
  expect(exchange).toHaveBeenCalledOnce();
});
it("deletes a signed-in book locally when exchange is skipped offline", async () => {
  const exchange = vi.spyOn(SyncV2Client.prototype, "sync");
  const { result } = mountSync();
  await addBook({
    id: "offline-book",
    sourceFileId: "xxh64:0000000000000000",
    title: "Offline",
    author: "Reader",
    fileSize: 1,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    cover: null,
  });
  setOnline(false);
  await act(async () => {
    await expect(
      result.current.deleteBook("offline-book"),
    ).resolves.toBeUndefined();
  });
  expect(await getBook("offline-book")).toBeUndefined();
  expect(await db._sync_outbox.count()).toBeGreaterThan(0);
  expect(exchange).not.toHaveBeenCalled();
});
it("does not restart exchange on reconnect after periodic sync stops", async () => {
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  syncService.startPeriodicSync();
  await Promise.resolve();
  syncService.stopPeriodicSync();
  setOnline(false);
  setOnline(true);
  expect(exchange).toHaveBeenCalledOnce();
});

it("rejects a signed-out manual sync without exchange or a completion timestamp", async () => {
  auth.signedIn = false;
  const before = syncService.getSnapshot().lastSyncedAt;
  const exchange = vi.spyOn(syncService, "syncAll");
  const { result } = mountSync();
  await expect(result.current.triggerSync()).rejects.toThrow("Sign in to sync");
  expect(exchange).not.toHaveBeenCalled();
  expect(syncService.getSnapshot().lastSyncedAt).toBe(before);
});

it("treats a 401 from Reader's transport as an ended session until an explicit exchange succeeds", async () => {
  const { SyncService } = await import("@/lib/sync-service");
  const { SyncRemoteRequestError } = await import("@/lib/sync-v2/sync");
  const service = new SyncService();
  service.controller.confirmSignedIn({ userId: "reader" }, "session");
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockRejectedValueOnce(new SyncRemoteRequestError("pull", 401))
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  try {
    service.startPeriodicSync();
    await service.drain();
    expect(service.getSnapshot().auth.status).toBe("expired");
    setOnline(false);
    setOnline(true);
    service.stopPeriodicSync();
    service.startPeriodicSync();
    await service.drain();
    expect(exchange).toHaveBeenCalledOnce();
    // Signing in on another app restores the shared cookie; a manual sync proves it.
    await service.syncAll();
    expect(service.getSnapshot()).toMatchObject({
      auth: { status: "signed-in" },
      failure: null,
    });
    expect(exchange).toHaveBeenCalledTimes(2);
  } finally {
    service.dispose();
  }
});
