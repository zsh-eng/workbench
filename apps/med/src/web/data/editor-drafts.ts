import type { EditorState } from "@codemirror/state";
import type { FileRead as BrowseRead } from "../../shared/local-file";

export interface EditorDraft {
  file: BrowseRead;
  state?: EditorState;
  savedText: string;
  dirty: boolean;
  editing: boolean;
  saving: boolean;
  error: string | null;
  scrollTop: number;
  line?: number;
  column?: number;
  insertOnOpen?: boolean;
  /** The last open at a line that the editor went to (OpenFileTab.revealed). */
  revealed?: number;
}

/** A draft whose text is not on disk yet, or is on its way there. */
const unsaved = (draft: EditorDraft) => draft.dirty || draft.saving;

/**
 * The window's unsaved drafts whose workspace closed or left memory. Each
 * waits, with its undo history, until an editor opens its file again, and
 * leaving the page warns about it. A save on its way still finishes it.
 */
export function createParkedDrafts() {
  const parked: { key: string; draft: EditorDraft }[] = [];
  return {
    park(key: string, draft: EditorDraft) {
      parked.push({ key, draft });
    },
    /** The oldest parked draft of this file, which leaves the window. */
    take(key: string) {
      const index = parked.findIndex((entry) => entry.key === key);
      return index < 0 ? undefined : parked.splice(index, 1)[0]!.draft;
    },
    hasUnsaved: () => parked.some((entry) => unsaved(entry.draft)),
  };
}
export type ParkedDrafts = ReturnType<typeof createParkedDrafts>;

export function createEditorDrafts(parked?: ParkedDrafts) {
  const drafts = new Map<string, EditorDraft>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  /** Room for one more draft: a saved one leaves, or the open fails. */
  const makeRoom = () => {
    if (drafts.size < 24) return;
    for (const [oldKey, old] of drafts)
      if (!unsaved(old)) {
        drafts.delete(oldKey);
        break;
      }
    if (drafts.size >= 24)
      throw new Error(
        "Save or discard an open draft before editing another file (24-draft limit).",
      );
  };
  return {
    getSnapshot: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (key: string) => drafts.get(key),
    hasDirty: () => [...drafts.values()].some(unsaved),
    open(key: string, file: BrowseRead, line?: number) {
      let draft = drafts.get(key);
      // A draft that a closed workspace left in the window comes back first.
      if (!draft || !unsaved(draft)) {
        const kept = parked?.take(key);
        if (kept) {
          if (!draft) makeRoom();
          draft = kept;
          drafts.set(key, kept);
        }
      }
      if (!draft || (!unsaved(draft) && draft.file.identity !== file.identity)) {
        if (!draft) makeRoom();
        draft = {
          file,
          savedText: file.text ?? "",
          dirty: false,
          editing: true,
          saving: false,
          error: null,
          scrollTop: 0,
          line,
        };
        drafts.set(key, draft);
      }
      draft.editing = true;
      notify();
      return draft;
    },
    update(draft: EditorDraft, changes: Partial<EditorDraft>) {
      Object.assign(draft, changes);
    },
    /** Gives the unsaved drafts to the window, as this store's workspace
     * closes or leaves memory. Without a window, they stay here. */
    park() {
      if (!parked) return;
      for (const [key, draft] of drafts) if (unsaved(draft)) parked.park(key, draft);
      drafts.clear();
    },
    notify,
  };
}
export type EditorDrafts = ReturnType<typeof createEditorDrafts>;
