import { DetentSheet } from "@/components/ui/detent-sheet";
import { Switch } from "@/components/ui/switch";
import { MEDIUM_DETENT } from "@/features/reader/ReaderDetentSheets";
import { MOTION } from "@/lib/motion";
import { sheetSnaps } from "@workbench/elements/sheet-motion";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

type ScenarioId =
  | "fit"
  | "fixed"
  | "rows"
  | "long"
  | "nested"
  | "keyboard"
  | "moving"
  | "flick"
  | "stacked"
  | "shape";

const SCENARIOS: { id: ScenarioId; title: string; description: string }[] = [
  {
    id: "fit",
    title: "Fitting sheet",
    description:
      "No detents: the sheet fits its content. A section grows in, collapses away, or a tab swaps the content in one frame.",
  },
  {
    id: "fixed",
    title: "Fixed detent",
    description:
      "Rests at medium while its content grows and shrinks: the top edge holds.",
  },
  {
    id: "rows",
    title: "Rows removed quickly",
    description:
      "A Notebook-like list with a field: remove rows one after another, then Undo. The sheet holds, then settles once.",
  },
  {
    id: "long",
    title: "Long list",
    description:
      "At medium a swipe moves the sheet; at full height the list scrolls.",
  },
  {
    id: "nested",
    title: "Nested scrollers",
    description:
      "A sideways row and a box that scrolls on its own, inside a sheet with detents.",
  },
  {
    id: "keyboard",
    title: "Keyboard",
    description:
      "A field raises the sheet to full height with the keyboard and returns it to medium.",
  },
  {
    id: "moving",
    title: "Changes mid-move",
    description:
      "A new detent, or new content, while the sheet is still moving.",
  },
  {
    id: "flick",
    title: "Flick to dismiss",
    description: "Throw the sheet down from medium or full height.",
  },
  {
    id: "stacked",
    title: "Sheet over a sheet",
    description: "The lower sheet steps back while another opens over it.",
  },
  {
    id: "shape",
    title: "Shape and safe areas",
    description:
      "Small, medium and full height: the inset and corners follow the position. Turn the phone for landscape.",
  },
];

const SCENARIO_IDS = new Set<string>(SCENARIOS.map(({ id }) => id));

/** Reduced motion, from the system or the lab's switch. */
const ReduceContext = createContext(false);

/** How rows and sections collapse and grow, as the Notebook's entries do. */
function useRowMotion() {
  const reduce = useContext(ReduceContext);
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: {
      height: 0,
      opacity: 0,
      transition: {
        height: {
          duration: reduce ? 0 : 0.18,
          delay: reduce ? 0 : 0.16,
          ease: MOTION.enter.ease,
        },
        opacity: { duration: reduce ? 0 : 0.16 },
      },
    },
    transition: { duration: reduce ? 0 : 0.18, ease: MOTION.enter.ease },
  } as const;
}

const PILL =
  "h-9 shrink-0 rounded-full bg-secondary px-3.5 text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";

function reduceMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Moves a sheet to full height or to one of its detents, smallest first,
 * as React Aria's own moves do: a smooth scroll that the sheet's spring
 * runs.
 */
function moveSheet(scroller: HTMLElement | null, to: "full" | number) {
  if (!scroller) return;
  const snaps = sheetSnaps(scroller);
  const detents = snaps
    .filter((snap) => snap.marker.hasAttribute("data-sheet-detent"))
    .sort((a, b) => a.position - b.position);
  const snap = to === "full" ? snaps.find((each) => each.full) : detents[to];
  if (!snap) return;
  scroller.scrollTo({
    top: snap.position,
    behavior: reduceMotion() ? "instant" : "smooth",
  });
}

function scrollerOf(event: MouseEvent<HTMLElement>) {
  return event.currentTarget.closest<HTMLElement>("[data-sheet-scroll]");
}

/** A row of controls at the top of a scenario's sheet. */
function Controls({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3" data-lab-controls="">
      {children}
    </div>
  );
}

function Pill({
  onClick,
  children,
  disabled,
}: {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={PILL}
    >
      {children}
    </button>
  );
}

function DetentPills({ small = false }: { small?: boolean }) {
  return (
    <>
      {small && (
        <Pill onClick={(event) => moveSheet(scrollerOf(event), 0)}>Small</Pill>
      )}
      <Pill onClick={(event) => moveSheet(scrollerOf(event), small ? 1 : 0)}>
        Medium
      </Pill>
      <Pill onClick={(event) => moveSheet(scrollerOf(event), "full")}>
        Full height
      </Pill>
    </>
  );
}

