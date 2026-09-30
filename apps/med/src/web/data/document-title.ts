import { useEffect, useRef } from "react";

// File/vault surfaces can cover a still-mounted review. The visible surface owns
// the title, and closing it restores the review's latest title.
const titles = new Map<symbol, { title: string; priority: number }>();
function updateTitle() {
  document.title = [...titles.values()].sort((a, b) => b.priority - a.priority)[0]?.title ?? "med";
}
export function useDocumentTitle(title: string, priority = 0, visible = true) {
  const key = useRef(Symbol("title"));
  useEffect(() => {
    if (!visible) return;
    const id = key.current;
    titles.set(id, { title, priority });
    updateTitle();
    return () => {
      titles.delete(id);
      updateTitle();
    };
  }, [title, priority, visible]);
}
