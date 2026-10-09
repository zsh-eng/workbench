import { searchRanges } from "./search-highlights";

export interface DiffFindTarget {
  path: string;
  side: "additions" | "deletions";
  line: number;
}

/**
 * Find-in-diffs matches across every mounted file of the Changes view. All
 * matches share one highlight; the matches on the current hit's line take a
 * second one that paints above it.
 */
export function createDiffFindHighlights(matchName: string, currentName: string) {
  const hosts = new Map<HTMLElement, string>();
  let query = "";
  let target: DiffFindTarget | null = null;
  const clear = () => {
    CSS.highlights?.delete(matchName);
    CSS.highlights?.delete(currentName);
  };
  // The hit's row on its side. Split view keeps old lines in [data-deletions].
  const row = (root: ParentNode, { side, line }: DiffFindTarget): Element | null => {
    if (side === "deletions")
      return root.querySelector(`[data-line="${line}"][data-line-type="change-deletion"]`);
    for (const candidate of root.querySelectorAll<HTMLElement>(`[data-line="${line}"]`))
      if (
        candidate.dataset.lineType !== "change-deletion" &&
        !candidate.closest("[data-deletions]")
      )
        return candidate;
    return null;
  };
  const refresh = () => {
    clear();
    if (!query.trim() || typeof Highlight === "undefined" || !CSS.highlights) return;
    const all: Range[] = [];
    let current: Range[] = [];
    for (const [host, path] of hosts) {
      const root = host.shadowRoot;
      if (!root) continue;
      all.push(...searchRanges(root.querySelectorAll("[data-line]"), query, {}, 1000 - all.length));
      const hit = target?.path === path ? row(root, target) : null;
      if (hit) current = searchRanges([hit], query);
      if (all.length >= 1000) break;
    }
    if (all.length) CSS.highlights.set(matchName, new Highlight(...all));
    if (current.length) {
      const highlight = new Highlight(...current);
      highlight.priority = 1;
      CSS.highlights.set(currentName, highlight);
    }
  };
  let frame = 0;
  // Pierre renders files one by one; one refresh per frame covers a batch.
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  };
  return {
    /** Track a rendered file; call with no path when it unmounts. */
    rendered(host: HTMLElement, path?: string) {
      if (path) hosts.set(host, path);
      else hosts.delete(host);
      if (query) schedule();
    },
    set(nextQuery: string, nextTarget: DiffFindTarget | null) {
      query = nextQuery;
      target = nextTarget;
      schedule();
    },
    dispose() {
      cancelAnimationFrame(frame);
      hosts.clear();
      clear();
    },
  };
}