/** Filler rows, numbered. */
function Rows({ count, label = "Row" }: { count: number; label?: string }) {
  return (
    <div className="space-y-2 px-4 pb-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-border/60 bg-secondary/25 px-4 py-3 text-[14px]"
        >
          {label} {index + 1}
        </div>
      ))}
    </div>
  );
}

/** Sections that grow in and collapse away, as the Notebook's rows do. */
function Sections({ ids }: { ids: number[] }) {
  const rowMotion = useRowMotion();
  return (
    <AnimatePresence initial={false}>
      {ids.map((id) => (
        <motion.section
          key={id}
          data-lab-section={id}
          {...rowMotion}
          className="flow-root overflow-hidden"
        >
          <div className="mx-4 mb-2 rounded-2xl bg-secondary px-4 py-3 text-[14px] leading-6">
            Section {id}. Words that take a few lines, so the sheet has
            something to fit: the quick brown fox jumps over the lazy dog.
          </div>
        </motion.section>
      ))}
    </AnimatePresence>
  );
}

function useSections(initial: number) {
  const next = useRef(initial + 1);
  const [ids, setIds] = useState(() =>
    Array.from({ length: initial }, (_, index) => index + 1),
  );
  return {
    ids,
    add: () => setIds((current) => [...current, next.current++]),
    remove: () => setIds((current) => current.slice(0, -1)),
  };
}

function FitScenario() {
  const sections = useSections(2);
  const [tab, setTab] = useState<"short" | "tall">("short");
  return (
    <>
      <Controls>
        <Pill onClick={sections.add}>Add a section</Pill>
        <Pill onClick={sections.remove} disabled={!sections.ids.length}>
          Remove a section
        </Pill>
        <Pill onClick={() => setTab(tab === "short" ? "tall" : "short")}>
          {tab === "short" ? "Tall tab" : "Short tab"}
        </Pill>
      </Controls>
      <Sections ids={sections.ids} />
      <Rows count={tab === "short" ? 1 : 6} label="Tab row" />
    </>
  );
}

function FixedScenario() {
  const sections = useSections(1);
  return (
    <>
      <Controls>
        <Pill onClick={sections.add}>Add a section</Pill>
        <Pill onClick={sections.remove} disabled={!sections.ids.length}>
          Remove a section
        </Pill>
        <DetentPills />
      </Controls>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Sections ids={sections.ids} />
        <Rows count={14} />
      </div>
    </>
  );
}

const ROW_TEXT = [
  "Alice was beginning to get very tired of sitting by her sister.",
  "Down, down, down. Would the fall never come to an end?",
  "She found herself in a long, low hall, lit by a row of lamps.",
  "Curiouser and curiouser!",
];

function RowsScenario() {
  const [rows, setRows] = useState(() =>
    ROW_TEXT.map((text, index) => ({ id: index + 1, text })),
  );
  const [removed, setRemoved] = useState<
    { row: { id: number; text: string }; index: number }[][]
  >([]);
  const rowMotion = useRowMotion();
  const restored = useRef(new Set<number>());
  const current = useRef(rows);
  current.current = rows;
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );
  // Each removal has its own Undo, as in the Notebook.
  const removeFirst = () => {
    const [row, ...rest] = current.current;
    if (!row) return;
    current.current = rest;
    setRows(rest);
    setRemoved((batches) => [...batches, [{ row, index: 0 }]]);
  };
  // One after another, as quick swipes are.
  const removeThree = () => {
    for (let index = 0; index < 3; index++)
      timers.current.push(window.setTimeout(removeFirst, index * 140));
  };
  const undo = () => {
    const last = removed.at(-1);
    if (!last) return;
    setRemoved((batches) => batches.slice(0, -1));
    const next = [...current.current];
    for (const { row, index } of last) {
      restored.current.add(row.id);
      next.splice(Math.min(index, next.length), 0, row);
    }
    current.current = next;
    setRows(next);
  };
  const add = () => {
    const id = Math.max(0, ...current.current.map((row) => row.id)) + 1;
    restored.current.add(id);
    const next = [...current.current, { id, text: `A new row, number ${id}.` }];
    current.current = next;
    setRows(next);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Controls>
        <Pill onClick={removeThree} disabled={rows.length < 3}>
          Remove 3 rows
        </Pill>
        <Pill onClick={removeFirst} disabled={!rows.length}>
          Remove a row
        </Pill>
        <Pill onClick={undo} disabled={!removed.length}>
          Undo
        </Pill>
        <Pill onClick={add}>Add a row</Pill>
        <DetentPills />
      </Controls>
      <div
        data-detent-scroll=""
        data-lab-rows=""
        className="max-h-[48dvh] min-h-0 overflow-y-auto px-4"
      >
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.div
              key={row.id}
              data-lab-row={row.id}
              {...rowMotion}
              initial={restored.current.has(row.id) ? rowMotion.initial : false}
              className="flow-root overflow-hidden"
            >
              <article className="mb-2 rounded-2xl bg-secondary px-4 py-3 text-[15px] leading-relaxed">
                {row.text}
              </article>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div data-sheet-slack="" aria-hidden="true" />
      <div data-sheet-footer="" className="shrink-0 p-4">
        <input
          aria-label="Write a note"
          placeholder="Write a note"
          className="h-11 w-full rounded-3xl border border-border/80 bg-background px-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>
    </div>
  );
}

