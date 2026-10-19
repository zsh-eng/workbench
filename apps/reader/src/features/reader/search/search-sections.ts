import type { TOCItem } from "@/lib/db";
import { splitHrefFragment } from "@/lib/epub-resource-utils";
import type { Block, ChapterCanonicalText } from "@/lib/pagination-v2";
import type { ChapterEntry } from "../types";

/** Where a table of contents entry starts, in canonical text coordinates. */
export interface SearchSection {
  title: string;
  chapterIndex: number;
  offset: number;
  /** Position in the table of contents, so a child wins a shared start. */
  order: number;
}

function normalizePath(href: string): string {
  return splitHrefFragment(href).path.replace(/^\/+/, "");
}

function findChapter(path: string, chapters: ChapterEntry[]): number | null {
  let suffixMatch: number | null = null;
  for (const chapter of chapters) {
    const chapterPath = normalizePath(chapter.href);
    if (chapterPath === path) return chapter.index;
    if (
      suffixMatch === null &&
      (chapterPath.endsWith(path) || path.endsWith(chapterPath))
    )
      suffixMatch = chapter.index;
  }
  return suffixMatch;
}

/** The canonical offset of the block that holds a fragment id. */
function findTargetOffset(
  blocks: Block[],
  text: ChapterCanonicalText,
  targetId: string,
): number | null {
  let found = false;
  for (const block of blocks) {
    found ||=
      (block.targetIds?.includes(targetId) ?? false) ||
      (block.type === "text" &&
        block.runs.some((run) => run.targetIds?.includes(targetId)));
    // A target on an image or a break starts at the next text.
    const start = text.blockStarts.get(block.id);
    if (found && start !== undefined) return start;
  }
  return found ? text.fullText.length : null;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3"]);
const MAX_HEADING_LENGTH = 80;

/** A chapter's headings, for a file the table of contents does not divide. */
function headingSections(
  chapterIndex: number,
  blocks: Block[],
  text: ChapterCanonicalText,
  order: number,
): SearchSection[] {
  const starts = [...text.blockStarts.values()].sort((a, b) => a - b);
  const sections: SearchSection[] = [];
  for (const block of blocks) {
    if (block.type !== "text" || !HEADING_TAGS.has(block.tag)) continue;
    const start = text.blockStarts.get(block.id);
    if (start === undefined) continue;
    const end = starts.find((next) => next > start) ?? text.fullText.length;
    const title = text.fullText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!title) continue;
    sections.push({
      title:
        title.length > MAX_HEADING_LENGTH
          ? `${title.slice(0, MAX_HEADING_LENGTH - 1).trimEnd()}…`
          : title,
      chapterIndex,
      offset: start,
      order: order + sections.length,
    });
  }
  return sections;
}

/**
 * Where each part of the book starts, in reading order. Search groups
 * results under these, since one EPUB file often holds several chapters.
 * A file's table of contents entries divide it; a file the table of
 * contents does not reach is divided by its headings. Entries whose chapter
 * is not parsed yet are left out until it is.
 */
export function buildSearchSections(
  toc: TOCItem[],
  chapters: ChapterEntry[],
  getBlocks: (chapterIndex: number) => Block[] | null,
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null,
): SearchSection[] {
  const sections: SearchSection[] = [];
  const inToc = new Set<number>();
  let order = 0;
  const visit = (items: TOCItem[]) => {
    for (const item of items) {
      const index = order++;
      const chapterIndex = findChapter(normalizePath(item.href), chapters);
      const { fragment } = splitHrefFragment(item.href);
      if (chapterIndex !== null) {
        inToc.add(chapterIndex);
        let offset: number | null = 0;
        if (fragment) {
          const blocks = getBlocks(chapterIndex);
          const text = getCanonicalText(chapterIndex);
          offset =
            blocks && text ? findTargetOffset(blocks, text, fragment) : null;
        }
        if (offset !== null)
          sections.push({
            title: item.label.trim(),
            chapterIndex,
            offset,
            order: index,
          });
      }
      if (item.children?.length) visit(item.children);
    }
  };
  visit(toc);
  for (const chapter of chapters) {
    if (inToc.has(chapter.index)) continue;
    const blocks = getBlocks(chapter.index);
    const text = getCanonicalText(chapter.index);
    if (!blocks || !text) continue;
    const headings = headingSections(chapter.index, blocks, text, order);
    order += headings.length;
    sections.push(...headings);
  }
  return sections.sort(
    (a, b) =>
      a.chapterIndex - b.chapterIndex ||
      a.offset - b.offset ||
      a.order - b.order,
  );
}

/** The section of its own file a canonical position falls in, if any. */
export function findSection(
  sections: SearchSection[],
  chapterIndex: number,
  offset: number,
): SearchSection | null {
  let low = 0;
  let high = sections.length - 1;
  let found: SearchSection | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const section = sections[middle]!;
    if (
      section.chapterIndex < chapterIndex ||
      (section.chapterIndex === chapterIndex && section.offset <= offset)
    ) {
      found = section;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found?.chapterIndex === chapterIndex ? found : null;
}
