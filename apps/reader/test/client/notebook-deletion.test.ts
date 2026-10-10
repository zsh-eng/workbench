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
  expect(mocks.toast.dismiss).toHaveBeenCalledWith("toast-id");
  expect(pressUndo().defaultPrevented).toBe(false);
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
