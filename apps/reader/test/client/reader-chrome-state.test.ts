import { useReaderChromeState } from "@/features/reader/hooks/use-reader-chrome-state";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("epub-reader-sidebar-tab");
});

it("restores the desktop tab across mounts and honors explicit destinations", () => {
  const first = renderHook(() => useReaderChromeState(false));
  act(() => first.result.current.actions.openReaderSheet("notes"));
  first.unmount();
  const next = renderHook(() => useReaderChromeState(false));
  act(() => next.result.current.actions.openReaderSheet("tools"));
  expect(next.result.current.state.activeReaderSheet).toBe("notes");
  act(() => next.result.current.actions.openReaderSheet("contents"));
  expect(next.result.current.state.activeReaderSheet).toBe("contents");
});

it("keeps the mobile launcher independent of the desktop preference", () => {
  window.localStorage.setItem("epub-reader-sidebar-tab", "notes");
  const { result } = renderHook(() => useReaderChromeState(true));
  act(() => result.current.actions.openReaderSheet("tools"));
  expect(result.current.state.activeReaderSheet).toBe("tools");
  act(() => result.current.actions.openReaderSheet("settings"));
  expect(window.localStorage.getItem("epub-reader-sidebar-tab")).toBe("notes");
});

it("uses Contents when the stored tab is invalid", () => {
  window.localStorage.setItem("epub-reader-sidebar-tab", "missing");
  const { result } = renderHook(() => useReaderChromeState(false));
  act(() => result.current.actions.openReaderSheet("tools"));
  expect(result.current.state.activeReaderSheet).toBe("contents");
});

it("opens the Notebook for a stored Highlights tab, which the notebook replaced", () => {
  window.localStorage.setItem("epub-reader-sidebar-tab", "highlights");
  const { result } = renderHook(() => useReaderChromeState(false));
  act(() => result.current.actions.openReaderSheet("tools"));
  expect(result.current.state.activeReaderSheet).toBe("notes");
});
