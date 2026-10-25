import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNotebookDeletion } from "@/features/reader/hooks/use-notebook-deletion";

const mocks = vi.hoisted(() => ({
  toast: Object.assign(
    vi.fn(() => "toast-id"),
    {
      custom: vi.fn(() => "toast-id"),
      dismiss: vi.fn(),
      error: vi.fn(),
    },
  ),
  hotkey: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@tanstack/react-hotkeys", () => ({ useHotkey: mocks.hotkey }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The toast as last rendered: its sonner id and the Toast's props. */
function shownToast() {
  const [render, options] = mocks.toast.custom.mock.lastCall as unknown as [
    () => { props: { message: string; done?: boolean } },
    { id: string },
  ];
  return { id: options.id, ...render().props };
}

function pressUndo() {
  const event = new KeyboardEvent("keydown", { key: "z", cancelable: true });
  mocks.hotkey.mock.lastCall![1](event);
  return event;
}

it("keeps failed restores available and prevents duplicate Undo during a pending restore", async () => {
  let finish!: () => void;
  const restore = vi
    .fn<(id: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const { result } = renderHook(() =>
    useNotebookDeletion({
      remove: async () => true,
      restore,
      shortcutEnabled: true,
    }),
  );
  await act(async () => {
    await result.current.deleteEntry({ kind: "note", id: "note" });
  });
  await act(async () => {
    expect(pressUndo().defaultPrevented).toBe(true);
  });
  expect(mocks.toast.error).toHaveBeenCalled();
  expect(result.current.restoredEntries.current.has("note")).toBe(false);
  await act(async () => {
    pressUndo();
    pressUndo();
  });
  expect(restore).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish();
  });
  expect(result.current.restoredEntries.current.has("note")).toBe(true);
  // The toast that offered Undo says so itself.
  expect(shownToast()).toMatchObject({ message: "Restored", done: true });
  expect(pressUndo().defaultPrevented).toBe(false);
});

it("gathers quick deletions into one toast, whose Undo restores them all in place", async () => {
  const restore = vi.fn(async () => {});
  const { result } = renderHook(() =>
    useNotebookDeletion({
      remove: async () => true,
      restore,
      shortcutEnabled: true,
    }),
  );
  for (const id of ["a", "b", "c"])
    await act(async () => {
      await result.current.deleteEntry({ kind: "highlight", id });
    });
  const first = shownToast();
  expect(first.message).toBe("3 highlights deleted");
  // Every render is the same toast.
  expect(
    new Set(mocks.toast.custom.mock.calls.map((call) => call[1]?.id)),
  ).toEqual(new Set([first.id]));
  await act(async () => {
    (shownToast() as unknown as { undo: { onUndo: () => void } }).undo.onUndo();
  });
  await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(3));
  expect(restore.mock.calls.map(([entry]) => entry.id)).toEqual([
    "c",
    "b",
    "a",
  ]);
  expect(shownToast()).toMatchObject({
    id: first.id,
    message: "Restored",
    done: true,
  });
  expect(pressUndo().defaultPrevented).toBe(false);
});

it("takes back one deletion at a time from the keyboard, and the toast counts down", async () => {
  const restore = vi.fn(async () => {});
  const { result } = renderHook(() =>
    useNotebookDeletion({
      remove: async () => true,
      restore,
      shortcutEnabled: true,
    }),
  );
  await act(async () => {
    await result.current.deleteEntry({ kind: "note", id: "a" });
  });
  await act(async () => {
    await result.current.deleteEntry({ kind: "highlight", id: "b" });
  });
  expect(shownToast().message).toBe("1 note and 1 highlight deleted");
  await act(async () => {
    pressUndo();
  });
  expect(restore).toHaveBeenLastCalledWith({ kind: "highlight", id: "b" });
  expect(shownToast()).toMatchObject({ message: "Note deleted" });
  await act(async () => {
    pressUndo();
  });
  expect(restore).toHaveBeenLastCalledWith({ kind: "note", id: "a" });
  expect(shownToast()).toMatchObject({ message: "Restored", done: true });
});

it("does not add a failed deletion to the undo history", async () => {
  const restore = vi.fn();
  const { result } = renderHook(() =>
    useNotebookDeletion({
      remove: async () => false,
      restore,
      shortcutEnabled: true,
    }),
  );
  await act(async () => {
    expect(await result.current.deleteEntry({ kind: "note", id: "note" })).toBe(
      false,
    );
  });
  expect(pressUndo().defaultPrevented).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(mocks.toast.custom).not.toHaveBeenCalled();
});
