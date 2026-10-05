/**
 * System: the library, the app sidebar and the reader's panel as one
 * product.
 *
 * Layout rules:
 * - In the library the sidebar is part of the screen. Showing or hiding it
 *   is instant, with no animated layout.
 * - While reading, the page never moves. The sidebar and the panel float
 *   over it, and only their own opacity and position animate.
 * - Screens crossfade. Coming back from a book returns you to the same
 *   place in the library.
 */
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StudioInk, StudioLibrary, StudioStatus } from "../data/sample-library";
import {
  BOOK_TYPOGRAPHY,
  chapterOfPage,
  clampTextPage,
  initialLayout,
  remapTextPage,
  sameLayout,
  type BookLayout,
  type BookTypography,
  type InkFlash,
} from "../data/walden-book";
import { useElementSize } from "../primitives";
import { CommandPalette } from "./CommandPalette";
import { HighlightsView } from "./HighlightsView";
import { LibraryView } from "./LibraryView";
import { ReaderPanel, type PanelTab, type SystemTheme } from "./ReaderPanel";
import { PAGE_GAP, ReaderSheet, spreadOf, type SelectionDraft } from "./ReaderSheet";
import { Sidebar, type SystemView } from "./Sidebar";
import { entryPage, highlightsFor, initialEntries, shelfFromLibrary, type Entry, type ShelfBook } from "./state";
import { FLOATING_SURFACE, MOTION } from "./ui";

