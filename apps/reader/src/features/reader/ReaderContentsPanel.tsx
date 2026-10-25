import { ScrollArea } from "@/components/ui/scroll-area";
import type { TOCItem } from "@/lib/db";
import { splitHrefFragment } from "@/lib/epub-resource-utils";
import { cn } from "@/lib/utils";
import { List } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, type Ref } from "react";
import type { ChapterEntry } from "./types";

interface ReaderContentsPanelProps {
  isOpen: boolean;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  onNavigateToHref: (href: string) => boolean;
  className?: string;
}

interface FlattenedTocItem {
  id: string;
  href: string;
  label: string;
  depth: number;
  visualDepth: number;
  path: string;
  hasFragment: boolean;
  number: number;
  page: number | null;
}

interface TocSection {
  id: string;
  heading: FlattenedTocItem | null;
  rows: FlattenedTocItem[];
  pageRange: string | null;
}

interface ResolvedTocHref {
  href: string;
  path: string;
  chapterIndex: number;
}

function normalizeHrefPath(href: string): string {
  const { path } = splitHrefFragment(href);
  return path.replace(/^\/+/, "");
}

function hrefPathsMatch(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function resolveTocHref(
  itemHref: string,
  chapterEntries: ChapterEntry[],
): ResolvedTocHref {
  const { path: tocPathWithSlashes, fragment } = splitHrefFragment(itemHref);
  const tocPath = tocPathWithSlashes.replace(/^\/+/, "");
  let suffixMatch: ChapterEntry | null = null;

  for (const chapterEntry of chapterEntries) {
    const chapterPath = normalizeHrefPath(chapterEntry.href);

    if (chapterPath === tocPath) {
      const href = fragment
        ? `${splitHrefFragment(chapterEntry.href).path}#${fragment}`
        : chapterEntry.href;

      return {
        href,
        path: normalizeHrefPath(href),
        chapterIndex: chapterEntry.index,
      };
    }

    if (!suffixMatch && hrefPathsMatch(chapterPath, tocPath)) {
      suffixMatch = chapterEntry;
    }
  }

  if (suffixMatch) {
    const href = fragment
      ? `${splitHrefFragment(suffixMatch.href).path}#${fragment}`
      : suffixMatch.href;

    return {
      href,
      path: normalizeHrefPath(href),
      chapterIndex: suffixMatch.index,
    };
  }

  throw new Error(`Unable to match TOC href "${itemHref}" to a chapter entry.`);
}

function formatPageRange(items: FlattenedTocItem[]): string | null {
  const pages = items
    .map((item) => item.page)
    .filter((page): page is number => page !== null);

  if (pages.length === 0) {
    return null;
  }

  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];

  return firstPage === lastPage ? `${firstPage}` : `${firstPage}-${lastPage}`;
}