function LongScenario() {
  return (
    <>
      <Controls>
        <DetentPills />
      </Controls>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Rows count={80} />
      </div>
    </>
  );
}

function NestedScenario() {
  return (
    <>
      <Controls>
        <DetentPills />
      </Controls>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <div
          data-lab-sideways=""
          className="mb-3 flex snap-x gap-2 overflow-x-auto px-4 pb-1"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              className="grid h-24 w-32 shrink-0 snap-start place-items-center rounded-2xl bg-secondary text-[14px]"
            >
              Card {index + 1}
            </div>
          ))}
        </div>
        <div
          data-lab-inner=""
          className="mx-4 mb-3 h-40 overflow-y-auto overscroll-contain rounded-2xl border border-border/60 px-4 py-2 text-[14px] leading-7"
        >
          {Array.from({ length: 24 }, (_, index) => (
            <p key={index}>Inner line {index + 1}</p>
          ))}
        </div>
        <Rows count={20} />
      </div>
    </>
  );
}

function KeyboardScenario() {
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Controls>
        <Pill onClick={() => field.current?.focus()}>Show keyboard</Pill>
        <Pill onClick={() => field.current?.blur()}>Hide keyboard</Pill>
      </Controls>
      <div className="px-4 pb-3">
        <textarea
          ref={field}
          aria-label="Lab field"
          rows={2}
          placeholder="Type here"
          className="w-full resize-none rounded-2xl border border-border/80 bg-background px-4 py-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Rows count={16} />
      </div>
    </>
  );
}

function MovingScenario() {
  const sections = useSections(0);
  const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);
  return (
    <>
      <Controls>
        <Pill
          onClick={(event) => {
            const scroller = scrollerOf(event);
            moveSheet(scroller, "full");
            later(() => moveSheet(scroller, 0), 150);
          }}
        >
          Full, then medium
        </Pill>
        <Pill
          onClick={(event) => {
            const scroller = scrollerOf(event);
            moveSheet(scroller, 0);
            later(() => moveSheet(scroller, "full"), 150);
          }}
        >
          Medium, then full
        </Pill>
        <Pill
          onClick={(event) => {
            moveSheet(scrollerOf(event), "full");
            later(sections.add, 120);
          }}
        >
          Grow while moving
        </Pill>
        <DetentPills />
      </Controls>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Sections ids={sections.ids} />
        <Rows count={16} />
      </div>
    </>
  );
}

function FlickScenario({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Controls>
        <DetentPills />
        <Pill onClick={onClose}>Close</Pill>
      </Controls>
      <p className="px-4 pb-3 text-[14px] text-muted-foreground">
        Throw the sheet down. A quick flick closes it from either height; a slow
        drag that ends above halfway returns it.
      </p>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Rows count={16} />
      </div>
    </>
  );
}

function ShapeScenario() {
  return (
    <>
      <Controls>
        <DetentPills small />
      </Controls>
      <p className="px-4 pb-3 text-[14px] leading-6 text-muted-foreground">
        Below full height the sheet floats 8 px in from the sides and the
        bottom, its bottom corners following the screen's. Between medium and
        full height it widens to meet the edges. The readout above shows the
        inset and the corner.
      </p>
      <div data-detent-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        <Rows count={12} />
      </div>
    </>
  );
}

/**
 * The topmost sheet's state, written straight to the DOM each frame so the
 * readout itself does not render the page again. Tests read its data
 * attributes.
 */
