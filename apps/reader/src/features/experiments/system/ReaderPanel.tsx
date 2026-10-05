/**
 * The reader's one panel. It floats over the page, so the text never moves.
 * Three tabs in words: Contents to move through the book, Notes to keep
 * what matters, Appearance to adjust the page. Search sits behind one icon
 * and replaces the tabs while you use it.
 */
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Bookmark, Check, ChevronDown, Minus, Plus, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StudioInk } from "../data/sample-library";
import {
  BOOK_TYPOGRAPHY,
  chapterOfPage,
  type BookLayout,
  type BookModel,
  type BookTypography,
} from "../data/walden-book";
import { inkColor } from "../primitives";
import { EntryRow } from "./EntryRow";
import {
  formatMinutesLeft,
  IconButton,
  MenuItem,
  MenuSeparator,
  MOTION,
  Popover,
  TextButton,
  TextTabs,
} from "./ui";
import { entryPage, minutesForPages, type Entry } from "./state";

export type PanelTab = "contents" | "notes" | "appearance";

export type SystemTheme = "light" | "flexoki-light" | "dark" | "flexoki-dark" | "night";

export const THEMES: { value: SystemTheme; label: string }[] = [
  { value: "light", label: "White" },
  { value: "flexoki-light", label: "Paper" },
  { value: "flexoki-dark", label: "Dusk" },
  { value: "dark", label: "Dark" },
  { value: "night", label: "Night" },
];

const TYPEFACES = [
  { label: "Garamond", family: '"EB Garamond", "Garamond", serif' },
  { label: "Lora", family: '"Lora", Georgia, serif' },
  { label: "Iowan", family: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { label: "Inter", family: '"Inter", system-ui, sans-serif' },
];

const SPACING = [
  { value: "1.35", label: "Tight" },
  { value: "1.5", label: "Normal" },
  { value: "1.7", label: "Loose" },
] as const;

const MARGINS = [
  { value: "0.08", label: "Narrow" },
  { value: "0.12", label: "Normal" },
  { value: "0.16", label: "Wide" },
] as const;

const INKS: StudioInk[] = ["yellow", "green", "blue", "magenta"];

export interface PanelProps {
  model: BookModel;
  layout: BookLayout;
  page: number;
  entries: Entry[];
  bookmarks: number[];
  typography: BookTypography;
  theme: SystemTheme;
  spread: boolean;
  showFolio: boolean;
  tab: PanelTab;
  searching: boolean;
  query: string;
  composerFocusKey: number;
  attachId: string | null;
  activeEntryId: string | null;
  onTab: (tab: PanelTab) => void;
  onSearching: (searching: boolean) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
  onGo: (page: number, entryId?: string) => void;
  onHover: (id: string | null) => void;
  onTypography: (typography: BookTypography) => void;
  onTheme: (theme: SystemTheme) => void;
  onSpread: (spread: boolean) => void;
  onShowFolio: (show: boolean) => void;
  onAddNote: (note: string, attachId: string | null) => void;
  onAttach: (id: string | null) => void;
  onSaveNote: (id: string, note: string | null) => void;
  onDelete: (id: string) => void;
  onToggleBookmark: (page: number) => void;
}

export function ReaderPanel(props: PanelProps) {
  const { tab, searching, query, onTab, onClose, onSearching, onQuery, model } = props;
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) searchRef.current?.focus({ preventScroll: true });
  }, [searching]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        {searching ? (
          <>
            <Search className="size-[14px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onSearching(false);
                }
              }}
              placeholder={`Search in ${model.title}`}
              aria-label={`Search in ${model.title}`}
              className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            <TextButton onClick={() => onSearching(false)}>Cancel</TextButton>
          </>
        ) : (
          <>
            <TextTabs
              label="Panel"
              value={tab}
              onChange={onTab}
              className="flex-1"
              options={[
                { value: "contents", label: "Contents" },
                { value: "notes", label: "Notes" },
                { value: "appearance", label: "Appearance" },
              ]}
            />
            {tab !== "appearance" && (
              <IconButton label="Search in book (/)" onClick={() => onSearching(true)}>
                <Search className="size-[14px]" strokeWidth={1.8} />
              </IconButton>
            )}
            <IconButton label="Close (Esc)" onClick={onClose}>
              <X className="size-[15px]" strokeWidth={1.7} />
            </IconButton>
          </>
        )}
      </div>

      <motion.div
        key={searching ? "search" : tab}
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: MOTION.fast }}
      >
        {searching ? (
          <SearchResults {...props} />
        ) : tab === "contents" ? (
          <ContentsTab {...props} />
        ) : tab === "notes" ? (
          <NotesTab {...props} />
        ) : (
          <AppearanceTab {...props} />
        )}
      </motion.div>
    </div>
  );
}

