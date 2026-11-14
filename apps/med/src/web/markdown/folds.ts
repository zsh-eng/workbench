import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Opens the folds (details.ts) that hold a node, so that it shows. */
export function unfold(node: Element) {
  for (let fold = node.parentElement?.closest("details"); fold;) {
    fold.open = true;
    fold = fold.parentElement?.closest("details");
  }
}

/** Whether a node is in a closed fold, where it has no place on the page. */
export const folded = (node: Element) => !!node.closest("details:not([open])");

/**
 * A fold that the reader opened or closed stays so when its block renders
 * again, as while its text is edited or its reply streams. Folds are known by
 * their first source line.
 */
export function useKeptFolds(host: RefObject<HTMLElement | null>) {
  const opened = useRef(new Map<string, boolean>());
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    // A toggle does not bubble; the host hears it as it goes down.
    const keep = (event: Event) => {
      const fold = event.target;
      const line = fold instanceof HTMLDetailsElement ? fold.dataset.sourceLine : undefined;
      if (line) opened.current.set(line, fold instanceof HTMLDetailsElement && fold.open);
    };
    node.addEventListener("toggle", keep, true);
    return () => node.removeEventListener("toggle", keep, true);
  }, [host]);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || !opened.current.size) return;
    for (const fold of node.querySelectorAll<HTMLDetailsElement>("details[data-source-line]")) {
      const open = opened.current.get(fold.dataset.sourceLine!);
      if (open !== undefined && fold.open !== open) fold.open = open;
    }
  });
}
