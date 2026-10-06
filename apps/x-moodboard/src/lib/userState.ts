import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserEdit, UserState } from "../../shared/schema";
import { fetchUserState, putEdit, putFavourite } from "./api";
import { showToast } from "./toasts";

const EMPTY: UserState = { revision: 0, favourites: {}, edits: {} };

type Pending =
  | { kind: "favourite"; postId: string; on: boolean; op: number }
  | { kind: "edit"; postId: string; edit: Omit<UserEdit, "editedAt"> | null; op: number };

/**
 * Favourites and tag edits live in the server's user-state.json, separate from the
 * read-only archive. Changes show at once; a failed write is undone and offered again.
 */
export function useUserState() {
  const [saved, setSaved] = useState<UserState>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const op = useRef(0);

  const load = useCallback(async () => {
    try {
      setSaved(await fetchUserState());
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = (next: UserState) => setSaved((prev) => (next.revision >= prev.revision ? next : prev));

  const setFavourite = useCallback(async (postId: string, on: boolean) => {
    const id = ++op.current;
    setPending((p) => [...p.filter((x) => !(x.kind === "favourite" && x.postId === postId)), { kind: "favourite", postId, on, op: id }]);
    try {
      accept(await putFavourite(postId, on));
    } catch (error) {
      showToast({
        tone: "error",
        message: `${on ? "Could not save the favourite" : "Could not remove the favourite"}: ${(error as Error).message}`,
        action: { label: "Try again", run: () => void setFavourite(postId, on) },
      });
    } finally {
      setPending((p) => p.filter((x) => x.op !== id));
    }
  }, []);

  const setEdit = useCallback(async (postId: string, edit: Omit<UserEdit, "editedAt"> | null) => {
    const id = ++op.current;
    setPending((p) => [...p.filter((x) => !(x.kind === "edit" && x.postId === postId)), { kind: "edit", postId, edit, op: id }]);
    try {
      accept(await putEdit(postId, edit));
    } catch (error) {
      showToast({
        tone: "error",
        message: `Could not save topic changes: ${(error as Error).message}`,
        action: { label: "Try again", run: () => void setEdit(postId, edit) },
      });
    } finally {
      setPending((p) => p.filter((x) => x.op !== id));
    }
  }, []);

  // Optimistic view: saved state plus pending changes.
  const view = useMemo(() => {
    if (!pending.length) return saved;
    const favourites = { ...saved.favourites };
    const edits = { ...saved.edits };
    for (const p of pending) {
      if (p.kind === "favourite") {
        if (p.on) favourites[p.postId] ??= new Date().toISOString();
        else delete favourites[p.postId];
      } else if (p.edit) edits[p.postId] = { ...p.edit, editedAt: new Date().toISOString() };
      else delete edits[p.postId];
    }
    return { ...saved, favourites, edits };
  }, [saved, pending]);

  // Edits change search text and topic masks; keep their identity stable otherwise.
  const editsKey = JSON.stringify(view.edits);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edits = useMemo(() => view.edits, [editsKey]);

  return { favourites: view.favourites, edits, loadError, reload: load, setFavourite, setEdit };
}