function Readout() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let last = "";
    const sample = () => {
      frame = requestAnimationFrame(sample);
      const element = ref.current;
      if (!element) return;
      const overlays = document.querySelectorAll<HTMLElement>(
        ".reader-sheet-overlay",
      );
      const overlay = overlays[overlays.length - 1];
      const scroller = overlay?.querySelector<HTMLElement>(
        "[data-sheet-scroll]",
      );
      const sheet = overlay?.querySelector<HTMLElement>(".reader-sheet");
      const keyboard = Math.max(
        0,
        Math.round(innerHeight - (visualViewport?.height ?? innerHeight)),
      );
      const landscape = innerWidth > innerHeight;
      if (!overlay || !scroller || !sheet) {
        const text = `No sheet · ${landscape ? "landscape" : "portrait"} · keyboard ${keyboard}`;
        if (text !== last) {
          last = text;
          element.textContent = text;
          element.dataset.detent = "none";
        }
        return;
      }
      const top = Math.round(sheet.getBoundingClientRect().top);
      const fit = overlay.querySelector<HTMLElement>("[data-sheet-fit]");
      const fitState = fit?.dataset.sheetFitState ?? "off";
      const shape = overlay.dataset.sheetShape ?? "";
      const style = getComputedStyle(scroller);
      const float = parseFloat(style.getPropertyValue("--wb-sheet-float"));
      const largest = parseFloat(style.getPropertyValue("--wb-sheet-inset"));
      const inset =
        (Number.isFinite(largest) ? largest : 8) *
        (Number.isFinite(float) ? float : 1);
      // "phone", or an iPad's "form" layout, centred or on the bottom edge.
      const layout = `${overlay.dataset.sheetLayout ?? "phone"}${overlay.dataset.position === "center" ? " centred" : ""}`;
      const corner = parseFloat(style.getPropertyValue("--wb-sheet-corner"));
      const snaps = sheetSnaps(scroller);
      const detents = snaps
        .filter((snap) => snap.marker.hasAttribute("data-sheet-detent"))
        .sort((a, b) => a.position - b.position);
      const resting = snaps.find(
        (snap) => Math.abs(snap.position - scroller.scrollTop) < 1,
      );
      let detent = scroller.hasAttribute("data-sheet-spring")
        ? "moving"
        : "between";
      if (resting && !scroller.hasAttribute("data-sheet-spring")) {
        const index = detents.indexOf(resting);
        if (resting.full) detent = "full";
        else if (index >= 0) detent = `detent ${index + 1}`;
        else detent = "closed";
        // A detent at the sheet's full height counts as full.
        const full = snaps.find((snap) => snap.full);
        if (full && Math.abs(full.position - resting.position) < 1)
          detent = "full";
      }
      const text = [
        `top ${top}`,
        `height ${Math.round(innerHeight - top)}`,
        detent,
        `fit ${fitState}`,
        layout,
        shape,
        `inset ${inset.toFixed(1)}`,
        `corner ${Number.isFinite(corner) ? corner.toFixed(1) : "–"}`,
        `sheets ${overlays.length}`,
        `keyboard ${keyboard}`,
        landscape ? "landscape" : "portrait",
      ].join(" · ");
      if (text === last) return;
      last = text;
      element.textContent = text;
      element.dataset.detent = detent;
      element.dataset.fitState = fitState;
      element.dataset.shape = shape;
      element.dataset.layout = layout;
      element.dataset.top = String(top);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={ref}
      data-lab-readout=""
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] bg-foreground/80 px-3 pt-[max(env(safe-area-inset-top),0.25rem)] pb-1 font-mono text-[10px] leading-4 text-background"
    />
  );
}

/**
 * Makes the page read reduced motion as on, for the sheet's own checks and
 * Motion's, while the lab is open with the switch on.
 */
