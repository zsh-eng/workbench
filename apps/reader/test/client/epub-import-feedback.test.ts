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
  dismiss: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: mocks.dismiss }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-epub-processor", () => ({
  markEpubPreparationReady: vi.fn(),
}));
vi.mock("@/lib/book-service", () => ({
  addBookFromFile: mocks.add,
  DuplicateBookError: class extends Error {
    constructor(
      message: string,
      public existingBook: Book,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/features/library/DuplicateBookDialog", () => ({
  DuplicateBookDialog: ({ open }: { open: boolean }) =>
    open ? createElement("div", { role: "dialog" }, "Already imported") : null,
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
it("keeps the single-duplicate dialog", async () => {
  mocks.add.mockRejectedValue(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("says why one file couldn't be added, and what to do", async () => {
  mocks.add.mockRejectedValue(
    new BookImportError({ kind: "not-epub", format: "pdf" }),
  );
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
    id: "book-import",
    message: "Not an EPUB",
    description:
      "It’s a PDF renamed to .epub. Reader opens EPUB books only. Add an EPUB copy instead.",
    variant: "destructive",
    duration: 10000,
    action: undefined,
  });
});

it("tries a file again in the same toast after storage ran out", async () => {
  mocks.add
    .mockRejectedValueOnce(new BookImportError({ kind: "storage" }))
    .mockResolvedValueOnce({ id: "new-book" } as Book);
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(lastToast()).toMatchObject({
    id: "book-import",
    message: "Not enough storage",
    description:
      "This device ran out of space while saving the book. Free up some space, then try again.",
    action: { label: "Try again" },
  });

  // The toast stays and changes: it is trying, then the book is added.
  const event = click(lastToast().action);
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() =>
    expect(lastToast()).toMatchObject({ message: "Added 1 book." }),
  );
  expect(mocks.toast.mock.calls.map(([toast]) => toast.message)).toEqual([
    "Not enough storage",
    "Adding the book…",
    "Added 1 book.",
  ]);
  expect(
    mocks.toast.mock.calls.every(([toast]) => toast.id === "book-import"),
  ).toBe(true);
  expect(mocks.add).toHaveBeenCalledTimes(2);
});

it("offers the details of an unexpected error to copy", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  mocks.add.mockRejectedValue(new TypeError("reading 'spine' of undefined"));
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(lastToast()).toMatchObject({
    message: "Couldn’t add this book",
    action: { label: "Copy details" },
  });

  click(lastToast().action);
  await vi.waitFor(() =>
    expect(lastToast().action.label).toBe("Details copied"),
  );
  expect(writeText.mock.calls[0]![0]).toMatch(
    /^File: one\.epub\nProblem: unexpected: reading 'spine' of undefined\n/,
  );
  vi.unstubAllGlobals();
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
