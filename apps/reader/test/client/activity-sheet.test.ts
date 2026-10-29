import type { ActivityEnvironment } from "@/features/background-activity/ActivityContext";
import type { Job, JobState } from "@workbench/background-activity";
import { act, cleanup, render } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sheet reads the app's queue and update only through its environment.
vi.mock("@/lib/background-activity", () => ({
  activity: { subscribe: () => () => {}, getSnapshot: () => ({ jobs: [] }) },
}));
vi.mock("@/lib/app-update", () => ({
  appUpdateStore: {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: "idle" }),
  },
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

const { ActivityEnvironmentProvider } =
  await import("@/features/background-activity/ActivityContext");
const { ActivitySheetBody } =
  await import("@/features/background-activity/ActivitySheet");
const { ActivityGlyph } =
  await import("@/features/background-activity/ActivityGlyph");
const { arrangeOnOpen, arrangeWhileOpen } =
  await import("@/features/background-activity/sheet-rows");

const IDLE = { status: "idle" } as never;
let clock = 0;
function job(id: string, state: JobState, patch: Partial<Job> = {}): Job {
  return {
    id: `book:${id}`,
    kind: "book-download",
    input: { bookId: id, title: id },
    origin: "user",
    title: id,
    state,
    waitingFor: state === "waiting" ? "network" : null,
    progress: {
      done: 0,
      total: null,
      bytes: 0,
      totalBytes: null,
      phase: null,
    },
    failure:
      state === "failed"
        ? { reason: "server", message: "503", retryable: true }
        : null,
    attempts: 0,
    retryAt: null,
    tracked: false,
    detail: null,
    attention: false,
    createdAt: ++clock,
    changedAt: clock,
    finishedAt: null,
    ...patch,
  };
}

/** A queue whose jobs the test sets, as the manager would publish them. */
function queue(initial: Job[]) {
  let snapshot = { jobs: initial as readonly Job[], online: true };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    cancel: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
    publish(jobs: Job[]) {
      snapshot = { jobs, online: true };
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

function openSheet(source: ReturnType<typeof queue>) {
  return renderWith(source, ActivitySheetBody);
}

function renderWith(
  source: ReturnType<typeof queue>,
  component: ComponentType,
) {
  const environment: ActivityEnvironment = {
    source,
    update: {
      subscribe: () => () => {},
      getSnapshot: () => IDLE,
      startedAt: 0,
    },
    restart: () => {},
  };
  return render(
    createElement(
      ActivityEnvironmentProvider,
      { value: environment },
      createElement(component),
    ),
  );
}

/** What the sheet shows, top to bottom: headings and rows with their state. */
function lines(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>("h3, [data-sheet-row]"),
  ].map((element) =>
    element.tagName === "H3"
      ? `# ${element.textContent}`
      : `${element.dataset.sheetRow!.replace(/^book:/, "")} ${element.dataset.sheetRowState}`,
  );
}

afterEach(cleanup);

describe("the activity sheet", () => {
  it("lets a row finish where it is while the sheet is open, and regroups on the next opening", () => {
    const emma = job("emma", "running");
    const persuasion = job("persuasion", "running");
    const walden = job("walden", "queued");
    const source = queue([emma, persuasion, walden]);
    const sheet = openSheet(source);
    expect(lines(sheet.container)).toEqual([
      "# Now",
      "emma running",
      "persuasion running",
      "walden queued",
    ]);

    // Persuasion finishes and Walden starts, then Emma fails: no row moves.
    const persuasionDone = { ...persuasion, state: "done" as const };
    const waldenRunning = { ...walden, state: "running" as const };
    source.publish([emma, persuasionDone, waldenRunning]);
    const emmaFailed = job("emma", "failed", { createdAt: emma.createdAt });
    source.publish([emmaFailed, persuasionDone, waldenRunning]);
    expect(lines(sheet.container)).toEqual([
      "# Now",
      "emma failed",
      "persuasion done",
      "walden running",
    ]);

    // Ten seconds on, the queue forgets the finished download; its row
    // stays as it ended.
    source.publish([emmaFailed, waldenRunning]);
    expect(lines(sheet.container)).toEqual([
      "# Now",
      "emma failed",
      "persuasion gone",
      "walden running",
    ]);
    expect(sheet.getByText("On this device")).toBeTruthy();

    // Closed and opened again: the rows sit in their sections.
    sheet.unmount();
    const again = openSheet(source);
    expect(lines(again.container)).toEqual([
      "# Now",
      "walden running",
      "# Couldn't finish",
      "emma failed",
    ]);
  });

  it("adds new work at the end of its section and leaves the rest in place", () => {
    const emma = job("emma", "running");
    const walden = job("walden", "done");
    const source = queue([walden, emma]);
    const sheet = openSheet(source);
    expect(lines(sheet.container)).toEqual([
      "# Now",
      "emma running",
      "# Done",
      "walden done",
    ]);
    const dracula = job("dracula", "queued");
    const emmaDone = { ...emma, state: "done" as const };
    source.publish([walden, emmaDone, dracula]);
    expect(lines(sheet.container)).toEqual([
      "# Now",
      "emma done",
      "dracula queued",
      "# Done",
      "walden done",
    ]);
  });

  it("keeps a routine sync pass out, and shows a restore", () => {
    const sync = job("sync", "running", {
      id: "sync",
      kind: "sync",
      input: undefined,
      origin: "app",
      tracked: true,
      title: "Sync",
    });
    const source = queue([sync]);
    const sheet = openSheet(source);
    expect(lines(sheet.container)).toEqual([]);
    expect(sheet.getByText(/Nothing in the background/)).toBeTruthy();
    sheet.unmount();
    source.publish([
      { ...sync, origin: "user", title: "Restoring your library" },
    ]);
    const again = openSheet(source);
    expect(lines(again.container)).toEqual(["# This app", "sync running"]);
  });
});

it("shows an import's step without a Cancel, and lets it finish in place", () => {
  const importing = job("alice", "running", {
    id: "import:1:0",
    kind: "book-import",
    input: { key: "import:1:0" },
    title: "alice",
    progress: {
      done: 0,
      total: null,
      bytes: 0,
      totalBytes: null,
      phase: "reading",
    },
  });
  const emma = job("emma", "running");
  const source = queue([importing, emma]);
  const sheet = openSheet(source);
  expect(lines(sheet.container)).toEqual([
    "# Now",
    "import:1:0 running",
    "emma running",
  ]);
  expect(sheet.queryByRole("button", { name: "Cancel alice" })).toBeNull();
  expect(sheet.getByRole("button", { name: "Cancel emma" })).toBeTruthy();
  source.publish([{ ...importing, state: "done" }, emma]);
  expect(lines(sheet.container)).toEqual([
    "# Now",
    "import:1:0 done",
    "emma running",
  ]);
});

it("offers Retry for a failed import only where the same file can work", () => {
  const failedImport = (name: string, reason: "rejected" | "storage") =>
    job(name, "failed", {
      id: `import:1:${name}`,
      kind: "book-import",
      input: { key: `import:1:${name}` },
      title: name,
      failure: { reason, message: "", retryable: false },
    });
  const sheet = openSheet(
    queue([failedImport("paper", "rejected"), failedImport("full", "storage")]),
  );
  expect(sheet.queryByRole("button", { name: "Retry paper" })).toBeNull();
  expect(sheet.getByRole("button", { name: "Dismiss paper" })).toBeTruthy();
  expect(sheet.getByRole("button", { name: "Retry full" })).toBeTruthy();
});

describe("arrangeWhileOpen", () => {
  it("returns the same rows when nothing changed, so nothing renders again", () => {
    const jobs = [job("emma", "running")];
    const rows = arrangeOnOpen(jobs);
    expect(arrangeWhileOpen(rows, jobs, new Set())).toBe(rows);
  });

  it("drops a row you cancelled here and keeps the others in order", () => {
    const jobs = [
      job("emma", "running"),
      job("persuasion", "queued"),
      job("walden", "queued"),
    ];
    const rows = arrangeOnOpen(jobs);
    const next = arrangeWhileOpen(rows, jobs, new Set(["book:persuasion"]));
    expect(next.map((row) => row.job.id)).toEqual(["book:emma", "book:walden"]);
  });
});

describe("the activity glyph", () => {
  afterEach(() => vi.unstubAllGlobals());

  const sync = (state: JobState, patch: Partial<Job> = {}) =>
    job("sync", state, {
      id: "sync",
      kind: "sync",
      input: undefined,
      tracked: true,
      title: "Sync",
      ...patch,
    });

  /** The glyph's mark for these jobs, or null when it has nothing to say. */
  function glyphFor(jobs: Job[]): string | null {
    const view = renderWith(queue(jobs), ActivityGlyph);
    const glyph = view.container.querySelector("[data-activity-glyph]");
    view.unmount();
    return glyph?.getAttribute("data-activity-glyph") ?? null;
  }

  it("leaves a restore to the island, and what sync needs from you to the account menu", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    // A restore has the island that grows out of the glyph
    // (LibraryRestoreIsland). A sign-in and two failures in a row have the
    // account menu; a routine pass is silent.
    const quiet = [
      sync("running", { title: "Restoring your library" }),
      sync("waiting", {
        origin: "app",
        waitingFor: "sign-in",
        attention: true,
      }),
      sync("retrying", { origin: "app", attention: true }),
      sync("running", { origin: "app" }),
    ];
    for (const job of quiet) expect(glyphFor([job])).toBeNull();
  });
});
