import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
} from "@/lib/sync-v2/db";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import { resetIndexedDB } from "../setup/indexeddb";
import { encodeSyncKey, SyncValueTooLargeError } from "@zsh-eng/local-sync";
import type { NoteAnchor } from "@/types/note";

let db: EPUBReaderSyncV2DB;
vi.mock("@/data/database", () => ({
  get db() {
    return db;
  },
  isNotDeleted: (row: { isDeleted: boolean }) => !row.isDeleted,
}));
import {
  createNote,
  createBookmark,
  deleteNote,
  restoreNote,
  getBookNotes,
  getNotesByHighlight,
  updateNote,
} from "@/data/notes";
import {
  beginNoteDraft,
  beginNoteEdit,
  saveNoteDraft,
  submitNoteDraft,
  getNoteDraft,
  discardNoteDraft,
} from "@/data/note-drafts";
import { deleteHighlight } from "@/data/highlights";

const anchor: NoteAnchor = {
  spineItemId: "chapter",
  startOffset: 10,
  endOffset: 15,
  textBefore: "before",
  textAfter: "after",
};
const target = { kind: "page" as const, anchor };

describe("durable notes and local drafts", () => {
  beforeEach(async () => {
    resetIndexedDB();
    localStorage.clear();
    getOrCreateSyncClientState("device-a");
    db = createSyncV2ApplicationDb("note-storage-test");
    await db.open();
  });
  afterEach(async () => {
    await db.delete();
  });

  it("keeps compose and edit drafts separate across reopen and removes only the submitted draft", async () => {
    const id = await createNote("book", "Original", target);
    const compose = await beginNoteDraft("book", target);
    await saveNoteDraft(compose.id, "Unsent thought");
    const edit = await beginNoteEdit(id);
    await saveNoteDraft(edit.id, "Revised");
    db.close();
    await db.open();
    expect((await getNoteDraft(compose.id))?.content).toBe("Unsent thought");
    expect((await beginNoteEdit(id)).content).toBe("Revised");
    expect(await submitNoteDraft(edit.id)).toEqual({
      status: "saved",
      noteId: id,
    });
    expect(await getNoteDraft(edit.id)).toBeUndefined();
    expect((await getNoteDraft(compose.id))?.content).toBe("Unsent thought");
    expect(await submitNoteDraft(compose.id)).toMatchObject({
      status: "saved",
    });
    expect(await submitNoteDraft(compose.id)).toEqual({
      status: "missing-draft",
    });
    expect(await getBookNotes("book")).toHaveLength(2);
  });

  it("draft writes produce no outbox records and keep the original capture location", async () => {
    const draft = await beginNoteDraft("book", target);
    await saveNoteDraft(draft.id, "  ");
    const resumed = await beginNoteDraft("book", {
      kind: "page",
      anchor: { ...anchor, startOffset: 2 },
    });
    expect(resumed).toMatchObject({ content: "  ", target });
    expect(await db._sync_outbox.count()).toBe(0);
    await expect(submitNoteDraft(draft.id)).rejects.toThrow(
      "must contain text",
    );
    expect(await getNoteDraft(draft.id)).toBeDefined();
    expect(await db.notes.count()).toBe(0);
  });

  it("creates a selected range and note atomically and keeps each after deleting the other", async () => {
    const draft = await beginNoteDraft("book", {
      kind: "selection",
      anchor,
      text: "quote",
    });
    await saveNoteDraft(draft.id, "Thought");
    expect(await db.highlights.count()).toBe(0);
    const result = await submitNoteDraft(draft.id);
    expect(result.status).toBe("saved");
    const [note] = await getBookNotes("book");
    if (note.kind !== "note") throw new Error("Expected note");
    expect(note.quote).toEqual({ text: "quote", color: "invisible" });
    expect(await getNotesByHighlight(note.highlightId!)).toHaveLength(1);
    expect(await db._sync_outbox.count()).toBe(2);
    await deleteHighlight(note.highlightId!);
    expect(await getBookNotes("book")).toHaveLength(1);
    const secondId = await createNote("book", "Second", {
      kind: "selection",
      anchor,
      text: "other",
    });
    const second = await db.notes.get(secondId);
    if (second?.kind !== "note") throw new Error("Expected note");
    await beginNoteEdit(secondId);
    await deleteNote(secondId);
    expect((await db.highlights.get(second.highlightId!))?.isDeleted).toBe(
      false,
    );
    expect(await getNoteDraft(`edit:${secondId}`)).toBeUndefined();
  });

  it("rolls back a selection highlight if the note cannot fit in a synced record", async () => {
    const draft = await beginNoteDraft("book", {
      kind: "selection",
      anchor,
      text: "quote",
    });
    await saveNoteDraft(draft.id, "x".repeat(65536));
    await expect(submitNoteDraft(draft.id)).rejects.toThrow(
      SyncValueTooLargeError,
    );
    expect(await db.highlights.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
    expect(await db._sync_outbox.count()).toBe(0);
    expect(await getNoteDraft(draft.id)).toBeDefined();
  });

  it("retains conflicting or remotely deleted edit drafts without overwriting received changes", async () => {
    const id = await createNote("book", "Original", target);
    const edit = await beginNoteEdit(id);
    await saveNoteDraft(edit.id, "My edit");
    await updateNote(id, "Other edit");
    expect(await submitNoteDraft(edit.id)).toEqual({
      status: "conflict",
      currentContent: "Other edit",
    });
    await db.notes.delete(id); // Simulate a received tombstone without local draft cleanup.
    expect(await submitNoteDraft(edit.id)).toEqual({ status: "deleted-note" });
    expect((await getNoteDraft(edit.id))?.content).toBe("My edit");
    await discardNoteDraft(edit.id);
    expect(await getNoteDraft(edit.id)).toBeUndefined();
  });

  it("replaces and removes a reply target without losing draft text", async () => {
    const draft = await beginNoteDraft("book", target);
    const quoteTarget = {
      kind: "selection" as const,
      anchor: { ...anchor, startOffset: 12 },
      text: "quote",
    };
    await saveNoteDraft(draft.id, "My thought", quoteTarget);
    expect(await getNoteDraft(draft.id)).toMatchObject({
      content: "My thought",
      target: quoteTarget,
    });
    await saveNoteDraft(draft.id, "My thought", {
      kind: "page",
      anchor: quoteTarget.anchor,
    });
    expect(await submitNoteDraft(draft.id)).toMatchObject({ status: "saved" });
    expect((await getBookNotes("book"))[0]).toMatchObject({
      content: "My thought",
      anchor: quoteTarget.anchor,
    });
    expect(await db.highlights.count()).toBe(0);
  });

  it("syncs deletion and undo without losing the quote or restoring an old edit draft", async () => {
    const id = await createNote("book", "Keep this", {
      kind: "selection",
      anchor,
      text: "Quoted text",
    });
    const before = await db.notes.get(id);
    await beginNoteEdit(id);
    const compose = await beginNoteDraft("book", target);
    await saveNoteDraft(compose.id, "Unsent thought");
    await deleteNote(id);
    expect(await getBookNotes("book")).toEqual([]);
    expect(await getNoteDraft(`edit:${id}`)).toBeUndefined();
    expect(await db.highlights.count()).toBe(1);
    expect(await db._sync_outbox.get(encodeSyncKey("notes", id))).toMatchObject(
      { isDeleted: true },
    );
    await restoreNote(id);
    expect(await db._sync_outbox.get(encodeSyncKey("notes", id))).toMatchObject(
      { isDeleted: false },
    );
    expect(await db.notes.get(id)).toMatchObject({
      ...before,
      isDeleted: false,
      updatedAt: expect.any(Number),
    });
    expect((await getNoteDraft(compose.id))?.content).toBe("Unsent thought");
    await updateNote(id, "Changed after undo");
    await restoreNote(id);
    expect((await getBookNotes("book"))[0].content).toBe("Changed after undo");
  });

  it("creates bookmarks without text and rejects empty edits without changing anchors", async () => {
    const bookmark = await createBookmark("book", anchor);
    expect(await db.notes.get(bookmark)).toMatchObject({
      kind: "bookmark",
      anchor,
    });
    await expect(updateNote(bookmark, "text")).rejects.toThrow("Bookmarks");
    const id = await createNote("book", "Original", target);
    await expect(updateNote(id, " \n ")).rejects.toThrow("must contain text");
    await updateNote(id, " Revised ");
    expect(await db.notes.get(id)).toMatchObject({
      content: "Revised",
      anchor,
    });
  });
});
