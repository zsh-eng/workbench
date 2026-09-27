import type { FileChanges } from "../../shared/file-changes";

/** Paint only mounted Pierre number cells; no full-file DOM or React rows. */
export function createChangeGutter() {
  let host: HTMLElement | undefined;
  let changes: FileChanges | undefined;
  let spans: FileChanges["ranges"] = [];
  let edges = new Map<number, FileChanges["ranges"]>();
  const at = (line: number) => {
    let low = 0,
      high = spans.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (spans[middle].start <= line) low = middle + 1;
      else high = middle;
    }
    const span = spans[low - 1];
    return [...(span && span.end >= line ? [span] : []), ...(edges.get(line) ?? [])];
  };
  const paint = () => {
    for (const cell of (host?.shadowRoot ?? host)?.querySelectorAll<HTMLElement>(
      "[data-column-number]",
    ) ?? []) {
      const line = Number(cell.dataset.columnNumber);
      const ranges = at(line);
      const signature = JSON.stringify([changes?.label, ranges]);
      if (cell.dataset.medChangeSignature === signature) continue;
      cell.dataset.medChangeSignature = signature;
      cell.querySelectorAll("[data-med-change]").forEach((node) => node.remove());
      for (const range of ranges) {
        const marker = document.createElement("span");
        marker.dataset.medChange = range.kind;
        marker.dataset.changeLine = String(line);
        if (range.edge) marker.dataset.changeEdge = range.edge;
        marker.title = `${range.kind === "working" ? "Working change" : range.kind === "added" ? "Added" : "Deleted"} · ${changes!.label}`;
        marker.setAttribute("aria-label", marker.title);
        cell.append(marker);
      }
    }
  };
  return {
    set(value: FileChanges | undefined) {
      changes = value;
      spans = (value?.ranges ?? [])
        .filter((range) => !range.edge)
        .sort((a, b) => a.start - b.start);
      edges = new Map();
      for (const range of value?.ranges ?? [])
        if (range.edge) edges.set(range.start, [...(edges.get(range.start) ?? []), range]);
      paint();
    },
    update(node: HTMLElement, phase: string) {
      if (phase === "unmount") {
        if (host === node) host = undefined;
        return;
      }
      host = node;
      paint();
    },
  };
}
