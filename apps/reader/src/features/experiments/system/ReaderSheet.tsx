/**
 * The reading screen. Nothing on it moves while you read: panels float over
 * it, and the controls stay out of sight until the pointer comes near the top
 * or bottom edge (or you tap, on touch). Two controls only: Appearance and
 * Contents. The bookmark lives on the page itself, as a ribbon.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { ChevronLeft, List, NotebookPen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StudioInk } from "../data/sample-library";
import {
  availablePages,
  BookPage,
  chapterEnd,
  chapterOfPage,
  type BookLayout,
  type BookModel,
  type BookTypography,
  type EdgeHighlight,
  type InkFlash,
} from "../data/walden-book";
import { TypographicCover, useElementSize } from "../primitives";
import { formatMinutesLeft, Hairline, IconButton, MOTION, TextButton } from "./ui";
import { minutesForPages, type ShelfBook } from "./state";
import type { PanelTab } from "./ReaderPanel";

const INKS: StudioInk[] = ["yellow", "green", "blue", "magenta"];
export const PAGE_GAP = 64;
const EDGE_ZONE = 72;

export interface SelectionDraft {
  paragraph: number;
  start: number;
  end: number;
  text: string;
}

type Toolbar =
  | { kind: "selection"; draft: SelectionDraft; x: number; y: number; below: boolean }
  | { kind: "mark"; id: string; x: number; y: number; below: boolean };

const TURN: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 8 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.2, 0, 0, 1] } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -8, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }),
};

/** Grows a selection to whole words, with closing punctuation. */
function snapToWords(text: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  while (from > 0 && /\S/.test(text[from - 1])) from -= 1;
  while (to < text.length && /[\p{L}\p{N}’'-]/u.test(text[to])) to += 1;
  if (to < text.length && /[.,;:!?”]/.test(text[to])) to += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  while (from < to && /[\s“]/.test(text[from])) from += 1;
  return [from, to];
}

function offsetWithin(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function spreadOf(page: number, layout: BookLayout, model: BookModel, spread: boolean) {
  const pages = availablePages(layout, model);
  let index = pages.indexOf(page);
  if (index < 0) {
    const after = pages.findIndex((candidate) => candidate > page);
    index = after < 0 ? pages.length - 1 : Math.max(0, after - 1);
  }
  const start = spread ? index - (index % 2) : index;
  const step = spread ? 2 : 1;
  return {
    start,
    shown: pages.slice(start, start + step),
    previous: pages[Math.max(0, start - step)],
    next: pages[Math.min(pages.length - 1, start + step)],
  };
}

export function ReaderSheet({
  book,
  model,
  page,
  layout,
  highlights,
  typography,
  spread,
  showFolio,
  pageWidth,
  pageHeight,
  scale,
  flash,
  hoveredId,
  bookmarks,
  panelOpen,
  panelTab,
  onPage,
  onLayout,
  onBack,
  onPanel,
  onToggleBookmark,
  onHighlight,
  onRecolor,
  onRemove,
  onNoteFor,
}: {
  book: ShelfBook;
  model: BookModel | null;
  page: number;
  layout: BookLayout;
  highlights: EdgeHighlight[];
  typography: BookTypography;
  spread: boolean;
  showFolio: boolean;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  flash: InkFlash | null;
  hoveredId: string | null;
  bookmarks: number[];
  panelOpen: boolean;
  panelTab: PanelTab;
  onPage: (page: number) => void;
  onLayout: (layout: BookLayout) => void;
  onBack: () => void;
  onPanel: (tab: PanelTab | null) => void;
  onToggleBookmark: (page: number) => void;
  onHighlight: (draft: SelectionDraft, color: StudioInk) => string;
  onRecolor: (id: string, color: StudioInk) => void;
  onRemove: (id: string) => void;
  onNoteFor: (id: string) => void;
}) {
  const [sheetRef, sheetSize] = useElementSize<HTMLDivElement>();
  const sheetNode = useRef<HTMLDivElement | null>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<{ top: boolean; bottom: boolean }>({ top: true, bottom: true });
  const [touchChrome, setTouchChrome] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const lastStart = useRef(0);
  const compact = sheetSize.width > 0 && sheetSize.width < 640;

  const view = model ? spreadOf(page, layout, model, spread) : null;
  const direction = view ? (view.start >= lastStart.current ? 1 : -1) : 1;
  useEffect(() => {
    if (view) lastStart.current = view.start;
  });

  // Show the controls briefly when a book opens, so you know where they live.
  useEffect(() => {
    setNear({ top: true, bottom: true });
    const timer = window.setTimeout(() => setNear({ top: false, bottom: false }), 1600);
    return () => window.clearTimeout(timer);
  }, [book.id]);

  // A page turn or a reflow dismisses a toolbar that no longer points at anything.
  useEffect(() => setToolbar(null), [page, spread, typography]);

  const topVisible = near.top || touchChrome || focusWithin;
  const bottomVisible = near.bottom || touchChrome;
  const chapter = model ? model.chapters[chapterOfPage(page, model)] : null;
  const chapterLeft = model && chapter ? chapterEnd(chapter.index, model) - page : 0;
  const shownLabel = view
    ? view.shown.length > 1
      ? `${view.shown[0]}–${view.shown[view.shown.length - 1]}`
      : `${view.shown[0]}`
    : "";

  const placeToolbar = (rect: DOMRect) => {
    const sheet = sheetNode.current?.getBoundingClientRect();
    if (!sheet) return null;
    const below = rect.top - sheet.top < 70;
    return {
      x: Math.min(Math.max(rect.left + rect.width / 2 - sheet.left, 120), sheet.width - 120),
      y: below ? rect.bottom - sheet.top + 10 : rect.top - sheet.top - 10,
      below,
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!model) return;
    const mark = (event.target as HTMLElement).closest<HTMLElement>("mark[data-hl]");
    const pointerType = event.pointerType;
    const clientX = event.clientX;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const startPara = range.startContainer.parentElement?.closest<HTMLElement>("[data-para]");
        const endPara = range.endContainer.parentElement?.closest<HTMLElement>("[data-para]");
        if (!startPara || startPara !== endPara || !spreadRef.current?.contains(startPara)) return;
        const paragraph = Number(startPara.dataset.para);
        const text = model.text.paragraphs[paragraph];
        const rawStart = offsetWithin(startPara, range.startContainer, range.startOffset);
        const rawEnd = offsetWithin(startPara, range.endContainer, range.endOffset);
        const [start, end] = snapToWords(text, Math.min(rawStart, rawEnd), Math.max(rawStart, rawEnd));
        if (end - start < 2) return;
        const overlaps = highlights.some((highlight) => {
          if (highlight.chapter !== model.textChapter) return false;
          const at = text.indexOf(highlight.text);
          return at >= 0 && at < end && start < at + highlight.text.length;
        });
        if (overlaps) return;
        const place = placeToolbar(range.getBoundingClientRect());
        if (place) setToolbar({ kind: "selection", draft: { paragraph, start, end, text: text.slice(start, end) }, ...place });
        return;
      }
      if (mark?.dataset.hl) {
        const place = placeToolbar(mark.getClientRects()[0] ?? mark.getBoundingClientRect());
        if (place) setToolbar({ kind: "mark", id: mark.dataset.hl, ...place });
        return;
      }
      if (toolbar) {
        setToolbar(null);
        return;
      }
      // A plain click turns the page from its outer edges; a tap in the middle shows the controls.
      const box = spreadRef.current?.getBoundingClientRect();
      if (!box || !view) return;
      const x = (clientX - box.left) / box.width;
      if (x < 0.22) onPage(view.previous);
      else if (x > 0.78) onPage(view.next);
      else if (pointerType !== "mouse") setTouchChrome((shown) => !shown);
    }, 0);
  };

  const commit = (color: StudioInk) => {
    if (toolbar?.kind !== "selection") return;
    onHighlight(toolbar.draft, color);
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  };

  const spreadWidth = view && view.shown.length > 1 ? pageWidth * 2 + PAGE_GAP : pageWidth;
  const chromeTransition = (visible: boolean) => (visible ? MOTION.enter : { duration: 0.4, ease: [0.4, 0, 1, 1] as const });

  return (
    <div
      ref={(node) => {
        sheetNode.current = node;
        sheetRef(node);
      }}
      className="relative size-full overflow-hidden bg-background"
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const box = event.currentTarget.getBoundingClientRect();
        const y = event.clientY - box.top;
        const top = y < EDGE_ZONE;
        const bottom = y > box.height - EDGE_ZONE;
        if (top !== near.top || bottom !== near.bottom) setNear({ top, bottom });
      }}
      onPointerLeave={() => setNear({ top: false, bottom: false })}
    >
      <motion.header
        className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between gap-3 px-3"
        initial={false}
        animate={{ opacity: topVisible ? 1 : 0, transition: chromeTransition(topVisible) }}
        onFocus={() => setFocusWithin(true)}
        onBlur={() => setFocusWithin(false)}
        style={{ pointerEvents: topVisible ? "auto" : "none" }}
      >
        <TextButton onClick={onBack} className="pl-1">
          <ChevronLeft className="size-4" strokeWidth={1.6} />
          {compact ? <span className="sr-only">Library</span> : "Library"}
        </TextButton>
        {!compact && (
          <p className="pointer-events-none absolute left-1/2 max-w-[44%] -translate-x-1/2 truncate text-center text-[12.5px] text-muted-foreground">
            {book.title}
            {chapter && <span className="text-muted-foreground/70"> · {chapter.title}</span>}
          </p>
        )}
        <div className="flex items-center gap-0.5">
          <TextButton
            aria-label="Appearance (A)"
            title="Appearance (A)"
            disabled={!model}
            onClick={() => onPanel(panelOpen && panelTab === "appearance" ? null : "appearance")}
            className={cn("px-2 font-medium", panelOpen && panelTab === "appearance" && "text-foreground")}
          >
            Aa
          </TextButton>
          <IconButton
            label="Contents and notes (T)"
            active={panelOpen && panelTab !== "appearance"}
            disabled={!model}
            onClick={() => onPanel(panelOpen && panelTab !== "appearance" ? null : panelTab === "appearance" ? "contents" : panelTab)}
          >
            <List className="size-4" strokeWidth={1.6} />
          </IconButton>
        </div>
      </motion.header>

      {model && view ? (
        <div className="absolute inset-x-0 top-12 bottom-10 flex items-center justify-center">
          <div
            ref={spreadRef}
            className="relative shrink-0"
            style={{ width: spreadWidth, height: pageHeight, transform: scale < 1 ? `scale(${scale})` : undefined }}
            onPointerUp={handlePointerUp}
          >
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={`${view.start}-${view.shown.length}`}
                custom={direction}
                variants={TURN}
                initial="enter"
                animate="center"
                exit="exit"
                className="absolute inset-0 flex"
                style={{ gap: PAGE_GAP }}
              >
                {view.shown.map((shownPage, index) => (
                  <div key={shownPage} className="relative shrink-0" style={{ width: pageWidth, height: pageHeight }}>
                    <BookPage
                      page={shownPage}
                      book={model}
                      typography={typography}
                      highlights={highlights}
                      flash={flash}
                      hoveredId={hoveredId}
                      showFolio={showFolio}
                      onLayout={index === 0 ? onLayout : undefined}
                    />
                    <BookmarkRibbon
                      page={shownPage}
                      marked={bookmarks.includes(shownPage)}
                      onToggle={() => onToggleBookmark(shownPage)}
                    />
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <TypographicCover book={book} className="h-[180px] w-[120px] rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.1),0_14px_30px_-16px_rgb(0_0_0/0.4)]" />
          <p className="xp-serif mt-8 text-[22px]">{book.title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{book.author}</p>
          <p className="mt-6 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">
            This book has no sample text. Walden, Moby-Dick and Emerson’s Essays open in full.
          </p>
        </div>
      )}

      {model && (
        <motion.footer
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-10 items-center justify-center font-numeric text-[11.5px] text-muted-foreground tabular-nums"
          initial={false}
          animate={{ opacity: bottomVisible ? 1 : 0, transition: chromeTransition(bottomVisible) }}
        >
          {shownLabel} of {model.pages}
          {chapterLeft > 0 && ` · ${formatMinutesLeft(minutesForPages(chapterLeft))} left in the chapter`}
          <Hairline value={page / model.pages} className="absolute inset-x-0 bottom-0 rounded-none" />
        </motion.footer>
      )}

      <AnimatePresence>
        {toolbar && (
          <motion.div
            key={`${toolbar.kind}-${toolbar.x}-${toolbar.y}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: MOTION.enter }}
            exit={{ opacity: 0, transition: MOTION.exit }}
            className={cn(
              "absolute z-30 flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-full bg-foreground px-1 text-background shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)]",
              !toolbar.below && "-translate-y-full",
            )}
            style={{ left: toolbar.x, top: toolbar.y }}
            onPointerUp={(event) => event.stopPropagation()}
          >
            {INKS.map((ink) => {
              const current =
                toolbar.kind === "mark" && highlights.find((highlight) => highlight.id === toolbar.id)?.color === ink;
              return (
                <button
                  key={ink}
                  type="button"
                  aria-label={`Highlight ${ink}`}
                  onClick={() => {
                    if (toolbar.kind === "selection") commit(ink);
                    else {
                      onRecolor(toolbar.id, ink);
                      setToolbar(null);
                    }
                  }}
                  className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-background/10 focus-visible:ring-2 focus-visible:ring-background/60"
                >
                  <span
                    className="size-3.5 rounded-full"
                    style={{
                      background: `var(--${ink}-secondary)`,
                      boxShadow: current ? `0 0 0 2px var(--foreground), 0 0 0 3px var(--${ink}-secondary)` : undefined,
                    }}
                  />
                </button>
              );
            })}
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-background/20" />
            <button
              type="button"
              onClick={() => {
                if (toolbar.kind === "selection") {
                  const id = onHighlight(toolbar.draft, "yellow");
                  window.getSelection()?.removeAllRanges();
                  onNoteFor(id);
                } else {
                  onNoteFor(toolbar.id);
                }
                setToolbar(null);
              }}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12.5px] outline-none hover:bg-background/10 focus-visible:ring-2 focus-visible:ring-background/60"
            >
              <NotebookPen className="size-3.5" strokeWidth={1.7} />
              Note
            </button>
            {toolbar.kind === "mark" && (
              <button
                type="button"
                aria-label="Remove highlight"
                onClick={() => {
                  onRemove(toolbar.id);
                  setToolbar(null);
                }}
                className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-background/10 focus-visible:ring-2 focus-visible:ring-background/60"
              >
                <Trash2 className="size-3.5" strokeWidth={1.7} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A ribbon at the head of the page. It shows faintly when you point at the
 * corner, and stays when the page is marked.
 */
function BookmarkRibbon({ page, marked, onToggle }: { page: number; marked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={marked ? `Remove bookmark on page ${page}` : `Bookmark page ${page} (B)`}
      aria-pressed={marked}
      title={marked ? "Remove bookmark (B)" : "Bookmark (B)"}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={onToggle}
      className="group/ribbon absolute top-0 right-[7%] z-10 flex h-14 w-10 cursor-pointer justify-center outline-none"
    >
      <span
        className={cn(
          "block h-8 w-[11px] transition-[opacity,background-color,height] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-focus-visible/ribbon:opacity-100",
          marked
            ? "h-9 bg-foreground/70 opacity-100"
            : "bg-foreground/30 opacity-0 group-hover/ribbon:opacity-60",
        )}
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 5px), 0 100%)" }}
      />
    </button>
  );
}
