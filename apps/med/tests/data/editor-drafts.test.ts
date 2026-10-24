import { EditorState } from "@codemirror/state";
import { afterEach, expect, test, vi } from "vitest";
import {
  createEditorDrafts,
  createWindowDrafts,
  MAX_DRAFTS,
} from "../../src/web/data/editor-drafts";
import type { FileRead } from "../../src/shared/local-file";

/** The browser's storage, in memory. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}
const source = { kind: "worktree", repo: "/test/repo" } as const;
const read = (path: string, text: string): FileRead => ({
  source,
  path,
  kind: "text",
  text,
  size: text.length,
  identity: `${path}:${text}`,
});
const key = (path: string) => JSON.stringify([source, path]);
/** Types in a draft, as the editor does. */
function type(drafts: ReturnType<typeof createEditorDrafts>, path: string, text: string) {
  const draft = drafts.open(key(path), read(path, "on disk\n"));
  drafts.update(draft, { state: EditorState.create({ doc: text }), dirty: true });
  return draft;
}

afterEach(() => {
  vi.useRealTimers();
});

test("an unsaved draft outlasts a reload, under its workspace, until it is saved", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  const drafts = createEditorDrafts(createWindowDrafts(storage), "review-a");
  type(drafts, "a.ts", "my draft\n");
  // Storage takes the text when typing pauses.
  vi.advanceTimersByTime(500);

  // The page loads again: the workspace gets its draft back, as it was.
  const window = createWindowDrafts(storage);
  const again = createEditorDrafts(window, "review-a");
  const draft = again.open(key("a.ts"), read("a.ts", "on disk\n"));
  expect(draft).toMatchObject({ text: "my draft\n", savedText: "on disk\n", dirty: true });
  expect(window.unsavedFiles("review-a")).toEqual(["a.ts"]);
  expect(window.loses()).toBe(false);
  // A save leaves nothing in storage.
  again.update(draft, { dirty: false, savedText: "my draft\n" });
  vi.advanceTimersByTime(500);
  expect(createWindowDrafts(storage).unsavedFiles("review-a")).toEqual([]);
  expect(storage.length).toBe(0);
});

test("a workspace gets back at most 24 drafts after a reload", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  // Two pages of one workspace, such as two browser tabs, each leave 24.
  const pages = [createWindowDrafts(storage), createWindowDrafts(storage)];
  pages.forEach((page, number) => {
    const writer = createEditorDrafts(page, "review-a");
    for (let index = 0; index < MAX_DRAFTS; index++)
      type(writer, `${number}-${index}.ts`, "draft\n");
  });
  vi.advanceTimersByTime(500);
  expect(storage.length).toBe(2 * MAX_DRAFTS);
  const window = createWindowDrafts(storage);
  createEditorDrafts(window, "review-a");
  expect(window.unsavedFiles("review-a")).toHaveLength(MAX_DRAFTS);
});

test("a full workspace leaves a draft that waits in the window where it is", () => {
  const window = createWindowDrafts(memoryStorage());
  // A closed workspace left a draft of shared.ts in the window.
  const closed = createEditorDrafts(window, "review-closed");
  type(closed, "shared.ts", "kept draft\n");
  closed.park();
  // A workspace with 24 unsaved drafts cannot take it.
  const full = createEditorDrafts(window, "review-full");
  for (let index = 0; index < MAX_DRAFTS; index++) type(full, `${index}.ts`, "draft\n");
  expect(() => full.open(key("shared.ts"), read("shared.ts", "on disk\n"))).toThrow(
    "24-draft limit",
  );
  // The draft still waits, and the next workspace with room takes it.
  const next = createEditorDrafts(window, "review-next");
  const draft = next.open(key("shared.ts"), read("shared.ts", "on disk\n"));
  expect(draft.state?.sliceDoc()).toBe("kept draft\n");
  expect(draft.dirty).toBe(true);
});

test("a workspace's drafts that wait in the window still count as its unsaved files", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  const window = createWindowDrafts(storage);
  // The workspace leaves memory with an unsaved draft.
  const drafts = createEditorDrafts(window, "review-a");
  type(drafts, "a.ts", "my draft\n");
  drafts.park();
  expect(window.unsavedFiles("review-a")).toEqual(["a.ts"]);
  expect(window.unsavedFiles("review-b")).toEqual([]);
  // After a reload, before the workspace opens again.
  vi.advanceTimersByTime(500);
  expect(createWindowDrafts(storage).unsavedFiles("review-a")).toEqual(["a.ts"]);
});