const SIDEBAR_WIDTH = 232;
const PANEL_WIDTH = 340;
const DARK_THEMES: SystemTheme[] = ["dark", "flexoki-dark", "night"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function SystemPrototype({ library }: { library: StudioLibrary }) {
  const { settings } = useReaderSettings();
  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const focusRef = useRef<HTMLDivElement>(null);
  const libraryScroll = useRef(0);
  // Whether the docked sidebar should fade with a screen change, or change instantly.
  const sidebarFades = useRef(false);
  const [shelf, setShelf] = useState<ShelfBook[]>(() => shelfFromLibrary(library));
  const [view, setView] = useState<SystemView>({ kind: "library" });
  const [dockedSidebar, setDockedSidebar] = useState(true);
  const [floatingSidebar, setFloatingSidebar] = useState(false);
  const [panel, setPanel] = useState<{ open: boolean; tab: PanelTab }>({ open: false, tab: "contents" });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<Record<string, number>>(() =>
    Object.fromEntries(shelfFromLibrary(library).flatMap((book) => (book.model ? [[book.id, book.model.readingPage]] : []))),
  );
  const [layouts, setLayouts] = useState<Record<string, BookLayout>>({});
  const layoutsRef = useRef<Record<string, BookLayout>>({});
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [bookmarks, setBookmarks] = useState<Record<string, number[]>>({ walden: [85] });
  const [typography, setTypography] = useState<BookTypography>(BOOK_TYPOGRAPHY);
  const [theme, setTheme] = useState<SystemTheme>(() =>
    settings.theme === "dark" || settings.theme === "night" || settings.theme === "flexoki-dark" || settings.theme === "flexoki-light"
      ? settings.theme
      : "light",
  );
  const [spreadPref, setSpreadPref] = useState(true);
  const [showFolio, setShowFolio] = useState(true);
  const [flash, setFlash] = useState<InkFlash | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [attachId, setAttachId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const width = size.width;
  const height = size.height;
  const wide = width >= 900;
  const inReader = view.kind === "reader";
  const openBook = inReader ? shelf.find((book) => book.id === view.bookId) ?? null : null;
  const model = openBook?.model ?? null;
  const layout = model ? (layouts[model.id] ?? initialLayout(model)) : null;
  const page = model ? (pages[model.id] ?? model.readingPage) : 0;
  const panelOpen = inReader && panel.open && model !== null;
  const sidebarDocked = !inReader && wide && dockedSidebar;
  const sidebarFloating = (inReader || !wide) && floatingSidebar;
  const isDark = DARK_THEMES.includes(theme);
  const screenLeft = sidebarDocked ? SIDEBAR_WIDTH : 0;

  // Pages keep one size for the window; nothing that opens over them changes it.
  const spread = spreadPref && width >= 1120;
  const pageHeight = clamp(height - 120, 340, 780);
  const pageWidth = spread
    ? Math.min(Math.round(pageHeight * 0.66), Math.floor((width - 160 - PAGE_GAP) / 2))
    : Math.min(Math.round(pageHeight * 0.66), Math.max(240, width - 40));

  const handleLayout = useCallback(
    (next: BookLayout) => {
      if (!model) return;
      const previous = layoutsRef.current[model.id] ?? initialLayout(model);
      if (layoutsRef.current[model.id] && sameLayout(previous, next)) return;
      layoutsRef.current = { ...layoutsRef.current, [model.id]: next };
      setLayouts(layoutsRef.current);
      setPages((current) => ({
        ...current,
        [model.id]: remapTextPage(current[model.id] ?? model.readingPage, previous, next, model),
      }));
    },
    [model],
  );

  const touchBook = (bookId: string, patch: Partial<ShelfBook> = {}) => {
    setShelf((current) => current.map((book) => (book.id === bookId ? { ...book, lastReadAt: Date.now(), ...patch } : book)));
  };

  const openBookById = (bookId: string) => {
    const book = shelf.find((candidate) => candidate.id === bookId);
    if (!book) return;
    touchBook(bookId, book.status === "want-to-read" || book.status === "dnf" ? { status: "reading" } : {});
    sidebarFades.current = true;
    setView({ kind: "reader", bookId });
    setFloatingSidebar(false);
    setSearching(false);
    setQuery("");
    setAttachId(null);
    setActiveEntryId(null);
    focusRef.current?.focus({ preventScroll: true });
  };

  const navigate = (next: SystemView) => {
    sidebarFades.current = true;
    setView(next);
    setFloatingSidebar(false);
    setPanel((current) => ({ ...current, open: false }));
  };

  const goTo = (target: number, entryId?: string) => {
    if (!model || !layout) return;
    const next = clampTextPage(target, layout, model);
    const turned = !spreadOf(page, layout, model, spread).shown.includes(next);
    setPages((current) => ({ ...current, [model.id]: next }));
    touchBook(model.id);
    window.clearTimeout(flashTimer.current);
    setActiveEntryId(entryId ?? null);
    if (!wide) setPanel((current) => ({ ...current, open: false }));
    if (entryId && entries.find((entry) => entry.id === entryId)?.kind === "highlight") {
      flashTimer.current = window.setTimeout(() => setFlash({ id: entryId, key: Date.now() }), turned ? 220 : 0);
    }
  };

  const openPanel = (tab: PanelTab | null, options?: { search?: boolean }) => {
    if (tab === null) {
      setPanel((current) => ({ ...current, open: false }));
      setSearching(false);
      return;
    }
    setPanel({ open: true, tab });
    setSearching(Boolean(options?.search));
  };

  const toggleSidebar = () => {
    if (!inReader && wide) {
      sidebarFades.current = false;
      setDockedSidebar((shown) => !shown);
      return;
    }
    setFloatingSidebar((shown) => !shown);
  };

  const toggleBookmark = (target = page) => {
    if (!model) return;
    setBookmarks((current) => {
      const list = current[model.id] ?? [];
      return { ...current, [model.id]: list.includes(target) ? list.filter((value) => value !== target) : [...list, target] };
    });
  };

  const createHighlight = (draft: SelectionDraft, color: StudioInk): string => {
    const id = `h${Date.now()}`;
    if (!model) return id;
    setEntries((current) => [
      ...current,
      { id, bookId: model.id, kind: "highlight", chapter: model.textChapter, color, text: draft.text, note: null, page: null, daysAgo: 0 },
    ]);
    setFlash({ id, key: Date.now() });
    setActiveEntryId(id);
    return id;
  };

  const noteFor = (id: string) => {
    setAttachId(id);
    setActiveEntryId(id);
    openPanel("notes");
    setComposerFocusKey((key) => key + 1);
  };

  const addNote = (note: string, attach: string | null) => {
    if (!model) return;
    if (attach) {
      setEntries((current) => current.map((entry) => (entry.id === attach ? { ...entry, note } : entry)));
      setActiveEntryId(attach);
      setAttachId(null);
      return;
    }
    const id = `n${Date.now()}`;
    setEntries((current) => [
      ...current,
      { id, bookId: model.id, kind: "note", chapter: chapterOfPage(page, model), color: null, text: null, note, page, daysAgo: 0 },
    ]);
    setActiveEntryId(id);
  };

  const saveNote = (id: string, note: string | null) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, note } : entry)));
  };

  const deleteEntry = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    if (attachId === id) setAttachId(null);
  };

  const openEntry = (entry: Entry) => {
    const book = shelf.find((candidate) => candidate.id === entry.bookId);
    if (!book?.model) return;
    const target = entryPage(entry, layouts[book.id] ?? initialLayout(book.model), book.model);
    openBookById(book.id);
    setPages((current) => ({ ...current, [book.id]: target }));
    setActiveEntryId(entry.id);
    if (entry.kind === "highlight") {
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash({ id: entry.id, key: Date.now() }), 360);
    }
  };

  const toggleTheme = () => setTheme((current) => (DARK_THEMES.includes(current) ? "light" : "dark"));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPaletteOpen((open) => !open);
      return;
    }
    if (paletteOpen || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "[") {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (event.key === "Escape") {
      if (floatingSidebar) setFloatingSidebar(false);
      else if (panel.open) openPanel(null);
      return;
    }
    if (!inReader || !model || !layout) return;
    const current = spreadOf(page, layout, model, spread);
    const key = event.key.toLowerCase();
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(current.next);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(current.previous);
    } else if (key === "t") {
      openPanel(panel.open && panel.tab === "contents" ? null : "contents");
    } else if (key === "n") {
      openPanel(panel.open && panel.tab === "notes" ? null : "notes");
    } else if (key === "a") {
      openPanel(panel.open && panel.tab === "appearance" ? null : "appearance");
    } else if (event.key === "/") {
      event.preventDefault();
      openPanel(panel.tab === "appearance" ? "contents" : panel.tab, { search: true });
    } else if (key === "b") {
      toggleBookmark();
    }
  };

  const ready = width > 0;
  const screenKey = view.kind === "reader" ? `reader-${view.bookId}` : view.kind;
  const fades = sidebarFades.current;

  const sidebar = (
    <Sidebar
      books={shelf}
      pages={pages}
      view={view}
      isDark={isDark}
      onNavigate={navigate}
      onOpenBook={openBookById}
      onSearch={() => setPaletteOpen(true)}
      onToggleTheme={toggleTheme}
    />
  );

  const panelBody =
    model && layout ? (
      <ReaderPanel
        model={model}
        layout={layout}
        page={page}
        entries={entries.filter((entry) => entry.bookId === model.id)}
        bookmarks={bookmarks[model.id] ?? []}
        typography={typography}
        theme={theme}
        spread={spreadPref}
        showFolio={showFolio}
        tab={panel.tab}
        searching={searching}
        query={query}
        composerFocusKey={composerFocusKey}
        attachId={attachId}
        activeEntryId={activeEntryId}
        onTab={(tab) => setPanel({ open: true, tab })}
        onSearching={(value) => {
          setSearching(value);
          if (!value) setQuery("");
        }}
        onQuery={setQuery}
        onClose={() => openPanel(null)}
        onGo={goTo}
        onHover={setHoveredId}
        onTypography={setTypography}
        onTheme={setTheme}
        onSpread={setSpreadPref}
        onShowFolio={setShowFolio}
        onAddNote={addNote}
        onAttach={setAttachId}
        onSaveNote={saveNote}
        onDelete={deleteEntry}
        onToggleBookmark={toggleBookmark}
      />
    ) : null;

  return (
    <div
      ref={rootRef}
      className={cn(theme, "relative size-full overflow-hidden bg-background font-sans text-foreground antialiased")}
      style={{ colorScheme: isDark ? "dark" : "light" }}
    >
      <div
        ref={focusRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          // Keep keyboard shortcuts working after a press on plain content.
          if (!(event.target as HTMLElement).closest("button, input, textarea, a, [role='slider']")) {
            focusRef.current?.focus({ preventScroll: true });
          }
        }}
        className="absolute inset-0 outline-none"
      >
        {ready && (
          <>
            <AnimatePresence initial={false}>
              {sidebarDocked && (
                <motion.aside
                  key="docked-sidebar"
                  aria-label="App sidebar"
                  className="absolute inset-y-0 left-0 z-10 border-r border-foreground/[0.06] bg-sidebar"
                  style={{ width: SIDEBAR_WIDTH }}
                  initial={fades ? { opacity: 0 } : false}
                  animate={{ opacity: 1, transition: fades ? MOTION.screen : { duration: 0 } }}
                  exit={{ opacity: 0, transition: fades ? MOTION.exit : { duration: 0 } }}
                >
                  {sidebar}
                </motion.aside>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              <motion.main
                key={screenKey}
                className="absolute inset-y-0 right-0"
                style={{ left: inReader ? 0 : screenLeft }}
                initial={{ opacity: 0, scale: inReader ? 0.995 : 1 }}
                animate={{ opacity: 1, scale: 1, transition: MOTION.screen }}
                exit={{ opacity: 0, transition: MOTION.exit }}
              >
                {view.kind === "library" && (
                  <LibraryView
                    books={shelf}
                    pages={pages}
                    narrow={!wide}
                    sidebarHidden={!sidebarDocked}
                    scrollMemory={libraryScroll}
                    onShowSidebar={toggleSidebar}
                    onOpen={openBookById}
                    onSetStatus={(bookId: string, status: StudioStatus) =>
                      setShelf((current) => current.map((book) => (book.id === bookId ? { ...book, status } : book)))
                    }
                    onRemove={(bookId) => setShelf((current) => current.filter((book) => book.id !== bookId))}
                  />
                )}
                {view.kind === "highlights" && (
                  <HighlightsView
                    books={shelf}
                    entries={entries}
                    layouts={layouts}
                    narrow={!wide}
                    sidebarHidden={!sidebarDocked}
                    onShowSidebar={toggleSidebar}
                    onOpenEntry={openEntry}
                    onSaveNote={saveNote}
                    onDelete={deleteEntry}
                  />
                )}
                {openBook && (
                  <ReaderSheet
                    book={openBook}
                    model={model}
                    page={page}
                    layout={layout ?? initialLayout()}
                    highlights={model ? highlightsFor(entries, model.id) : []}
                    typography={typography}
                    spread={spread}
                    showFolio={showFolio}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                    scale={1}
                    flash={flash}
                    hoveredId={hoveredId}
                    bookmarks={model ? (bookmarks[model.id] ?? []) : []}
                    panelOpen={panelOpen}
                    panelTab={panel.tab}
                    onPage={goTo}
                    onLayout={handleLayout}
                    onBack={() => navigate({ kind: "library" })}
                    onPanel={(tab) => openPanel(tab)}
                    onToggleBookmark={toggleBookmark}
                    onHighlight={createHighlight}
                    onRecolor={(id, color) =>
                      setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, color } : entry)))
                    }
                    onRemove={deleteEntry}
                    onNoteFor={noteFor}
                  />
                )}
              </motion.main>
            </AnimatePresence>

            {/* Floating surfaces: they never change the page beneath them. */}
            <AnimatePresence>
              {sidebarFloating && wide && (
                <motion.aside
                  key="floating-sidebar"
                  aria-label="App sidebar"
                  className={cn("absolute top-3 bottom-3 left-3 z-30 overflow-hidden", FLOATING_SURFACE)}
                  style={{ width: SIDEBAR_WIDTH + 16 }}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0, transition: MOTION.enter }}
                  exit={{ opacity: 0, x: -8, transition: MOTION.exit }}
                >
                  {sidebar}
                </motion.aside>
              )}
              {panelOpen && panelBody && wide && (
                <motion.aside
                  key="panel"
                  aria-label="Reader panel"
                  className={cn("absolute top-3 right-3 bottom-3 z-30 overflow-hidden", FLOATING_SURFACE)}
                  style={{ width: PANEL_WIDTH }}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0, transition: MOTION.enter }}
                  exit={{ opacity: 0, x: 8, transition: MOTION.exit }}
                >
                  {panelBody}
                </motion.aside>
              )}
            </AnimatePresence>

            {!wide && (
              <AnimatePresence>
                {(sidebarFloating || panelOpen) && (
                  <motion.button
                    key="scrim"
                    type="button"
                    aria-label="Close"
                    className="absolute inset-0 z-30 cursor-default bg-black/20"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: MOTION.enter }}
                    exit={{ opacity: 0, transition: MOTION.exit }}
                    onClick={() => {
                      setFloatingSidebar(false);
                      openPanel(null);
                    }}
                  />
                )}
                {sidebarFloating && (
                  <motion.aside
                    key="drawer"
                    aria-label="App sidebar"
                    className="absolute inset-y-0 left-0 z-40 bg-sidebar shadow-[0_0_40px_-12px_rgb(0_0_0/0.35)]"
                    style={{ width: Math.min(SIDEBAR_WIDTH + 32, width - 56) }}
                    initial={{ x: "-100%" }}
                    animate={{ x: 0, transition: MOTION.screen }}
                    exit={{ x: "-100%", transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
                  >
                    {sidebar}
                  </motion.aside>
                )}
                {panelOpen && panelBody && (
                  <motion.aside
                    key="sheet"
                    aria-label="Reader panel"
                    className="absolute inset-x-0 bottom-0 z-40 h-[76%] overflow-hidden rounded-t-[18px] bg-background shadow-[0_-16px_40px_-16px_rgb(0_0_0/0.3)]"
                    initial={{ y: "100%" }}
                    animate={{ y: 0, transition: MOTION.screen }}
                    exit={{ y: "100%", transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
                  >
                    <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-foreground/15" />
                    <div className="h-[calc(100%-12px)]">{panelBody}</div>
                  </motion.aside>
                )}
              </AnimatePresence>
            )}

            <AnimatePresence>
              {paletteOpen && (
                <CommandPalette
                  key="palette"
                  books={shelf}
                  entries={entries}
                  onOpenBook={openBookById}
                  onOpenEntry={openEntry}
                  onLibrary={() => navigate({ kind: "library" })}
                  onHighlights={() => navigate({ kind: "highlights" })}
                  onToggleTheme={toggleTheme}
                  onClose={() => {
                    setPaletteOpen(false);
                    focusRef.current?.focus({ preventScroll: true });
                  }}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
