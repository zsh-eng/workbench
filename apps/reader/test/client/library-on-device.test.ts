import type { Book } from "@/lib/db";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const world = vi.hoisted(() => {
  const here = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot = { jobs: [] as { kind: string; state: string; id: string }[] };
  return {
    here,
    activity: {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
    },
    /** A download finishes: its file is here, and the queue says done. */
    finish(fileId: string, jobId: string) {
      here.add(fileId);
      snapshot = {
        jobs: [
          ...snapshot.jobs,
          { kind: "book-download", state: "done", id: jobId },
        ],
      };
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("@/lib/background-activity", () => ({
  activity: world.activity,
  downloadBooks: vi.fn(),
}));
vi.mock("@/lib/files", () => ({
  files: { hasLocal: async (id: string) => world.here.has(id) },
}));
vi.mock("@/lib/debug-switch", () => ({
  offlineDownloads: {},
  useDebugSwitch: () => true,
}));
vi.mock("@/lib/app-update", () => ({
  appUpdateStore: { subscribe: () => () => {}, getSnapshot: () => null },
  getAppUpdate: () => null,
}));
vi.mock("@/features/background-activity/JobLook", () => ({
  JobCover: () => null,
  JobTitle: () => null,
  JobLine: () => null,
}));
vi.mock("@/lib/book-arrivals", () => ({
  appArrivals: {
    subscribe: () => () => {},
    getSnapshot: () => [],
    dismiss: () => {},
  },
  BOOK_IMPORT_KIND: "book-import",
}));

const { useOnDeviceFilter } =
  await import("@/features/background-activity/LibraryActivity");

const books = ["emma", "persuasion"].map(
  (id) => ({ id, sourceFileId: `file-${id}` }) as unknown as Book,
);

afterEach(cleanup);

it("keeps the books it showed while on screen, and takes in a finished download when chosen again", async () => {
  world.here.add("file-emma");
  const view = renderHook(({ active }) => useOnDeviceFilter(books, active), {
    initialProps: { active: true },
  });
  await waitFor(() =>
    expect(view.result.current.ids).toEqual(new Set(["emma"])),
  );

  // Persuasion finishes downloading while you look: the grid holds.
  act(() => world.finish("file-persuasion", "book:persuasion"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(view.result.current.ids).toEqual(new Set(["emma"]));

  // All, then On this device again: now it is there.
  view.rerender({ active: false });
  expect(view.result.current.ids).toBeNull();
  view.rerender({ active: true });
  expect(view.result.current.ids).toEqual(new Set(["emma", "persuasion"]));
});
