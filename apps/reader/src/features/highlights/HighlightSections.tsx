import { cn } from "@/lib/utils";
import { clearCache, layout, prepare } from "@chenglou/pretext";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

// The list of Highlights, virtualized as Med's session thread is. Only the
// rows near the view render. Each other row takes its height from when it
// last rendered, or from an estimate of its text (Pretext), and spacers
// above and below hold that space. The first row in view keeps its place
// when heights above it change. The page scrolls the window, so the list
// reads the view from the window.

/** Space that renders above and below the view. The rendered range moves
 * when less than LEAD stays rendered past an edge, in a task after the frame.
 * With less than MARGIN, the view could reach empty space first, so the range
 * moves at once, in the scroll event. */
const OVERSCAN = 1200;
const LEAD = 800;
const MARGIN = 400;
/** Rows that render before the list has its sizes. */
const UNSIZED = 40;

/** The context (a book or a day) beside its passages; one column on a phone. */
const SECTION_GRID = "grid gap-x-12 md:grid-cols-[12.5rem_minmax(0,42rem)]";

export interface ListEntry {
  id: string;
  passage: string | null;
  note: string | null;
}

export interface ListSection {
  key: string;
  entries: ListEntry[];
}

interface TextStyle {
  font: string;
  size: number;
  lineHeight: number;
  letterSpacing: number;
  width: number;
}

/** An entry's sizes, read from a hidden sample of one: the probe. */
interface Metrics {
  /** The list's width, for which the measured heights hold. */
  width: number;
  passage: TextStyle;
  note: TextStyle;
  /** Space between a passage and its note. */
  gap: number;
  /** An entry's height without its text. */
  base: number;
}

interface Sized {
  height: number;
  /** An entry's text when it had this height. */
  passage?: string | null;
  note?: string | null;
}

/**
 * Heights outlive the page, so that it comes back from a book at the same
 * place: the window's scroll returns before the rows can measure again.
 */
const memory = {
  metrics: null as Metrics | null,
  /** Rows and asides as they last rendered, at `memory.metrics`. */
  measured: new Map<string, Sized>(),
  /** Entries' heights from their text, at `memory.metrics`. */
  estimates: new Map<string, Sized>(),
  /** The last head and aside that rendered, for sections that have not. */
  typical: new Map<string, number>(),
};

type Row =
  | { type: "head"; key: string; section: number }
  | { type: "entry"; key: string; section: number; entry: number }
  /** Room below the entries for a taller aside beside them. */
  | { type: "tail"; key: string; section: number };

/** The row at height `y` of the list: the last one that starts at or above it. */
function indexAt(offsets: Float64Array, y: number) {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= y) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

function textStyle(element: HTMLElement): TextStyle {
  const style = getComputedStyle(element);
  const size = Number.parseFloat(style.fontSize);
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    size,
    lineHeight:
      style.lineHeight === "normal"
        ? size * 1.2
        : Number.parseFloat(style.lineHeight),
    letterSpacing:
      style.letterSpacing === "normal"
        ? 0
        : Number.parseFloat(style.letterSpacing),
    width: element.clientWidth,
  };
}

/** The probe is an entry with a passage and a note of one line each. */
function readMetrics(list: HTMLElement, probe: HTMLElement): Metrics | null {
  const entry = probe.firstElementChild;
  const passage = probe.querySelector<HTMLElement>("[data-passage]");
  const note = probe.querySelector<HTMLElement>("[data-note]");
  if (!entry || !passage || !note || !list.clientWidth) return null;
  const passageStyle = textStyle(passage);
  const noteStyle = textStyle(note);
  const gap = Number.parseFloat(getComputedStyle(note).marginTop) || 0;
  return {
    width: list.clientWidth,
    passage: passageStyle,
    note: noteStyle,
    gap,
    base:
      entry.getBoundingClientRect().height -
      passageStyle.lineHeight -
      noteStyle.lineHeight -
      gap,
  };
}

const lines = (text: string, style: TextStyle) =>
  layout(
    prepare(text, style.font, {
      whiteSpace: "pre-wrap",
      letterSpacing: style.letterSpacing,
    }),
    style.width,
    style.lineHeight,
  ).lineCount;

/** About as many lines as Pretext would count, without measuring words. */
const roughLines = (text: string, style: TextStyle) => {
  const perLine = Math.max(1, Math.floor(style.width / (style.size * 0.47)));
  return text
    .split("\n")
    .reduce(
      (count, line) => count + Math.max(1, Math.ceil(line.length / perLine)),
      0,
    );
};