function buildContentsModel(
  toc: TOCItem[],
  chapterEntries: ChapterEntry[],
  chapterStartPages: (number | null)[],
): { sections: TocSection[]; items: FlattenedTocItem[] } {
  let sequence = 0;
  const allItems: FlattenedTocItem[] = [];

  const createTocItem = (
    item: TOCItem,
    depth: number,
    visualDepth: number,
    entryKey: string,
  ): FlattenedTocItem => {
    sequence += 1;

    const resolvedHref = resolveTocHref(item.href, chapterEntries);
    const flattenedItem: FlattenedTocItem = {
      id: `${entryKey}-${item.href}`,
      href: resolvedHref.href,
      label: item.label,
      depth,
      visualDepth,
      path: resolvedHref.path,
      hasFragment: item.href.includes("#"),
      number: resolvedHref.chapterIndex + 1,
      page: chapterStartPages[resolvedHref.chapterIndex] ?? null,
    };

    allItems.push(flattenedItem);
    return flattenedItem;
  };

  const flattenTocItems = (
    items: TOCItem[],
    depth: number,
    visualDepthOffset: number,
    parentKey: string,
  ): FlattenedTocItem[] =>
    items.flatMap((item, index) => {
      const entryKey = `${parentKey}-${index}`;
      const flattenedItem = createTocItem(
        item,
        depth,
        Math.min(Math.max(depth - visualDepthOffset, 0), 1),
        entryKey,
      );

      const childItems = item.children?.length
        ? flattenTocItems(item.children, depth + 1, visualDepthOffset, entryKey)
        : [];

      return [flattenedItem, ...childItems];
    });

  if (!toc.some((item) => item.children?.length)) {
    const rows = flattenTocItems(toc, 0, 0, "toc");

    return {
      sections: [{ id: "toc-flat", heading: null, rows, pageRange: null }],
      items: allItems,
    };
  }

  const sections: TocSection[] = [];
  let looseRows: FlattenedTocItem[] = [];

  const flushLooseRows = () => {
    if (looseRows.length === 0) {
      return;
    }

    sections.push({
      id: `toc-loose-${sections.length}`,
      heading: null,
      rows: looseRows,
      pageRange: null,
    });
    looseRows = [];
  };

  toc.forEach((item, index) => {
    const entryKey = `toc-${index}`;
    const heading = createTocItem(item, 0, 0, entryKey);

    if (!item.children?.length) {
      looseRows.push(heading);
      return;
    }

    flushLooseRows();

    const rows = flattenTocItems(item.children, 1, 1, entryKey);
    sections.push({
      id: heading.id,
      heading,
      rows,
      pageRange: formatPageRange([heading, ...rows]),
    });
  });
  flushLooseRows();

  return { sections, items: allItems };
}

function resolveCurrentTocItem(
  items: FlattenedTocItem[],
  currentChapterHref: string,
): FlattenedTocItem | null {
  const currentPath = normalizeHrefPath(currentChapterHref);
  if (!currentPath) {
    return null;
  }

  return (
    items.find(
      (item) =>
        hrefPathsMatch(item.path, currentPath) &&
        !item.hasFragment &&
        item.depth === 0,
    ) ??
    items.find(
      (item) => hrefPathsMatch(item.path, currentPath) && !item.hasFragment,
    ) ??
    items.find((item) => hrefPathsMatch(item.path, currentPath)) ??
    null
  );
}

function SectionHeading({
  section,
  currentItemId,
  onSelect,
  currentRef,
}: {
  section: TocSection;
  currentItemId?: string;
  onSelect: (href: string) => boolean;
  currentRef?: Ref<HTMLButtonElement>;
}) {
  if (!section.heading) {
    return null;
  }

  const heading = section.heading;
  const isCurrent = heading.id === currentItemId;

  return (
    <button
      ref={isCurrent ? currentRef : undefined}
      type="button"
      aria-current={isCurrent ? "location" : undefined}
      onClick={() => {
        onSelect(heading.href);
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-none border-b border-border/70 px-1 pb-2 text-left outline-none transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:bg-secondary/45 active:[transform:scale(0.97)] motion-reduce:active:transform-none motion-reduce:active:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50",
        isCurrent && "border-foreground/70",
      )}
    >
      <h4
        className={cn(
          "min-w-0 flex-1 truncate text-[0.68rem] font-medium uppercase tracking-[0.22em] text-muted-foreground",
          isCurrent && "text-foreground",
        )}
      >
        {heading.label}
      </h4>

      {section.pageRange && (
        <p
          className={cn(
            "max-w-[6rem] shrink-0 truncate text-right font-numeric text-xs tabular-nums text-muted-foreground",
            isCurrent && "font-medium text-foreground",
          )}
        >
          {section.pageRange}
        </p>
      )}
    </button>
  );
}