function useForcedReducedMotion(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const native = window.matchMedia;
    window.matchMedia = (query: string) => {
      const list = native.call(window, query);
      if (!query.includes("prefers-reduced-motion")) return list;
      return new Proxy(list, {
        get(target, key) {
          if (key === "matches") return query.includes("reduce");
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    return () => {
      window.matchMedia = native;
    };
  }, [on]);
}

/**
 * Sheet Lab: one sheet per case the shared sheet has to get right
 * (packages/elements/docs/MOTION.md, "Sheet behaviour"), each a tap away,
 * with controls inside the sheet and a readout of its state at the top.
 * `?scenario=<id>` opens one directly and `?reduce=1` turns reduced motion
 * on, for tests.
 */
export function SheetLab() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("scenario");
  const [open, setOpen] = useState<ScenarioId | null>(
    initial && SCENARIO_IDS.has(initial) ? (initial as ScenarioId) : null,
  );
  const [upper, setUpper] = useState(false);
  const [reduce, setReduce] = useState(params.get("reduce") === "1");
  useForcedReducedMotion(reduce);
  const [systemReduce] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const show = (id: ScenarioId | null) => {
    setOpen(id);
    if (!id) setUpper(false);
    const next = new URLSearchParams(params);
    if (id) next.set("scenario", id);
    else next.delete("scenario");
    setParams(next, { replace: true });
  };
  const sheet = (id: ScenarioId) => ({
    isOpen: open === id,
    onOpenChange: (next: boolean) => {
      if (!next) show(null);
    },
    title: SCENARIOS.find((scenario) => scenario.id === id)!.title,
  });

  return (
    <ReduceContext.Provider value={reduce || systemReduce}>
      <MotionConfig reducedMotion={reduce ? "always" : "user"}>
        <div className="min-h-dvh bg-background text-foreground">
          <Readout />
          <div className="mx-auto max-w-2xl px-4 pt-14 pb-16">
            <header className="mb-6 flex items-center gap-3">
              <Link
                to="/debug"
                aria-label="Back to Debug tools"
                className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">Sheet Lab</h1>
            </header>
            <p className="mb-5 text-sm text-muted-foreground">
              Each case opens a sheet with its own controls. The bar at the top
              reads the sheet: its top edge, where it rests, its height state,
              its shape and the keyboard.
            </p>
            <label className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3">
              <span>
                <span className="block text-sm font-medium">Reduce motion</span>
                <span className="block text-xs text-muted-foreground">
                  Every move is instant, after the same waits.
                </span>
              </span>
              <Switch
                aria-label="Reduce motion"
                checked={reduce}
                onCheckedChange={setReduce}
              />
            </label>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {SCENARIOS.map((scenario) => (
                <li key={scenario.id}>
                  <button
                    type="button"
                    data-lab-scenario={scenario.id}
                    onClick={() => show(scenario.id)}
                    className="block w-full px-4 py-3.5 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]"
                  >
                    <span className="block text-sm font-medium">
                      {scenario.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {scenario.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <DetentSheet {...sheet("fit")}>
            <FitScenario />
          </DetentSheet>
          <DetentSheet {...sheet("fixed")} snapPoints={[MEDIUM_DETENT]}>
            <FixedScenario />
          </DetentSheet>
          <DetentSheet {...sheet("rows")} snapPoints={[MEDIUM_DETENT]} fit>
            <RowsScenario />
          </DetentSheet>
          <DetentSheet {...sheet("long")} snapPoints={[MEDIUM_DETENT]}>
            <LongScenario />
          </DetentSheet>
          <DetentSheet {...sheet("nested")} snapPoints={[MEDIUM_DETENT]}>
            <NestedScenario />
          </DetentSheet>
          <DetentSheet {...sheet("keyboard")} snapPoints={[MEDIUM_DETENT]}>
            <KeyboardScenario />
          </DetentSheet>
          <DetentSheet {...sheet("moving")} snapPoints={[MEDIUM_DETENT]}>
            <MovingScenario />
          </DetentSheet>
          <DetentSheet {...sheet("flick")} snapPoints={[MEDIUM_DETENT]}>
            <FlickScenario onClose={() => show(null)} />
          </DetentSheet>
          <DetentSheet {...sheet("stacked")} snapPoints={[MEDIUM_DETENT]}>
            <Controls>
              <Pill onClick={() => setUpper(true)}>Open a sheet over this</Pill>
              <DetentPills />
            </Controls>
            <div
              data-detent-scroll=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <Rows count={16} label="Lower row" />
            </div>
          </DetentSheet>
          <DetentSheet
            isOpen={open === "stacked" && upper}
            onOpenChange={(next) => !next && setUpper(false)}
            title="Upper sheet"
            snapPoints={[MEDIUM_DETENT]}
            stacked
            onBack={() => setUpper(false)}
            backLabel="Back to the lower sheet"
          >
            <Controls>
              <DetentPills />
            </Controls>
            <div
              data-detent-scroll=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <Rows count={16} label="Upper row" />
            </div>
          </DetentSheet>
          <DetentSheet {...sheet("shape")} snapPoints={[220, MEDIUM_DETENT]}>
            <ShapeScenario />
          </DetentSheet>
        </div>
      </MotionConfig>
    </ReduceContext.Provider>
  );
}