/** Scrolls a list to an item without moving anything around the prototype. */
function revealIn(container: HTMLElement | null, item: HTMLElement | null, onlyIfHidden = false) {
  if (!container || !item) return;
  const box = container.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (onlyIfHidden && rect.top >= box.top && rect.bottom <= box.bottom) return;
  const offset = rect.top - box.top + container.scrollTop;
  container.scrollTop = Math.max(0, offset - (box.height - rect.height) / 2);
}

function Scroll({
  children,
  className,
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn("xp-scroll-quiet relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4", className)}
    >
      {children}
    </div>
  );
}

function ContentsTab({ model, page, bookmarks, onGo, onToggleBookmark }: PanelProps) {
  const currentRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = chapterOfPage(page, model);
  const progress = page / model.pages;

  useLayoutEffect(() => {
    revealIn(scrollRef.current, currentRef.current);
  }, []);

  return (
    <>
      <p className="shrink-0 px-4 pb-2 font-numeric text-[12px] text-muted-foreground tabular-nums">
        {Math.round(progress * 100)}% read · {formatMinutesLeft(minutesForPages(model.pages - page))} left
      </p>
      <Scroll scrollRef={scrollRef}>
        <ol>
          {model.chapters.map((chapter) => {
            const here = chapter.index === current;
            return (
              <li key={chapter.index}>
                <button
                  ref={here ? currentRef : undefined}
                  type="button"
                  onClick={() => onGo(chapter.page)}
                  aria-current={here ? "location" : undefined}
                  className={cn(
                    "grid h-[34px] w-full cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                    here ? "bg-foreground/[0.045] font-medium text-foreground" : "text-foreground/75 hover:bg-foreground/[0.025] hover:text-foreground",
                  )}
                >
                  <span className="text-right font-numeric text-[11px] font-normal text-muted-foreground/70 tabular-nums">
                    {chapter.numeral}
                  </span>
                  <span className="truncate">{chapter.title}</span>
                  <span className="font-numeric text-[11.5px] font-normal text-muted-foreground tabular-nums">{chapter.page}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {bookmarks.length > 0 && (
          <section aria-label="Bookmarks" className="mt-5">
            <h4 className="px-2 pb-1 text-[11.5px] text-muted-foreground">Bookmarks</h4>
            <ul>
              {[...bookmarks].sort((a, b) => a - b).map((bookmark) => (
                <li key={bookmark} className="group relative">
                  <button
                    type="button"
                    onClick={() => onGo(bookmark)}
                    className="grid h-[34px] w-full cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-foreground/75 outline-none transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Bookmark className="size-3 justify-self-end text-muted-foreground" fill="currentColor" strokeWidth={1.5} />
                    <span className="truncate">{model.chapters[chapterOfPage(bookmark, model)].title}</span>
                    <span className="font-numeric text-[11.5px] text-muted-foreground tabular-nums group-hover:opacity-0">{bookmark}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove bookmark on page ${bookmark}`}
                    onClick={() => onToggleBookmark(bookmark)}
                    className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Scroll>
    </>
  );
}

type NotesFilter = "all" | "highlight" | "note" | StudioInk;

const FILTER_LABEL: Record<NotesFilter, string> = {
  all: "All notes",
  highlight: "Highlights",
  note: "Your notes",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  magenta: "Magenta",
};

function NotesTab(props: PanelProps) {
  const { model, layout, entries, page, activeEntryId, onGo, onHover, onSaveNote, onDelete } = props;
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = entries
    .filter((entry) =>
      filter === "all" ? true : filter === "highlight" || filter === "note" ? entry.kind === filter : entry.color === filter,
    )
    .map((entry) => ({ entry, page: entryPage(entry, layout, model) }))
    .sort((a, b) => a.page - b.page);
  const groups = model.chapters
    .map((chapter) => ({ chapter, items: filtered.filter((item) => chapterOfPage(item.page, model) === chapter.index) }))
    .filter((group) => group.items.length > 0);

  // Open at the passage just made, or at the chapter being read. Later, only
  // scroll when a new passage would otherwise be out of sight.
  const positioned = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (activeEntryId) {
      revealIn(list, list.querySelector<HTMLElement>(`[data-entry="${activeEntryId}"]`), positioned.current);
      positioned.current = true;
      return;
    }
    if (positioned.current) return;
    positioned.current = true;
    const current = chapterOfPage(page, model);
    const section =
      list.querySelector<HTMLElement>(`[data-chapter="${current}"]`) ??
      [...list.querySelectorAll<HTMLElement>("[data-chapter]")].find((node) => Number(node.dataset.chapter) > current);
    if (section) list.scrollTop = section.offsetTop;
  }, [activeEntryId, model, page]);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-2 pb-1">
        <div className="relative">
          <TextButton onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} className="text-[12.5px]">
            {filter !== "all" && filter !== "highlight" && filter !== "note" && (
              <span className="size-2 rounded-full" style={{ background: inkColor(filter) }} />
            )}
            {FILTER_LABEL[filter]}
            <ChevronDown className="size-3" strokeWidth={2} />
          </TextButton>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="start" className="w-44">
            {(["all", "highlight", "note"] as NotesFilter[]).map((option) => (
              <MenuItem
                key={option}
                checked={filter === option}
                onSelect={() => {
                  setFilter(option);
                  setMenuOpen(false);
                }}
              >
                {FILTER_LABEL[option]}
              </MenuItem>
            ))}
            <MenuSeparator />
            {INKS.map((ink) => (
              <MenuItem
                key={ink}
                checked={filter === ink}
                onSelect={() => {
                  setFilter(ink);
                  setMenuOpen(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: inkColor(ink) }} />
                  {FILTER_LABEL[ink]}
                </span>
              </MenuItem>
            ))}
          </Popover>
        </div>
        <span className="pr-2 font-numeric text-[12px] text-muted-foreground tabular-nums">{filtered.length}</span>
      </div>

      <Scroll scrollRef={listRef}>
        {groups.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] leading-relaxed text-muted-foreground">
            {entries.length === 0
              ? "Select words on the page to highlight them, or write a note below."
              : "Nothing matches this filter."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.chapter.index} data-chapter={group.chapter.index} className="pb-2">
              <h4 className="truncate px-3 pt-3 pb-1 text-[11.5px] text-muted-foreground">{group.chapter.title}</h4>
              {group.items.map(({ entry, page: entryPageNumber }) => (
                <motion.div
                  key={entry.id}
                  data-entry={entry.id}
                  initial={entry.daysAgo === 0 ? { opacity: 0 } : false}
                  animate={{ opacity: 1, transition: MOTION.enter }}
                >
                  <EntryRow
                    entry={entry}
                    page={entryPageNumber}
                    active={entry.id === activeEntryId}
                    onOpen={() => onGo(entryPageNumber, entry.id)}
                    onHover={onHover}
                    onSaveNote={(note) => onSaveNote(entry.id, note)}
                    onDelete={() => onDelete(entry.id)}
                  />
                </motion.div>
              ))}
            </section>
          ))
        )}
      </Scroll>

      <Composer {...props} />
    </>
  );
}

function Composer({ page, entries, attachId, composerFocusKey, onAddNote, onAttach }: PanelProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const focusKeySeen = useRef(composerFocusKey);
  const attached = entries.find((entry) => entry.id === attachId) ?? null;

  // Focus on request only, not each time the tab mounts.
  useEffect(() => {
    if (composerFocusKey === focusKeySeen.current) return;
    focusKeySeen.current = composerFocusKey;
    ref.current?.focus({ preventScroll: true });
  }, [composerFocusKey]);

  const submit = () => {
    const note = value.trim();
    if (!note) return;
    onAddNote(note, attachId);
    setValue("");
  };

  return (
    <div className="shrink-0 border-t border-foreground/[0.06] px-4 pt-3 pb-3.5">
      {attached?.text && (
        <div className="mb-2 flex items-start gap-2.5">
          <span
            className="mt-[5px] w-[2px] shrink-0 self-stretch rounded-full"
            style={{ background: attached.color ? `var(--${attached.color}-secondary)` : undefined }}
          />
          <p className="xp-serif line-clamp-2 flex-1 text-[13.5px] leading-snug text-muted-foreground">{attached.text}</p>
          <button
            type="button"
            aria-label="Detach the passage"
            onClick={() => onAttach(null)}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={attached ? "Add a note to this passage" : `Add a note on page ${page}`}
          aria-label="Write a note"
          className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[13px] leading-[1.5] outline-none placeholder:text-muted-foreground [field-sizing:content]"
        />
        <span
          aria-hidden="true"
          className={cn("pb-0.5 text-[11px] text-muted-foreground transition-opacity duration-150", value.trim() ? "opacity-100" : "opacity-0")}
        >
          ↵ to save
        </span>
      </div>
    </div>
  );
}

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-4", className)}>
      <span className="text-[13px] text-foreground/85">{label}</span>
      {children}
    </div>
  );
}

function AppearanceTab({
  typography,
  theme,
  spread,
  showFolio,
  onTypography,
  onTheme,
  onSpread,
  onShowFolio,
}: PanelProps) {
  const update = (patch: Partial<BookTypography>) => onTypography({ ...typography, ...patch });
  const nearest = <T extends { value: string }>(options: readonly T[], target: number) =>
    options.reduce((best, option) =>
      Math.abs(Number(option.value) - target) < Math.abs(Number(best.value) - target) ? option : best,
    ).value;
  const themeLabel = THEMES.find((option) => option.value === theme)?.label;

  return (
    <Scroll className="px-4">
      <Row label="Theme">
        <span className="text-[12.5px] text-muted-foreground">{themeLabel}</span>
      </Row>
      <div role="radiogroup" aria-label="Theme" className="flex gap-3 pb-3">
        {THEMES.map((option) => {
          const active = option.value === theme;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              title={option.label}
              onClick={() => onTheme(option.value)}
              className={cn(
                option.value,
                "grid size-8 cursor-pointer place-items-center rounded-full border border-foreground/15 bg-background text-foreground outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                active && "ring-[1.5px] ring-foreground ring-offset-2 ring-offset-background",
              )}
            >
              <span className="xp-serif text-[12px] leading-none">Aa</span>
            </button>
          );
        })}
      </div>

      <div className="h-px bg-foreground/[0.06]" />

      <div role="radiogroup" aria-label="Typeface" className="py-2">
        {TYPEFACES.map((face) => {
          const active = face.family === typography.fontFamily;
          return (
            <button
              key={face.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => update({ fontFamily: face.family })}
              className={cn(
                "-mx-2 flex h-9 w-[calc(100%+1rem)] cursor-pointer items-center justify-between rounded-md px-2 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring",
                active ? "text-foreground" : "text-foreground/70",
              )}
            >
              <span className="text-[16px]" style={{ fontFamily: face.family }}>
                {face.label}
              </span>
              {active && <Check className="size-3.5" strokeWidth={2} />}
            </button>
          );
        })}
      </div>

      <div className="h-px bg-foreground/[0.06]" />

      <div className="py-1.5">
        <Row label="Size">
          <div className="flex items-center gap-1">
            <IconButton label="Smaller text" disabled={typography.fontSize <= 14} onClick={() => update({ fontSize: typography.fontSize - 1 })}>
              <Minus className="size-3.5" />
            </IconButton>
            <span className="w-7 text-center font-numeric text-[13px] tabular-nums">{typography.fontSize}</span>
            <IconButton label="Larger text" disabled={typography.fontSize >= 26} onClick={() => update({ fontSize: typography.fontSize + 1 })}>
              <Plus className="size-3.5" />
            </IconButton>
          </div>
        </Row>
        <Row label="Line spacing">
          <TextTabs
            label="Line spacing"
            size="sm"
            value={nearest(SPACING, typography.lineHeight)}
            onChange={(value) => update({ lineHeight: Number(value) })}
            options={SPACING.map((option) => ({ value: option.value, label: option.label }))}
          />
        </Row>
        <Row label="Margins">
          <TextTabs
            label="Margins"
            size="sm"
            value={nearest(MARGINS, typography.margin)}
            onChange={(value) => update({ margin: Number(value) })}
            options={MARGINS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </Row>
      </div>

      <div className="h-px bg-foreground/[0.06]" />

      <div className="py-1.5">
        <ToggleRow label="Justify" checked={typography.justify} onChange={(justify) => update({ justify })} />
        <ToggleRow label="Two pages on wide windows" checked={spread} onChange={onSpread} />
        <ToggleRow label="Page numbers" checked={showFolio} onChange={onShowFolio} />
      </div>

      <button
        type="button"
        onClick={() => onTypography(BOOK_TYPOGRAPHY)}
        className="mt-2 cursor-pointer text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Reset text
      </button>
    </Scroll>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3">
      <span className="text-[13px] text-foreground/85">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="h-[18px] w-8 [&>span]:size-[14px] [&>span]:data-[checked]:translate-x-[14px]"
      />
    </label>
  );
}

interface TextMatch {
  paragraph: number;
  index: number;
  page: number;
}

function SearchResults({ model, layout, entries, query, onGo, onHover, onSaveNote, onDelete }: PanelProps) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return (
      <p className="px-6 py-12 text-center text-[13px] leading-relaxed text-muted-foreground">
        Search the text, the chapters and your notes.
      </p>
    );
  }
  const matches: TextMatch[] = [];
  model.text.paragraphs.forEach((paragraph, index) => {
    const lower = paragraph.toLowerCase();
    let from = lower.indexOf(needle);
    while (from >= 0 && matches.length < 40) {
      matches.push({ paragraph: index, index: from, page: layout.paragraphPages[index] ?? model.textStart });
      from = lower.indexOf(needle, from + needle.length);
    }
  });
  const chapters = model.chapters.filter((chapter) => chapter.title.toLowerCase().includes(needle));
  const notes = entries.filter(
    (entry) => entry.text?.toLowerCase().includes(needle) || entry.note?.toLowerCase().includes(needle),
  );

  if (matches.length === 0 && chapters.length === 0 && notes.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-[13px] leading-relaxed text-muted-foreground">
        Nothing matches “{query.trim()}”. The sample has text for chapter {model.chapters[model.textChapter].numeral} only.
      </p>
    );
  }

  return (
    <Scroll>
      {chapters.length > 0 && (
        <ResultGroup label="Chapters">
          {chapters.map((chapter) => (
            <button
              key={chapter.index}
              type="button"
              onClick={() => onGo(chapter.page)}
              className="grid h-[34px] w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-3 text-left text-[13.5px] text-foreground/80 outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">
                <Highlight text={chapter.title} needle={needle} />
              </span>
              <span className="font-numeric text-[11.5px] text-muted-foreground tabular-nums">{chapter.page}</span>
            </button>
          ))}
        </ResultGroup>
      )}
      {matches.length > 0 && (
        <ResultGroup label={`In the text · ${matches.length}`}>
          {matches.map((match) => {
            const paragraph = model.text.paragraphs[match.paragraph];
            const start = Math.max(0, match.index - 48);
            const end = Math.min(paragraph.length, match.index + needle.length + 72);
            return (
              <button
                key={`${match.paragraph}-${match.index}`}
                type="button"
                onClick={() => onGo(match.page)}
                className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="xp-serif line-clamp-3 text-[14.5px] leading-[1.45] text-foreground/80">
                  {start > 0 && "…"}
                  <Highlight text={paragraph.slice(start, end)} needle={needle} />
                  {end < paragraph.length && "…"}
                </span>
                <span className="mt-0.5 block font-numeric text-[11px] text-muted-foreground tabular-nums">p. {match.page}</span>
              </button>
            );
          })}
        </ResultGroup>
      )}
      {notes.length > 0 && (
        <ResultGroup label="Your notes">
          {notes.map((entry) => {
            const page = entryPage(entry, layout, model);
            return (
              <EntryRow
                key={entry.id}
                entry={entry}
                page={page}
                onOpen={() => onGo(page, entry.id)}
                onHover={onHover}
                onSaveNote={(note) => onSaveNote(entry.id, note)}
                onDelete={() => onDelete(entry.id)}
              />
            );
          })}
        </ResultGroup>
      )}
    </Scroll>
  );
}

function ResultGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pb-2">
      <h4 className="px-3 pt-3 pb-1 text-[11.5px] text-muted-foreground">{label}</h4>
      {children}
    </section>
  );
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    parts.push(text.slice(cursor, index));
    parts.push(
      <span key={index} className="text-foreground underline decoration-foreground/40 underline-offset-[3px]">
        {text.slice(index, index + needle.length)}
      </span>,
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
