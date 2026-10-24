import type { EditorState } from "@codemirror/state";
import type { FileRead as BrowseRead } from "../../shared/local-file";

export interface EditorDraft {
  file: BrowseRead;
  state?: EditorState;
  /** The draft's text while it has no editor state, as after a reload. */
  text?: string;
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
const draftText = (draft: EditorDraft) => draft.state?.sliceDoc() ?? draft.text ?? draft.savedText;

/** Each workspace keeps at most this many drafts. */
export const MAX_DRAFTS = 24;

/** An unsaved draft in the browser's storage, so it outlasts a reload. */
interface StoredDraft {
  /** The file as the draft started from it. */
  file: BrowseRead;
  text: string;
  at: number;
}
const PREFIX = "med:draft:";
/** By workspace, then by the draft's key: the file's source, which names its
 * repository, and its path. */
const storageKey = (owner: string, key: string) => `${PREFIX}${JSON.stringify([owner, key])}`;

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The drafts that the last page left in storage, newest first. */
function storedDrafts(storage: Storage | null) {
  const found: { owner: string; key: string; stored: StoredDraft }[] = [];
  try {
    for (let index = 0; storage && index < storage.length; index++) {
      const name = storage.key(index);
      if (!name?.startsWith(PREFIX)) continue;
      try {
        const [owner, key] = JSON.parse(name.slice(PREFIX.length)) as unknown[];
        const stored = JSON.parse(storage.getItem(name) ?? "") as StoredDraft;
        if (
          typeof owner === "string" &&
          typeof key === "string" &&
          typeof stored.text === "string" &&
          typeof stored.file?.identity === "string"
        )
          found.push({ owner, key, stored });
      } catch {
        // A record that does not parse stays as it is.
      }
    }
  } catch {
    // Without storage, drafts live as long as the page.
  }
  return found.sort((a, b) => b.stored.at - a.stored.at);
}

/** One workspace's draft store, as the window sees it. */
interface Registered {
  /** The paths of the files with unsaved drafts. */
  unsaved(): string[];
  /** Writes the drafts that wait for storage now. */
  flush(): void;
  /** An unsaved draft is not in storage. */
  unstored(): boolean;
}

/**
 * The window's drafts. An unsaved draft whose workspace closed or left memory
 * waits here, with its undo history, until an editor opens its file again.
 * Unsaved drafts are also in the browser's storage, by workspace and file, so
 * they outlast a reload: the next page parks them here, and each workspace
 * takes its own back when it opens.
 */
export function createWindowDrafts(storage: Storage | null = browserStorage()) {
  const parked: { owner: string; key: string; draft: EditorDraft; stored: boolean }[] = [];
  const counts = new Map<string, number>();
  for (const { owner, key, stored } of storedDrafts(storage)) {
    const count = counts.get(owner) ?? 0;
    if (count >= MAX_DRAFTS) continue;
    counts.set(owner, count + 1);
    const savedText = stored.file.text ?? "";
    parked.push({
      owner,
      key,
      stored: true,
      draft: {
        file: stored.file,
        text: stored.text,
        savedText,
        dirty: stored.text !== savedText,
        editing: false,
        saving: false,
        error: null,
        scrollTop: 0,
      },
    });
  }
  const live = new Map<string, Registered>();
  return {
    park(owner: string, key: string, draft: EditorDraft, stored: boolean) {
      parked.push({ owner, key, draft, stored });
    },
    /** The parked draft of this file: this workspace's, or else the oldest. */
    take(key: string, owner: string) {
      let index = parked.findIndex((entry) => entry.key === key && entry.owner === owner);
      if (index < 0) index = parked.findIndex((entry) => entry.key === key);
      return index < 0 ? undefined : parked.splice(index, 1)[0]!;
    },
    /** This workspace's parked drafts, which it takes back as it opens. */
    adopt(owner: string, limit: number) {
      const mine = parked.filter((entry) => entry.owner === owner).slice(0, limit);
      for (const entry of mine) parked.splice(parked.indexOf(entry), 1);
      return mine;
    },
    /** Puts a draft in storage; false when the browser refuses, as when full. */
    store(owner: string, key: string, draft: EditorDraft) {
      if (!storage) return false;
      const record: StoredDraft = { file: draft.file, text: draftText(draft), at: Date.now() };
      try {
        storage.setItem(storageKey(owner, key), JSON.stringify(record));
        return true;
      } catch {
        return false;
      }
    },
    forget(owner: string, key: string) {
      try {
        storage?.removeItem(storageKey(owner, key));
      } catch {
        // Storage is a convenience; the draft is gone from memory.
      }
    },
    register(owner: string, drafts: Registered) {
      live.set(owner, drafts);
      return () => {
        if (live.get(owner) === drafts) live.delete(owner);
      };
    },
    /** The files with unsaved drafts of this workspace: in its open store,
     * or waiting here since it left memory or the page loaded. */
    unsavedFiles: (owner: string) => [
      ...new Set([
        ...(live.get(owner)?.unsaved() ?? []),
        ...parked
          .filter((entry) => entry.owner === owner && unsaved(entry.draft))
          .map((entry) => entry.draft.file.path),
      ]),
    ],
    /** Leaving the page would lose a draft: one that storage did not take. */
    loses() {
      for (const drafts of live.values()) drafts.flush();
      return (
        [...live.values()].some((drafts) => drafts.unstored()) ||
        parked.some((entry) => unsaved(entry.draft) && !entry.stored)
      );
    },
  };
}
export type WindowDrafts = ReturnType<typeof createWindowDrafts>;

/**
 * One workspace's drafts. In a window, an unsaved draft is kept in the
 * browser's storage under its workspace (`owner`), and waits in the window
 * when the workspace closes.
 */
export function createEditorDrafts(window?: WindowDrafts, owner = "") {
  const drafts = new Map<string, EditorDraft>();
  const listeners = new Set<() => void>();
  let revision = 0;
  // Each draft's key; the keys whose latest text storage has, and the keys
  // that wait for it.
  const keys = new WeakMap<EditorDraft, string>();
  const stored = new Set<string>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!window) return;
    for (const key of pending) {
      const draft = drafts.get(key);
      if (draft && unsaved(draft)) {
        if (window.store(owner, key, draft)) stored.add(key);
      } else window.forget(owner, key);
    }
    pending.clear();
  };
  /** Storage takes the draft's text when typing pauses. */
  const changed = (key: string) => {
    if (!window) return;
    pending.add(key);
    stored.delete(key);
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  };
  const place = (key: string, draft: EditorDraft) => {
    drafts.set(key, draft);
    keys.set(draft, key);
  };
  /** Room for one more draft: a saved one leaves, or the open fails. */
  const makeRoom = () => {
    if (drafts.size < MAX_DRAFTS) return;
    for (const [oldKey, old] of drafts)
      if (!unsaved(old)) {
        drafts.delete(oldKey);
        break;
      }
    if (drafts.size >= MAX_DRAFTS)
      throw new Error(
        `Save or discard an open draft before editing another file (${MAX_DRAFTS}-draft limit).`,
      );
  };
  // This workspace's drafts from before it closed, or from the last page.
  for (const entry of window?.adopt(owner, MAX_DRAFTS) ?? []) {
    place(entry.key, entry.draft);
    if (entry.stored) stored.add(entry.key);
    else changed(entry.key);
  }
  const unregister = window?.register(owner, {
    unsaved: () => [...drafts.values()].filter(unsaved).map((draft) => draft.file.path),
    flush,
    unstored: () => [...drafts].some(([key, draft]) => unsaved(draft) && !stored.has(key)),
  });
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
      // A draft that waits in the window comes back first. Room comes first,
      // so a full store leaves the draft where it waits.
      if (!draft || !unsaved(draft)) {
        if (!draft) makeRoom();
        const kept = window?.take(key, owner);
        if (kept) {
          draft = kept.draft;
          place(key, draft);
          // Storage keeps it under this workspace now.
          if (kept.owner !== owner) window!.forget(kept.owner, key);
          if (kept.stored && kept.owner === owner) stored.add(key);
          else changed(key);
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
        place(key, draft);
        changed(key);
      }
      draft.editing = true;
      notify();
      return draft;
    },
    update(draft: EditorDraft, changes: Partial<EditorDraft>) {
      const doc = draft.state?.doc;
      Object.assign(draft, changes);
      const key = keys.get(draft);
      if (
        key !== undefined &&
        drafts.get(key) === draft &&
        ((changes.state && changes.state.doc !== doc) ||
          "dirty" in changes ||
          "file" in changes ||
          "saving" in changes)
      )
        changed(key);
    },
    /** Gives the unsaved drafts to the window, as this store's workspace
     * closes or leaves memory. Without a window, they stay here. */
    park() {
      if (!window) return;
      flush();
      unregister?.();
      for (const [key, draft] of drafts)
        if (unsaved(draft)) window.park(owner, key, draft, stored.has(key));
      drafts.clear();
    },
    notify,
  };
}
export type EditorDrafts = ReturnType<typeof createEditorDrafts>;
