import { textRangesIn } from "../../data/dom-find";
import { splitChips } from "./prompt-chips";
import type { Unit } from "./thread-model";

const MAX_MATCHES = 1000;

export interface ThreadMatch {
  unitKey: string;
  /** Enclosing folded WorkUnit key when this unit is currently folded inside it. */
  workKey?: string;
  /** 0-based match index within the unit. */
  occurrence: number;
}

/** Rough visible-text projection of a Markdown string for unmounted virtualized units. */
function plainMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function visiblePromptText(text: string): string {
  return splitChips(text)
    .map((part) => (part.kind === "text" ? plainMarkdown(part.text) : part.chip.label))
    .join("");
}

/** Searchable text for an unmounted leaf unit. */
export function unitSearchText(unit: Unit): string {
  if ("work" in unit) return "";
  if ("explore" in unit) {
    return unit.explore
      .map((item) => {
        const parts = [item.call.title];
        const raw = item.call.rawInput as { path?: unknown; pattern?: unknown } | undefined;
        if (typeof raw?.path === "string") parts.push(raw.path);
        if (typeof raw?.pattern === "string") parts.push(raw.pattern);
        return parts.join(" ");
      })
      .join("\n");
  }
  const { item } = unit;
  switch (item.kind) {
    case "user":
      return item.content
        .flatMap((block) => (block.type === "text" ? [visiblePromptText(block.text)] : []))
        .join("\n");
    case "agent":
      return plainMarkdown(item.text);
    case "thought":
      return plainMarkdown(item.text);
    case "notice":
      return [item.title, item.description ?? ""].filter(Boolean).join("\n");
    case "compaction":
      return item.summary ?? "Compacted earlier conversation";
    case "tool": {
      const pieces = [item.call.title];
      const raw = item.call.rawInput as
        | { command?: unknown; path?: unknown; pattern?: unknown; description?: unknown }
        | undefined;
      if (typeof raw?.description === "string") pieces.push(raw.description);
      if (typeof raw?.command === "string") pieces.push(raw.command);
      if (typeof raw?.path === "string") pieces.push(raw.path);
      if (typeof raw?.pattern === "string") pieces.push(raw.pattern);
      for (const block of item.call.content ?? []) {
        if (block.type === "content" && block.content.type === "text" && block.content.text) {
          pieces.push(block.content.text);
        } else if (block.type === "diff" && block.path) {
          pieces.push(block.path);
        }
      }
      return pieces.join("\n");
    }
  }
}

function countInText(text: string, pattern: RegExp, limit: number): number {
  if (!text || limit <= 0) return 0;
  const re = new RegExp(pattern.source, pattern.flags);
  let count = 0;
  for (const match of text.matchAll(re)) {
    if (match[0].length === 0) continue;
    count++;
    if (count >= limit) break;
  }
  return count;
}

/** Finds all matches across the loaded transcript `all` (including folded `WorkUnit` children
 * and virtualized off-screen units). Uses live DOM ranges for mounted units so counts match
 * visible highlights exactly. */
export function findThreadMatches(
  all: readonly Unit[],
  pattern: RegExp,
  mountedRoot: HTMLElement | null,
  limit = MAX_MATCHES,
): { matches: ThreadMatch[]; mountedRanges: Map<string, Range[]> } {
  const mountedByUnit = new Map<string, Element>();
  if (mountedRoot) {
    for (const el of mountedRoot.querySelectorAll<HTMLElement>("[data-unit]")) {
      const key = el.dataset.unit;
      if (key) mountedByUnit.set(key, el);
    }
  }

  const mountedRanges = new Map<string, Range[]>();
  const matches: ThreadMatch[] = [];

  const scanLeaf = (unit: Unit, workKey?: string) => {
    if (matches.length >= limit) return;
    const remaining = limit - matches.length;
    const el = mountedByUnit.get(unit.key);
    if (el) {
      const ranges = textRangesIn([el], pattern, { limit: remaining });
      if (ranges.length) mountedRanges.set(unit.key, ranges);
      for (let occurrence = 0; occurrence < ranges.length; occurrence++) {
        matches.push({ unitKey: unit.key, workKey, occurrence });
      }
      return;
    }
    const count = countInText(unitSearchText(unit), pattern, remaining);
    for (let occurrence = 0; occurrence < count; occurrence++) {
      matches.push({ unitKey: unit.key, workKey, occurrence });
    }
  };

  for (const unit of all) {
    if (matches.length >= limit) break;
    if ("work" in unit) {
      // Open work units already expand their children directly into `all`.
      if (!unit.open) {
        for (const inner of unit.work) {
          scanLeaf(inner, unit.key);
          if (matches.length >= limit) break;
        }
      }
      continue;
    }
    scanLeaf(unit);
  }

  return { matches, mountedRanges };
}