function entryHeight(
  entry: ListEntry,
  metrics: Metrics,
  count: (text: string, style: TextStyle) => number,
) {
  let height = metrics.base;
  if (entry.passage)
    height +=
      count(entry.passage, metrics.passage) * metrics.passage.lineHeight;
  if (entry.note)
    height +=
      count(entry.note, metrics.note) * metrics.note.lineHeight +
      (entry.passage ? metrics.gap : 0);
  return height;
}

const sameText = (known: Sized | undefined, entry: ListEntry) =>
  known !== undefined &&
  known.passage === entry.passage &&
  known.note === entry.note;

/** A section's head: the space above its entries, with the aside on a phone. */
function measureSection(element: HTMLElement) {
  const column = element.querySelector<HTMLElement>("[data-column]");
  const aside = element.querySelector<HTMLElement>("[data-aside]");
  if (!column || !aside) return null;
  const box = element.getBoundingClientRect();
  const columnBox = column.getBoundingClientRect();
  const asideBox = aside.getBoundingClientRect();
  const beside =
    asideBox.right <= columnBox.left + 0.5 ||
    asideBox.left >= columnBox.right - 0.5;
  return {
    head: columnBox.top - box.top,
    aside: beside ? asideBox.height : 0,
  };
}

interface Model {
  kind: string;
  sections: ListSection[];
  rows: Row[];
  offsets: Float64Array;
  index: Map<string, number>;
  bounds: { head: number; tail: number }[];
  /** The aside heights that the model counted, by section. */
  asides: Float64Array;
  sectionAt: Map<string, number>;
  /** Entries with a quick height, which wait for idle time to measure text. */
  rough: number;
}

/** Keeps a rendered entry's height; true when the model had another. */
function keepRow(model: Model, key: string, height: number) {
  const at = model.index.get(key);
  const row = at === undefined ? undefined : model.rows[at];
  if (row?.type !== "entry" || !height) return false;
  const item = model.sections[row.section]!.entries[row.entry]!;
  memory.measured.set(key, { height, passage: item.passage, note: item.note });
  return (
    Math.abs(height - (model.offsets[at! + 1]! - model.offsets[at!]!)) > 0.01
  );
}

/** Keeps a rendered section's head and aside; true when the model had others. */
function keepSection(model: Model, element: HTMLElement) {
  const at = model.sectionAt.get(element.dataset.section ?? "");
  const sizes = measureSection(element);
  if (at === undefined || !sizes) return false;
  const { head } = model.bounds[at]!;
  const order = at === 0 ? "first" : "next";
  memory.measured.set(model.rows[head]!.key, { height: sizes.head });
  memory.measured.set(`a:${model.kind}:${model.sections[at]!.key}`, {
    height: sizes.aside,
  });
  memory.typical.set(`${model.kind}:head:${order}`, sizes.head);
  memory.typical.set(`${model.kind}:aside`, sizes.aside);
  return (
    Math.abs(sizes.head - (model.offsets[head + 1]! - model.offsets[head]!)) >
      0.01 || Math.abs(sizes.aside - model.asides[at]!) > 0.01
  );
}

/**
 * Sections of entries, each beside its aside: a book or a day. On a wide
 * screen the aside stays in view while its entries scroll past.
 */
