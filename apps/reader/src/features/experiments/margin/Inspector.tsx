/**
 * Inspector: one quiet panel for contents, notes and appearance.
 *
 * Tabs have labels, not only icons, and panels slide in the direction of the
 * tab that was chosen. Appearance changes apply to the page behind the panel
 * as you make them, so the page itself is the preview.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Copy, PanelRight, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { StudioInk } from "../data/sample-library";
import { StageSurface, inkColor, useElementSize } from "../primitives";
import { QUIET_EASE, QUIET_SPRING, relativeDay } from "../quiet";
import {
  DEFAULT_TYPOGRAPHY,
  ReaderPage,
  WALDEN_OUTLINE,
  chapterEndPage,
  chapterForPage,
  useWaldenHighlights,
  type MockTypography,
} from "./reader-mock";

type Tab = "contents" | "notes" | "appearance";

const TABS: { value: Tab; label: string }[] = [
  { value: "contents", label: "Contents" },
  { value: "notes", label: "Notes" },
  { value: "appearance", label: "Appearance" },
];

const THEMES = [
  { value: "light", label: "Light" },
  { value: "flexoki-light", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "flexoki-dark", label: "Ink" },
  { value: "night", label: "Night" },
] as const;

const FONTS = [
  { label: "Garamond", stack: '"EB Garamond", "Garamond", serif' },
  { label: "Lora", stack: '"Lora", serif' },
  { label: "Iowan", stack: '"Iowan Old Style", "Sitka Text", Palatino, serif' },
  { label: "Inter", stack: '"Inter", sans-serif' },
] as const;

const SIZES = [15, 16, 17, 18, 19, 20, 22, 24, 26];
const SPACING = [
  { label: "Compact", value: 1.4 },
  { label: "Normal", value: 1.55 },
  { label: "Relaxed", value: 1.75 },
];
const MARGINS = [
  { label: "Narrow", value: 0.06 },
  { label: "Normal", value: 0.1 },
  { label: "Wide", value: 0.16 },
];
const INKS: StudioInk[] = ["yellow", "green", "blue", "magenta"];

function Section({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="py-3.5">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h5 className="text-[11px] font-medium text-muted-foreground">{label}</h5>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({
  id,
  options,
  value,
  onChange,
  render,
}: {
  id: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  render?: (option: { label: string; value: T }, active: boolean) => ReactNode;
}) {
  return (
    <div className="grid rounded-xl bg-muted/60 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex h-9 cursor-pointer items-center justify-center rounded-[10px] text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <motion.span layoutId={`inspector-seg-${id}`} transition={QUIET_SPRING} className="absolute inset-0 rounded-[10px] bg-background shadow-sm ring-1 ring-border/50" />}
            <span className="relative">{render ? render(option, active) : option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Three short lines whose gap shows the line spacing. */
function SpacingGlyph({ gap }: { gap: number }) {
  return (
    <span className="flex w-4 flex-col" style={{ gap }} aria-hidden="true">
      {[0, 1, 2].map((line) => (
        <span key={line} className="h-px w-full bg-current" />
      ))}
    </span>
  );
}

function MarginGlyph({ inset }: { inset: number }) {
  return (
    <span className="relative block h-4 w-3.5 rounded-[2px] border border-current" aria-hidden="true">
      <span className="absolute inset-y-[3px] flex flex-col justify-between" style={{ left: inset, right: inset }}>
        {[0, 1, 2].map((line) => (
          <span key={line} className="h-px bg-current" />
        ))}
      </span>
    </span>
  );
}

