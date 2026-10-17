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
export function createEditorDrafts() {
  const drafts = new Map<string, EditorDraft>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
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
    hasDirty: () => [...drafts.values()].some((draft) => draft.dirty || draft.saving),
    open(key: string, file: BrowseRead, line?: number) {
      let draft = drafts.get(key);
      if (!draft || (!draft.dirty && !draft.saving && draft.file.identity !== file.identity)) {
        if (!draft && drafts.size >= 24) {
          for (const [oldKey, old] of drafts)
            if (!old.dirty && !old.saving) {
              drafts.delete(oldKey);
              break;
            }
          if (drafts.size >= 24)
            throw new Error(
              "Save or discard an open draft before editing another file (24-draft limit).",
            );
        }
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
    notify,
  };
}
export type EditorDrafts = ReturnType<typeof createEditorDrafts>;
