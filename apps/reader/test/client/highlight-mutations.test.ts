import {
  highlightKeys,
  useAddHighlightMutation,
  useUpdateHighlightMutation,
  useDeleteHighlightMutation,
} from "@/hooks/use-highlights-query";
import * as database from "@/lib/db";
import { syncV2Db } from "@/lib/sync-v2/db";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let client: QueryClient;
const highlight = {
  id: "offline-highlight",
  bookId: "book",
  spineItemId: "chapter",
  startOffset: 0,
  endOffset: 7,
  selectedText: "Passage",
  textBefore: "",
  textAfter: "",
  color: "yellow" as const,
  createdAt: 1,
};
const bookKey = highlightKeys.book("book");
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}
function useMutations() {
  return {
    add: useAddHighlightMutation("book"),
    update: useUpdateHighlightMutation("book"),
    remove: useDeleteHighlightMutation("book"),
  };
}
beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await syncV2Db.open();
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await client.resumePausedMutations();
  cleanup();
  await waitFor(() => expect(client.isMutating()).toBe(0));
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await syncV2Db.delete();
});
it("persists offline create, recolor, and delete with durable outbox changes", async () => {
  onlineManager.setOnline(false);
  const { result } = renderHook(useMutations, { wrapper });
  act(() => result.current.add.mutate(highlight));
  await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
  syncV2Db.close();
  await syncV2Db.open();
  expect(await database.getBookHighlights("book")).toMatchObject([
    { id: highlight.id, color: "yellow" },
  ]);
  expect(await syncV2Db._sync_outbox.count()).toBe(1);
  act(() =>
    result.current.update.mutate({
      id: highlight.id,
      changes: { color: "green" },
    }),
  );
  await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
  syncV2Db.close();
  await syncV2Db.open();
  expect(await database.getBookHighlights("book")).toMatchObject([
    { color: "green" },
  ]);
  expect(await syncV2Db._sync_outbox.count()).toBe(1);
  act(() => result.current.remove.mutate(highlight.id));
  await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
  syncV2Db.close();
  await syncV2Db.open();
  expect(await database.getBookHighlights("book")).toEqual([]);
  expect(await syncV2Db._sync_outbox.count()).toBe(1);
});
it.each(["add", "update", "remove"] as const)(
  "reports a failed %s and restores the saved data",
  async (operation) => {
    await database.addHighlight(highlight);
    client.setQueryData(bookKey, [highlight]);
    const method = {
      add: "addHighlight",
      update: "updateHighlight",
      remove: "deleteHighlight",
    } as const;
    vi.spyOn(database, method[operation]).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(useMutations, { wrapper });
    act(() => {
      if (operation === "add")
        result.current.add.mutate({ ...highlight, id: "new" });
      if (operation === "update")
        result.current.update.mutate({
          id: highlight.id,
          changes: { color: "green" },
        });
      if (operation === "remove") result.current.remove.mutate(highlight.id);
    });
    await waitFor(() => expect(result.current[operation].isError).toBe(true));
    expect(toast.error).toHaveBeenCalledOnce();
    expect(client.getQueryData(bookKey)).toEqual([highlight]);
    expect(await database.getBookHighlights("book")).toMatchObject([highlight]);
  },
);