function ContentsPanel({ page, onGo }: { page: number; onGo: (page: number) => void }) {
  const [query, setQuery] = useState("");
  const current = chapterForPage(page);
  const needle = query.trim().toLowerCase();
  const pageNumber = /^\d+$/.test(needle) ? Number(needle) : null;
  const chapters = WALDEN_OUTLINE.map((chapter, index) => ({ chapter, index })).filter(
    ({ chapter }) => !needle || pageNumber !== null || chapter.title.toLowerCase().includes(needle),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-1 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-xl bg-muted/60 px-3 text-[13px] transition-colors focus-within:bg-muted">
          <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && pageNumber !== null) onGo(Math.min(336, Math.max(1, pageNumber)));
            }}
            placeholder="Chapter or page number"
            aria-label="Find a chapter or go to a page"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
        <AnimatePresence initial={false}>
          {pageNumber !== null && (
            <motion.button
              type="button"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: QUIET_EASE }}
              onClick={() => onGo(Math.min(336, Math.max(1, pageNumber)))}
              className="mt-1.5 flex w-full cursor-pointer items-center justify-between overflow-hidden rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/60"
            >
              Go to page {pageNumber}
              <span className="text-[11px] text-muted-foreground">↵</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <ol className="xp-scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {chapters.map(({ chapter, index }) => {
          const isCurrent = index === current;
          const end = chapterEndPage(index);
          const within = isCurrent ? (page - chapter.page + 1) / (end - chapter.page + 1) : 0;
          return (
            <li key={chapter.number}>
              <button
                type="button"
                aria-current={isCurrent ? "location" : undefined}
                onClick={() => onGo(chapter.page)}
                className={cn(
                  "relative flex w-full cursor-pointer items-baseline gap-3 overflow-hidden rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  !isCurrent && "hover:bg-muted/50",
                )}
              >
                {isCurrent && (
                  <motion.span layoutId="inspector-current" transition={QUIET_SPRING} className="absolute inset-0 overflow-hidden rounded-xl bg-muted/70">
                    {/* How far into this chapter the reader is. */}
                    <motion.span
                      className="absolute inset-y-0 left-0 bg-foreground/[0.05]"
                      initial={false}
                      animate={{ width: `${within * 100}%` }}
                      transition={{ duration: 0.5, ease: QUIET_EASE }}
                    />
                  </motion.span>
                )}
                <span className={cn("relative min-w-0 flex-1 text-[13.5px] leading-snug", isCurrent ? "font-medium" : "text-foreground/85")}>
                  {chapter.title}
                </span>
                <span className="relative text-xs text-muted-foreground tabular-nums">{chapter.page}</span>
              </button>
            </li>
          );
        })}
        {chapters.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No chapter matches.</li>}
      </ol>
    </div>
  );
}