function ChapterRow({
  item,
  currentItemId,
  onSelect,
  currentRef,
}: {
  item: FlattenedTocItem;
  currentItemId?: string;
  onSelect: (href: string) => boolean;
  currentRef?: Ref<HTMLButtonElement>;
}) {
  const isCurrent = item.id === currentItemId;

  return (
    <button
      ref={isCurrent ? currentRef : undefined}
      type="button"
      aria-current={isCurrent ? "location" : undefined}
      onClick={() => {
        onSelect(item.href);
      }}
      className="group relative block min-h-12 w-full rounded-xl py-3 text-left outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:bg-accent/60 active:[transform:scale(0.97)] motion-reduce:active:transform-none motion-reduce:active:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{
        paddingLeft: `${0.5 + item.visualDepth * 0.85}rem`,
        paddingRight: "0.5rem",
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl bg-accent/45 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
      />
      {isCurrent ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 z-0 rounded-xl bg-accent/45"
        >
          <span className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-foreground/70" />
        </span>
      ) : null}

      <div className="relative z-10 grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_minmax(2.25rem,max-content)] items-baseline gap-3 px-1">
        <span
          className={cn(
            "min-w-0 text-right font-numeric text-xs tabular-nums text-muted-foreground",
            isCurrent && "font-medium text-foreground",
          )}
        >
          {item.number}
        </span>

        <div className="flex min-w-0 max-w-full items-baseline gap-2 overflow-hidden">
          <span
            className={cn(
              "min-w-0 shrink break-words text-balance text-[0.95rem] font-normal leading-snug text-foreground",
              isCurrent && "font-semibold",
            )}
          >
            {item.label}
          </span>
        </div>

        <span
          className={cn(
            "min-w-0 text-right font-numeric text-sm tabular-nums text-muted-foreground",
            isCurrent && "font-medium text-foreground",
          )}
          aria-label={item.page === null ? undefined : `Page ${item.page}`}
        >
          {item.page ?? ""}
        </span>
      </div>
    </button>
  );
}

export function ReaderContentsPanel({
  isOpen,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  onNavigateToHref,
  className,
}: ReaderContentsPanelProps) {
  const scrollAreaRootRef = useRef<HTMLDivElement | null>(null);
  const currentItemRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  const contentsModel = useMemo(
    () => buildContentsModel(toc, chapterEntries, chapterStartPages),
    [chapterEntries, chapterStartPages, toc],
  );
  const currentTocItem = useMemo(
    () => resolveCurrentTocItem(contentsModel.items, currentChapterHref),
    [contentsModel.items, currentChapterHref],
  );

  // Position the active entry before paint so the sheet opens at the current
  // chapter instead of visibly jumping after the drawer animation begins.
  useLayoutEffect(() => {
    const shouldPositionCurrentItem = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    const viewport = scrollAreaRootRef.current?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    const currentItem = currentItemRef.current;

    if (!shouldPositionCurrentItem || !viewport || !currentItem) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const itemRect = currentItem.getBoundingClientRect();
    viewport.scrollTop += itemRect.top - viewportRect.top - 16;
  }, [isOpen, currentTocItem?.id]);

  return (
    <div
      className={cn(
        "flex h-[32rem] min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden",
        className,
      )}
    >
      <div
        ref={scrollAreaRootRef}
        className="min-h-0 w-full min-w-0 max-w-full flex-1 overflow-hidden"
      >
        <ScrollArea className="h-full w-full min-w-0 max-w-full overflow-x-hidden px-4 pb-3 pt-2">
          {contentsModel.items.length > 0 ? (
            <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden pb-1">
              {contentsModel.sections.map((section, index) => {
                const followsGroupedSection =
                  !section.heading &&
                  Boolean(contentsModel.sections[index - 1]?.heading);

                return (
                  <section
                    key={section.id}
                    className={cn(
                      "space-y-3",
                      !section.heading && "space-y-1",
                      followsGroupedSection && "border-t border-border/60 pt-3",
                    )}
                  >
                    <SectionHeading
                      section={section}
                      currentItemId={currentTocItem?.id}
                      onSelect={onNavigateToHref}
                      currentRef={currentItemRef}
                    />

                    <div className="flex flex-col">
                      {section.rows.map((item) => (
                        <ChapterRow
                          key={item.id}
                          item={item}
                          currentItemId={currentTocItem?.id}
                          onSelect={onNavigateToHref}
                          currentRef={currentItemRef}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full border border-border/60 bg-secondary/25 text-muted-foreground">
                <List className="size-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">
                No table of contents available
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This book does not expose chapter navigation metadata.
              </p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
