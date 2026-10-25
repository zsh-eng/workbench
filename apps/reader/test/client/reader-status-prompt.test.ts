import {
  getReaderStatusPrompt,
  useReaderStatusPrompt,
} from "@/features/reader/hooks/use-reader-status-prompt";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  prompt: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  setStatusAsync: vi.fn(async () => undefined),
  useReadingStatus: vi.fn(),
}));

vi.mock("@/hooks/use-reading-status", () => ({
  useReadingStatus: mocks.useReadingStatus,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.prompt, {
    success: mocks.success,
    error: mocks.error,
  }),
}));

beforeEach(() => {
  mocks.useReadingStatus.mockReturnValue({
    status: null,
    isLoading: false,
    setStatusAsync: mocks.setStatusAsync,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("getReaderStatusPrompt", () => {
  it.each([null, "want-to-read"] as const)(
    "offers to start a book with status %s",
    (status) => {
      expect(getReaderStatusPrompt(status)).toEqual({
        previousStatus: status,
        targetStatus: "reading",
        title: "Ready to start reading?",
        actionLabel: "Start reading",
      });
    },
  );

  it("uses a return message for a did-not-finish book", () => {
    expect(getReaderStatusPrompt("dnf")).toEqual({
      previousStatus: "dnf",
      targetStatus: "reading",
      title: "Giving this book another try?",
      actionLabel: "Start again",
    });
  });

  it.each(["reading", "finished"] as const)(
    "does not prompt for status %s",
    (status) => {
      expect(getReaderStatusPrompt(status)).toBeNull();
    },
  );

  it("waits for readiness, saves, and dismisses the local prompt", async () => {
    const { result, rerender } = renderHook(
      ({ isReady }) => useReaderStatusPrompt({ bookId: "book-1", isReady }),
      { initialProps: { isReady: false } },
    );
    expect(result.current).toBeUndefined();
    rerender({ isReady: true });
    expect(result.current?.actionLabel).toBe("Start reading");
    act(() => result.current?.onConfirm());
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(mocks.setStatusAsync).toHaveBeenCalledWith("reading");
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(mocks.success.mock.calls[0][0])).toBe(
      "Changed status to <strong>Reading</strong>.",
    );
    // One toast for the book's status, which a second change updates.
    expect(mocks.success.mock.calls[0][1]).toEqual({ id: "reading-status" });
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("keeps a failed save available to retry without a global toast", async () => {
    mocks.setStatusAsync.mockRejectedValueOnce(new Error("full"));
    const { result } = renderHook(() =>
      useReaderStatusPrompt({ bookId: "book-1", isReady: true }),
    );
    act(() => result.current?.onConfirm());
    await waitFor(() =>
      expect(result.current?.error).toContain("Please try again"),
    );
    expect(result.current?.isPending).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    act(() => result.current?.onConfirm());
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("dismisses per book and does not show while status loads", () => {
    const { result, rerender } = renderHook(
      ({ bookId }) => useReaderStatusPrompt({ bookId, isReady: true }),
      { initialProps: { bookId: "a" } },
    );
    act(() => result.current?.onDismiss());
    expect(result.current).toBeUndefined();
    rerender({ bookId: "b" });
    expect(result.current?.title).toBe("Ready to start reading?");
    mocks.useReadingStatus.mockReturnValue({ status: null, isLoading: true });
    rerender({ bookId: "c" });
    expect(result.current).toBeUndefined();
  });
});

it.each([
  ["want-to-read", "Want to read"],
  ["dnf", "Did not finish"],
] as const)("confirms the saved change from %s", async (status, label) => {
  mocks.useReadingStatus.mockReturnValue({
    status,
    isLoading: false,
    setStatusAsync: mocks.setStatusAsync,
  });
  const { result } = renderHook(() =>
    useReaderStatusPrompt({ bookId: "book-1", isReady: true }),
  );
  act(() => result.current?.onConfirm());
  await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  expect(renderToStaticMarkup(mocks.success.mock.calls[0][0])).toBe(
    `Changed <strong>${label}</strong> to <strong>Reading</strong>.`,
  );
});

it.each([null, "want-to-read", "reading", "dnf"] as const)(
  "offers to finish status %s only at the last page",
  (status) => {
    expect(getReaderStatusPrompt(status, true)?.targetStatus).toBe("finished");
    expect(getReaderStatusPrompt(status, false)?.targetStatus).not.toBe(
      "finished",
    );
    expect(getReaderStatusPrompt("finished", true)).toBeNull();
  },
);

it("keeps finish dismissal separate from the start prompt and saves on confirmation", async () => {
  const { result, rerender } = renderHook(
    ({ isLastPage }) =>
      useReaderStatusPrompt({ bookId: "book-1", isReady: true, isLastPage }),
    { initialProps: { isLastPage: false } },
  );
  act(() => result.current?.onDismiss());
  rerender({ isLastPage: true });
  expect(result.current?.actionLabel).toBe("Mark as finished");
  expect(mocks.setStatusAsync).not.toHaveBeenCalled();
  rerender({ isLastPage: false });
  expect(result.current).toBeUndefined();
  rerender({ isLastPage: true });
  act(() => result.current?.onConfirm());
  await waitFor(() => expect(result.current).toBeUndefined());
  expect(mocks.setStatusAsync).toHaveBeenCalledWith("finished");
  expect(renderToStaticMarkup(mocks.success.mock.calls[0][0])).toBe(
    "Changed status to <strong>Finished</strong>.",
  );
  const options = mocks.success.mock.calls[0][1];
  expect(options.action.label).toBe("Back to library");
  expect(mocks.navigate).not.toHaveBeenCalled();
  options.action.onClick();
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/");
});

it("keeps a dismissed finish prompt hidden on return without changing status", () => {
  const { result, rerender } = renderHook(
    ({ isLastPage }) =>
      useReaderStatusPrompt({ bookId: "book-1", isReady: true, isLastPage }),
    { initialProps: { isLastPage: true } },
  );
  act(() => result.current?.onDismiss());
  rerender({ isLastPage: false });
  rerender({ isLastPage: true });
  expect(result.current).toBeUndefined();
  expect(mocks.setStatusAsync).not.toHaveBeenCalled();
});