function NotesPanel({ onGo }: { onGo: (page: number) => void }) {
  const highlights = useWaldenHighlights();
  const [colors, setColors] = useState<Set<StudioInk>>(new Set());
  const [order, setOrder] = useState<"book" | "recent">("book");
  const [copied, setCopied] = useState<string | null>(null);

  const visible = useMemo(() => {
    const filtered = highlights.filter((highlight) => colors.size === 0 || colors.has(highlight.color));
    return order === "book"
      ? [...filtered].sort((a, b) => a.locator - b.locator)
      : [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [colors, highlights, order]);

  let previousChapter = -1;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-4 pt-1 pb-3">
        <button
          type="button"
          aria-pressed={colors.size === 0}
          onClick={() => setColors(new Set())}
          className={cn(
            "h-7 cursor-pointer rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            colors.size === 0 ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {INKS.map((ink) => {
          const active = colors.has(ink);
          return (
            <button
              key={ink}
              type="button"
              aria-pressed={active}
              aria-label={`${ink} highlights`}
              onClick={() =>
                setColors((current) => {
                  const next = new Set(current);
                  if (next.has(ink)) next.delete(ink);
                  else next.add(ink);
                  return next;
                })
              }
              className="grid size-7 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <motion.span
                className="block size-3 rounded-full"
                style={{ background: inkColor(ink) }}
                animate={{ scale: active ? 1.15 : 1, boxShadow: active ? "0 0 0 2px var(--background), 0 0 0 3.5px var(--foreground)" : "0 0 0 0px transparent" }}
                transition={QUIET_SPRING}
              />
            </button>
          );
        })}
        <div className="ml-auto flex text-xs">
          {(["book", "recent"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={order === option}
              onClick={() => setOrder(option)}
              className={cn("cursor-pointer rounded-md px-2 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", order === option ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {option === "book" ? "In order" : "Recent"}
            </button>
          ))}
        </div>
      </div>

      <div className="xp-scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((highlight) => {
            const chapter = chapterForPage(highlight.locator);
            const showChapter = order === "book" && chapter !== previousChapter;
            previousChapter = chapter;
            return (
              <motion.article
                key={highlight.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={QUIET_SPRING}
              >
                {showChapter && (
                  <p className="px-3 pt-4 pb-1.5 text-[11px] font-medium text-muted-foreground first:pt-1">{WALDEN_OUTLINE[chapter].title}</p>
                )}
                <div className="group relative rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50">
                  <blockquote className="xp-serif border-l-2 pl-3 text-[15px] leading-snug" style={{ borderColor: inkColor(highlight.color) }}>
                    {highlight.text}
                  </blockquote>
                  {highlight.note && <p className="mt-1.5 pl-3.5 text-[13px] leading-snug text-foreground/75">{highlight.note}</p>}
                  <div className="mt-1.5 flex items-center pl-3.5 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">p. {highlight.locator}</span>
                    <span className="mx-1.5 opacity-40">·</span>
                    <span>{relativeDay(highlight.createdAt)}</span>
                    <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label="Copy highlight"
                        onClick={() => {
                          void navigator.clipboard?.writeText(highlight.text);
                          setCopied(highlight.id);
                          window.setTimeout(() => setCopied((current) => (current === highlight.id ? null : current)), 1200);
                        }}
                        className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-background hover:text-foreground"
                      >
                        {copied === highlight.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Go to highlight"
                        onClick={() => onGo(highlight.locator)}
                        className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-background hover:text-foreground"
                      >
                        <ArrowUpRight className="size-3" />
                      </button>
                    </span>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
        {visible.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted-foreground">No highlights in these colours.</p>}
      </div>
    </div>
  );
}

function AppearancePanel({
  theme,
  onTheme,
  typography,
  onTypography,
}: {
  theme: string;
  onTheme: (theme: string) => void;
  typography: MockTypography;
  onTypography: (update: Partial<MockTypography>) => void;
}) {
  const sizeIndex = Math.max(0, SIZES.indexOf(typography.fontSize));
  return (
    <div className="xp-scroll-quiet h-full divide-y divide-border/60 overflow-y-auto px-4 pb-6">
      <Section label="Theme">
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((option) => {
            const active = option.value === theme;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onTheme(option.value)}
                className="group flex cursor-pointer flex-col items-center gap-1.5 outline-none"
              >
                {/* The ring sits on an unthemed wrapper so its colours follow the panel. */}
                <span
                  className={cn(
                    "block w-full rounded-[10px] p-[3px] ring-1 transition-shadow duration-200 group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    active ? "ring-2 ring-foreground" : "ring-transparent",
                  )}
                >
                  <span className={cn(option.value, "grid aspect-[4/5] w-full place-items-center rounded-[7px] bg-background text-foreground ring-1 ring-black/10")}>
                    <span className="xp-serif text-lg leading-none">Aa</span>
                  </span>
                </span>
                <span className={cn("text-[11px]", active ? "text-foreground" : "text-muted-foreground")}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Typeface">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Typeface">
          {FONTS.map((font) => {
            const active = typography.fontFamily === font.stack;
            return (
              <button
                key={font.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onTypography({ fontFamily: font.stack })}
                className={cn(
                  "relative flex h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span className="text-xl leading-none" style={{ fontFamily: font.stack }}>
                  Aa
                </span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{font.label}</span>
                <AnimatePresence>
                  {active && (
                    <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
                      <Check className="size-3.5" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Size" aside={<span className="text-[11px] text-muted-foreground tabular-nums">{typography.fontSize} px</span>}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={sizeIndex === 0}
            onClick={() => onTypography({ fontSize: SIZES[Math.max(0, sizeIndex - 1)] })}
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            A
          </button>
          <div className="relative flex h-8 flex-1 items-center justify-between px-1" role="radiogroup" aria-label="Text size">
            <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-border" />
            {SIZES.map((size, index) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={index === sizeIndex}
                aria-label={`${size} pixels`}
                onClick={() => onTypography({ fontSize: size })}
                className="relative grid size-4 cursor-pointer place-items-center outline-none"
              >
                <span className="size-1 rounded-full bg-foreground/30" />
                {index === sizeIndex && (
                  <motion.span layoutId="inspector-size-knob" transition={QUIET_SPRING} className="absolute size-3.5 rounded-full bg-foreground shadow" />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Larger text"
            disabled={sizeIndex === SIZES.length - 1}
            onClick={() => onTypography({ fontSize: SIZES[Math.min(SIZES.length - 1, sizeIndex + 1)] })}
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-base text-muted-foreground outline-none hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            A
          </button>
        </div>
      </Section>

      <Section label="Line spacing">
        <Segmented
          id="spacing"
          options={SPACING}
          value={typography.lineHeight}
          onChange={(value) => onTypography({ lineHeight: value })}
          render={(option) => <SpacingGlyph gap={option.value === 1.4 ? 2 : option.value === 1.55 ? 3.5 : 5} />}
        />
      </Section>

      <Section label="Margins">
        <Segmented
          id="margins"
          options={MARGINS}
          value={typography.margin}
          onChange={(value) => onTypography({ margin: value })}
          render={(option) => <MarginGlyph inset={option.value === 0.06 ? 1.5 : option.value === 0.1 ? 3 : 4.5} />}
        />
      </Section>

      <Section label="Alignment">
        <Segmented
          id="align"
          options={[
            { label: "Left", value: "left" },
            { label: "Justified", value: "justify" },
          ]}
          value={typography.justify ? "justify" : "left"}
          onChange={(value) => onTypography({ justify: value === "justify" })}
        />
      </Section>
    </div>
  );
}

export function Inspector() {
  const reducedMotion = useReducedMotion() ?? false;
  const highlights = useWaldenHighlights();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("contents");
  const [direction, setDirection] = useState(1);
  const [page, setPage] = useState(90);
  const [theme, setTheme] = useState<string>("");
  const [typography, setTypography] = useState<MockTypography>(DEFAULT_TYPOGRAPHY);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const wide = size.width >= 760;

  const chooseTab = (next: Tab) => {
    setDirection(TABS.findIndex((item) => item.value === next) >= TABS.findIndex((item) => item.value === tab) ? 1 : -1);
    setTab(next);
  };

  return (
    // The chosen theme scopes the whole stage, as the Reader themes its panels too.
    <StageSurface tone="inherit" className={cn("relative size-full overflow-hidden", theme)}>
      <div ref={sizeRef} className="absolute inset-0">
        {/* Page shifts left to keep the text clear of the open panel. */}
        <motion.div
          className="absolute inset-y-0 w-[min(38rem,calc(100%-2rem))]"
          initial={false}
          animate={{ left: open && wide ? "calc((100% - 23rem) / 2)" : "50%", x: "-50%" }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.35, ease: QUIET_EASE }}
        >
          <ReaderPage
            page={page}
            typography={typography}
            highlightTexts={highlights.filter((highlight) => highlight.locator >= 81 && highlight.locator < 99)}
          />
        </motion.div>

        <AnimatePresence>
          {!open && (
            <motion.button
              type="button"
              aria-label="Open reader panel"
              onClick={() => setOpen(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute top-4 right-4 grid size-9 cursor-pointer place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelRight className="size-4" />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {open && (
            <motion.aside
              aria-label="Reader panel"
              className="absolute inset-y-3 right-3 z-10 flex w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-[1.4rem] border bg-popover/95 text-popover-foreground shadow-[0_24px_60px_-28px_rgba(0,0,0,0.4)] backdrop-blur-xl"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, transition: { duration: 0.14 } }}
              transition={{ duration: 0.24, ease: QUIET_EASE }}
            >
              <div className="flex items-center gap-2 p-2.5">
                <div className="relative grid flex-1 grid-cols-3 rounded-xl bg-muted/60 p-0.5" role="tablist" aria-label="Panels">
                  {TABS.map((item) => {
                    const active = item.value === tab;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => chooseTab(item.value)}
                        className={cn(
                          "relative h-8 cursor-pointer rounded-[10px] text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {active && <motion.span layoutId="inspector-tab" transition={QUIET_SPRING} className="absolute inset-0 rounded-[10px] bg-background shadow-sm ring-1 ring-border/50" />}
                        <span className="relative">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={() => setOpen(false)}
                  className="grid size-8 cursor-pointer place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.div
                    key={tab}
                    custom={direction}
                    className="absolute inset-0"
                    variants={{
                      enter: (dir: number) => ({ opacity: 0, x: reducedMotion ? 0 : dir * 20 }),
                      center: { opacity: 1, x: 0 },
                      exit: (dir: number) => ({ opacity: 0, x: reducedMotion ? 0 : dir * -20 }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: QUIET_EASE }}
                  >
                    {tab === "contents" && <ContentsPanel page={page} onGo={setPage} />}
                    {tab === "notes" && <NotesPanel onGo={setPage} />}
                    {tab === "appearance" && (
                      <AppearancePanel
                        theme={theme}
                        onTheme={setTheme}
                        typography={typography}
                        onTypography={(update) => setTypography((current) => ({ ...current, ...update }))}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </StageSurface>
  );
}