export function HighlightSections<S extends ListSection>({
  kind,
  sections,
  divided = false,
  heading,
  aside,
  entry,
  probe,
}: {
  /** Sections of one kind look alike; a section that has not rendered takes
   * its head and aside from one that has. */
  kind: string;
  sections: S[];
  /** A rule above each section after the first. */
  divided?: boolean;
  /** The id of the section's heading in its aside. */
  heading: (section: S) => string;
  aside: (section: S) => ReactNode;
  entry: (entry: S["entries"][number], section: S) => ReactNode;
  /** An entry with a passage and a note of one line, marked with
   * data-passage and data-note. */
  probe: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const sample = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState(memory.metrics);
  const [version, setVersion] = useState(0);
  const [onScreen] = useState(() => ({
    rows: new Map<string, HTMLElement>(),
    sections: new Map<string, HTMLElement>(),
  }));

  const rows = useMemo(() => {
    const rows: Row[] = [];
    sections.forEach((section, at) => {
      rows.push({
        type: "head",
        key: `h:${kind}:${section.key}:${at === 0 ? "first" : "next"}`,
        section: at,
      });
      section.entries.forEach((item, index) =>
        rows.push({
          type: "entry",
          key: `e:${item.id}`,
          section: at,
          entry: index,
        }),
      );
      rows.push({ type: "tail", key: `t:${section.key}`, section: at });
    });
    return rows;
  }, [sections, kind]);

  const model = useMemo((): Model & { version: number } => {
    const offsets = new Float64Array(rows.length + 1);
    const index = new Map<string, number>();
    const bounds: { head: number; tail: number }[] = [];
    const asides = new Float64Array(sections.length);
    const sectionAt = new Map<string, number>();
    let rough = 0;
    let entries = 0;
    for (let at = 0; at < rows.length; at++) {
      const row = rows[at]!;
      const section = sections[row.section]!;
      index.set(row.key, at);
      let height = 0;
      if (row.type === "head") {
        bounds[row.section] = { head: at, tail: at };
        sectionAt.set(section.key, row.section);
        entries = 0;
        height =
          memory.measured.get(row.key)?.height ??
          memory.typical.get(
            `${kind}:head:${row.section === 0 ? "first" : "next"}`,
          ) ??
          0;
      } else if (row.type === "entry") {
        const item = section.entries[row.entry]!;
        const seen = memory.measured.get(row.key);
        const known = memory.estimates.get(item.id);
        if (sameText(seen, item)) height = seen!.height;
        else if (sameText(known, item)) height = known!.height;
        else if (metrics) {
          rough++;
          height = entryHeight(item, metrics, roughLines);
        }
        entries += height;
      } else {
        bounds[row.section]!.tail = at;
        const asideHeight =
          memory.measured.get(`a:${kind}:${section.key}`)?.height ??
          memory.typical.get(`${kind}:aside`) ??
          0;
        asides[row.section] = asideHeight;
        height = Math.max(0, asideHeight - entries);
      }
      offsets[at + 1] = offsets[at]! + (metrics ? height : 0);
    }
    return {
      kind,
      sections,
      rows,
      offsets,
      index,
      bounds,
      asides,
      sectionAt,
      rough,
      version,
    };
  }, [rows, sections, kind, metrics, version]);

  // In idle time, entries with a quick height measure their text, in order;
  // the view keeps its place as their heights change.
  useEffect(() => {
    if (!metrics || !model.rough) return;
    const run = (deadline?: IdleDeadline) => {
      const until =
        performance.now() + Math.min(8, deadline?.timeRemaining() ?? 8);
      let done = 0;
      for (const row of rows) {
        if (row.type !== "entry") continue;
        if (performance.now() > until) break;
        const item = sections[row.section]!.entries[row.entry]!;
        if (
          sameText(memory.measured.get(row.key), item) ||
          sameText(memory.estimates.get(item.id), item)
        )
          continue;
        memory.estimates.set(item.id, {
          passage: item.passage,
          note: item.note,
          height: entryHeight(item, metrics, lines),
        });
        done++;
      }
      if (done) setVersion((value) => value + 1);
    };
    if (!("requestIdleCallback" in globalThis)) {
      const timer = setTimeout(run, 50);
      return () => clearTimeout(timer);
    }
    const id = requestIdleCallback(run, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }, [model, metrics, rows, sections]);

  // The rendered range. A new list of rows starts around the last view.
  const view = useRef({ y: 0, height: 0 });
  const [range, setRange] = useState<{
    start: number;
    end: number;
    rows: Row[];
  } | null>(null);
  const count = rows.length;
  const fresh = range?.rows === rows;
  let start = 0;
  let end = Math.min(count, UNSIZED);
  if (fresh) {
    start = Math.min(count, range.start);
    end = Math.min(count, range.end);
  } else if (metrics && view.current.height) {
    const { y, height } = view.current;
    start = indexAt(model.offsets, y - OVERSCAN);
    end = Math.min(count, indexAt(model.offsets, y + height + OVERSCAN) + 1);
  }

  // The latest values for the scroll and resize handlers.
  const latest = useRef({ model, metrics, range: { start, end }, fresh });
  useLayoutEffect(() => {
    latest.current = { model, metrics, range: { start, end }, fresh };
  });

  // The first row that starts in view, and how far the view is below its
  // top: negative when the view starts above it.
  const anchor = useRef<{ key: string; delta: number } | null>(null);
  const list = useRef<{ restore(): void; place(sync: boolean): void } | null>(
    null,
  );

  // Rows on screen report later changes, as when a cover or a font loads.
  const observer = useRef<ResizeObserver | null>(null);
  const onResize = useCallback((changes: ResizeObserverEntry[]) => {
    const { model } = latest.current;
    let changed = false;
    for (const change of changes) {
      const element = change.target as HTMLElement;
      const key = element.dataset.row;
      if (key) {
        const height =
          change.borderBoxSize[0]?.blockSize ??
          element.getBoundingClientRect().height;
        if (keepRow(model, key, height)) changed = true;
      } else {
        const section = element.closest<HTMLElement>("[data-section]");
        if (section && keepSection(model, section)) changed = true;
      }
    }
    if (changed) flushSync(() => setVersion((value) => value + 1));
  }, []);

  const rowRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const key = element.dataset.row!;
      onScreen.rows.set(key, element);
      observer.current ??= new ResizeObserver(onResize);
      observer.current.observe(element);
      return () => {
        observer.current?.unobserve(element);
        if (onScreen.rows.get(key) === element) onScreen.rows.delete(key);
      };
    },
    [onResize, onScreen],
  );
  const sectionRef = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const key = element.dataset.section!;
      const aside = element.querySelector<HTMLElement>("[data-aside]");
      onScreen.sections.set(key, element);
      observer.current ??= new ResizeObserver(onResize);
      if (aside) observer.current.observe(aside);
      return () => {
        if (aside) observer.current?.unobserve(aside);
        if (onScreen.sections.get(key) === element)
          onScreen.sections.delete(key);
      };
    },
    [onResize, onScreen],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  // The entry's sizes come from the probe. They change with the width and
  // with fonts that finish loading.
  const readProbe = useCallback((force = false) => {
    const list = root.current;
    const probeElement = sample.current;
    if (!list || !probeElement) return;
    const next = readMetrics(list, probeElement);
    if (!next) return;
    if (
      force ||
      !memory.metrics ||
      JSON.stringify(memory.metrics) !== JSON.stringify(next)
    ) {
      // Heights were for the old width or fonts. Rows on screen measure again
      // before the next paint.
      memory.measured.clear();
      memory.estimates.clear();
      memory.metrics = next;
    }
    setMetrics(memory.metrics);
  }, []);
  useLayoutEffect(() => readProbe(), [readProbe]);
  useEffect(() => {
    const list = root.current;
    const probeElement = sample.current;
    if (!list || !probeElement) return;
    const resize = new ResizeObserver(() => readProbe());
    resize.observe(list);
    resize.observe(probeElement);
    const fonts = document.fonts;
    const loaded = () => {
      clearCache();
      readProbe(true);
    };
    fonts.addEventListener("loadingdone", loaded);
    return () => {
      resize.disconnect();
      fonts.removeEventListener("loadingdone", loaded);
    };
  }, [readProbe]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const listTop = () => node.getBoundingClientRect().top + window.scrollY;
    // Where the view was when its anchor was recorded or kept.
    let recorded = window.scrollY;
    const record = () => {
      recorded = window.scrollY;
      const y = window.scrollY - listTop();
      view.current = { y, height: window.innerHeight };
      const { rows, offsets } = latest.current.model;
      if (!rows.length || !latest.current.metrics) return;
      let at = indexAt(offsets, y);
      // As in the browser's own anchoring, the first row that starts in view.
      if (
        offsets[at]! < y &&
        at + 1 < rows.length &&
        offsets[at + 1]! < y + window.innerHeight
      )
        at++;
      anchor.current = { key: rows[at]!.key, delta: y - offsets[at]! };
    };
    // Browser scroll anchoring is off: it would count the spacers. The view
    // keeps its first row in place itself.
    const restore = () => {
      // The view moved since its anchor: a scroll whose event has not come
      // yet, the browser's clamp, or the page's own scroll. The new place is
      // the anchor. So is the place when the anchor's row has left the list.
      const saved = anchor.current;
      const { offsets, index } = latest.current.model;
      const at = saved ? index.get(saved.key) : undefined;
      if (Math.abs(window.scrollY - recorded) > 1 || !saved || at === undefined)
        return record();
      const target = listTop() + offsets[at]! + saved.delta;
      if (Math.abs(window.scrollY - target) > 1)
        window.scrollTo({ top: target, behavior: "instant" });
      recorded = window.scrollY;
    };
    const place = (sync: boolean) => {
      const { model, metrics, range, fresh } = latest.current;
      if (!metrics) return;
      const { offsets, rows } = model;
      const total = rows.length;
      const y = window.scrollY - listTop();
      const height = window.innerHeight;
      view.current = { y, height };
      // The range covers the view with a margin on each side.
      const covered = (margin: number) =>
        range.end <= total &&
        range.start < range.end &&
        (range.start === 0 || offsets[range.start]! <= y - margin) &&
        (range.end === total || offsets[range.end]! >= y + height + margin);
      // And not much more. A row taller than the overscan counts as one.
      const lean =
        range.start >= indexAt(offsets, y - 2 * OVERSCAN) &&
        range.end <= indexAt(offsets, y + height + 2 * OVERSCAN) + 1;
      if (!total || (fresh && covered(LEAD) && lean)) return;
      const next = {
        start: indexAt(offsets, y - OVERSCAN),
        end: Math.min(total, indexAt(offsets, y + height + OVERSCAN) + 1),
        rows,
      };
      if (sync && !covered(MARGIN)) flushSync(() => setRange(next));
      else setRange(next);
    };
    list.current = { restore, place };
    const onScroll = () => {
      record();
      place(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    record();
    return () => {
      list.current = null;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // After a render: rows that rendered take their own heights; then the view
  // keeps its place, and the range follows the view.
  useLayoutEffect(() => {
    if (!metrics) return;
    let changed = false;
    for (const [key, element] of onScreen.rows)
      if (keepRow(model, key, element.getBoundingClientRect().height))
        changed = true;
    for (const element of onScreen.sections.values())
      if (keepSection(model, element)) changed = true;
    if (changed) {
      // Heights exist only after layout, so they are read after commit.
      setVersion((value) => value + 1);
      return;
    }
    list.current?.restore();
    list.current?.place(false);
  }, [model, start, end, metrics, onScreen]);

  const { offsets, bounds } = model;
  const rendered: ReactNode[] = [];
  let firstSection = -1;
  let lastSection = -1;
  for (let at = 0; at < sections.length && start < end; at++) {
    const { head, tail } = bounds[at]!;
    if (tail < start || head >= end) continue;
    if (firstSection < 0) firstSection = at;
    lastSection = at;
    const section = sections[at]!;
    const from = Math.min(Math.max(start, head + 1), tail);
    const to = Math.min(Math.max(end, from), tail);
    rendered.push(
      <section
        key={section.key}
        ref={sectionRef}
        data-section={section.key}
        aria-labelledby={heading(section)}
        className={cn(
          "relative",
          at === 0
            ? "pt-6 md:pt-10"
            : divided
              ? "pt-10 md:pt-14"
              : "pt-8 md:pt-12",
        )}
      >
        {at > 0 && divided && (
          <div
            aria-hidden="true"
            className="mb-8 border-t border-border/60 md:mb-12"
          />
        )}
        <div className={SECTION_GRID}>
          <div data-aside="" className="md:sticky md:top-8 md:self-start">
            {aside(section)}
          </div>
          <div data-column="" className="min-w-0">
            <div style={{ height: offsets[from]! - offsets[head + 1]! }} />
            {rows.slice(from, to).map((row) => {
              if (row.type !== "entry") return null;
              return (
                <div key={row.key} ref={rowRef} data-row={row.key}>
                  {entry(section.entries[row.entry]!, section)}
                </div>
              );
            })}
            <div style={{ height: offsets[tail]! - offsets[to]! }} />
          </div>
        </div>
      </section>,
    );
  }
  const above = firstSection < 0 ? 0 : offsets[bounds[firstSection]!.head]!;
  const below =
    offsets[count]! -
    (lastSection < 0 ? 0 : offsets[bounds[lastSection]!.tail + 1]!);

  return (
    // The list is at least a screen tall, so that a filter which leaves few
    // entries does not clamp the scroll and move the filters.
    <div ref={root} className="relative min-h-svh [overflow-anchor:none]">
      <div
        aria-hidden="true"
        className={cn(
          SECTION_GRID,
          "pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden",
        )}
      >
        <div />
        <div ref={sample}>{probe}</div>
      </div>
      <div style={{ height: above }} />
      {rendered}
      <div style={{ height: below }} />
    </div>
  );
}
