import {
  EpubImportProvider,
  useEpubImport,
} from "@/features/library/use-epub-import";
import { BookImportError } from "@/lib/book-import-errors";
import { DuplicateBookError } from "@/lib/book-service";
import type { Book } from "@/lib/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  present: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-epub-processor", () => ({
  markEpubPreparationReady: vi.fn(),
}));
vi.mock("@/lib/book-service", () => ({
  DuplicateBookError: class extends Error {
    constructor(
      message: string,
      public existingBook: Book,
    ) {
      super(message);
    }
  },
}));
// Each file is an arrival; its outcome is what `add` answers for it.
vi.mock("@/lib/background-activity", () => ({
  importBooks: (chosen: readonly File[]) => {
    const outcomes = chosen.map((file) => {
      const outcome = Promise.resolve().then(() => mocks.add(file));
      outcome.catch(() => {});
      return outcome;
    });
    return {
      keys: chosen.map((file) => `arrival:${file.name}`),
      outcomes,
      rested: async () => {},
      end: () => {},
    };
  },
}));
vi.mock("@/lib/book-arrivals", () => ({
  appArrivals: {
    subscribe: () => () => {},
    getSnapshot: () => [],
    present: mocks.present,
  },
}));
vi.mock("@/features/arrivals/LazyArrivingCover", () => ({
  preloadArrivals: () => {},
  LazyArrivalSheet: ({ arrivalKey }: { arrivalKey: string }) =>
    createElement("div", { role: "dialog" }, arrivalKey),
}));
vi.mock("@/features/library/ImportOutcomes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/library/ImportOutcomes")
  >()),
  ImportProblemsSheet: ({
    isOpen,
    outcomes,
  }: {
    isOpen: boolean;
    outcomes: { fileName: string; status: string }[];
  }) =>
    isOpen
      ? createElement(
          "ul",
          { "aria-label": "Not added" },
          outcomes.map((outcome) =>
            createElement(
              "li",
              { key: outcome.fileName },
              `${outcome.fileName}: ${outcome.status}`,
            ),
          ),
        )
      : null,
}));

function setup() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient();
  return renderHook(useEpubImport, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(EpubImportProvider, null, children),
      ),
  });
}
const files = [new File(["epub"], "one.epub"), new File(["epub"], "two.epub")];
const duplicate = () =>
  new DuplicateBookError("Duplicate", { id: "existing" } as Book);
const lastToast = () => mocks.toast.mock.lastCall![0];
const click = (action: { onClick: (event: Event) => void }) => {
  const event = new MouseEvent("click", { cancelable: true });
  act(() => action.onClick(event));
  return event;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("reports duplicate-only batches without an import error", async () => {
  mocks.add.mockRejectedValue(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  expect(mocks.toast).toHaveBeenCalledWith({
    id: "book-import",
    message: "These 2 books are already in your library.",
    variant: "default",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(result.current.isProcessing).toBe(false);
});
it("one file arrives in the sheet, which says how it went: no toast", async () => {
  mocks.add.mockRejectedValue(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(screen.getByRole("dialog").textContent).toBe("arrival:one.epub");
  // Its place in the grid waits for the sheet from the first frame.
  expect(mocks.present).toHaveBeenCalledExactlyOnceWith(
    "arrival:one.epub",
    true,
  );
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(result.current.isProcessing).toBe(false);
});

it("a file that is not an EPUB, chosen with one that is, is part of a batch", async () => {
  mocks.add.mockResolvedValueOnce({ id: "new-book" } as Book);
  const { result } = setup();
  await act(() =>
    result.current.importFiles([files[0]!, new File(["x"], "notes.txt")]),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(lastToast()).toMatchObject({
    message: "1 added, 1 couldn’t be added.",
    action: { label: "See why" },
  });
});

it("sums up a mixed batch and shows why each file was not added", async () => {
  mocks.add
    .mockResolvedValueOnce({ id: "new-book" } as Book)
    .mockRejectedValueOnce(duplicate())
    .mockRejectedValueOnce(new BookImportError({ kind: "drm" }));
  const { result } = setup();
  await act(() =>
    result.current.importFiles([
      ...files,
      new File(["bad"], "bought.epub"),
      new File(["ignored"], "notes.txt"),
    ]),
  );
  const notification = lastToast();
  expect(notification).toMatchObject({
    id: "book-import",
    message: "1 added, 1 already in your library, 2 couldn’t be added.",
    variant: "default",
    action: { label: "See why" },
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/");

  click(notification.action);
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    "two.epub: duplicate",
    "bought.epub: failed",
    "notes.txt: failed",
  ]);
});

it("offers the one newly imported book when nothing failed", async () => {
  mocks.add
    .mockResolvedValueOnce({ id: "new-book" } as Book)
    .mockRejectedValueOnce(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  const notification = lastToast();
  expect(notification.message).toBe("1 added, 1 already in your library.");
  expect(notification.action.label).toBe("Open book");
  notification.action.onClick();
  expect(mocks.navigate).toHaveBeenLastCalledWith("/reader/new-book");
});

it("keeps multiple successful imports in the Library without selecting a book", async () => {
  mocks.add
    .mockResolvedValueOnce({ id: "one" } as Book)
    .mockResolvedValueOnce({ id: "two" } as Book);
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  expect(mocks.toast).toHaveBeenCalledWith({
    id: "book-import",
    message: "Added 2 books.",
    variant: "default",
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/");
});
