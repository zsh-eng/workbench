import { DetentSheet, SheetSpringContext } from "@/components/ui/detent-sheet";
import { MEDIUM_DETENT } from "@/features/reader/ReaderDetentSheets";
import { SPRINGS, type Spring } from "@workbench/elements/spring";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SamplePage } from "./specimens/SamplePage";

export const SHEET_MOTIONS: Record<string, Spring | null> = {
  scroll: null,
  uikit: SPRINGS.sheet,
  telegram: SPRINGS.snappy,
};

type Open = "menu" | "list" | null;

/** Seconds into each loop of `?run=auto`, for recordings. */
const SCRIPT: { at: number; step: string }[] = [
  { at: 0.8, step: "open-menu" },
  { at: 2.3, step: "close" },
  { at: 3.6, step: "open-list" },
  { at: 5.1, step: "full" },
  { at: 6.6, step: "medium" },
  { at: 8.1, step: "close" },
];
const LOOP = 9.6;

/** The topmost sheet's scroll container. */
function topScroller(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(
    ".reader-sheet-overlay [data-sheet-scroll]",
  );
  return all[all.length - 1] ?? null;
}

/** Moves a sheet to full height, or back to its first detent, as a field's
 * focus does: with a smooth scroll that the sheet's spring takes over. With
 * reduced motion it jumps, as React Aria's own moves do. */
function scrollToDetent(scroller: HTMLElement, detent: "full" | "medium") {
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
  if (detent === "full") {
    scroller.scrollTo({
      top: scroller.scrollHeight - scroller.clientHeight,
      behavior,
    });
    return;
  }
  const marker = scroller.querySelector<HTMLElement>("[data-sheet-initial]");
  if (!marker) return;
  const margin = parseFloat(getComputedStyle(marker).scrollMarginTop) || 0;
  scroller.scrollTo({
    top:
      marker.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      margin,
    behavior,
  });
}

/**
 * Reader's detent sheets on a sample page, moved by the browser's smooth
 * scroll or by a spring. Menu fits its content, as Reader tools does; List
 * opens at the medium detent, as Contents and the Notebook do, and its
 * buttons change the detent. `?run=auto` repeats a fixed sequence and
 * `?track=1` colours the page for frame-by-frame measurement, recording the
 * sheet's top edge in `window.__sheetTrace` (and posting it to `?collect=`).
 */
export function SheetMotionIdea() {
  const [params] = useSearchParams();
  const motionId = params.get("motion") ?? "uikit";
  const spring =
    motionId in SHEET_MOTIONS ? SHEET_MOTIONS[motionId]! : SPRINGS.sheet;
  const auto = params.get("run") === "auto";
  const track = params.get("track") === "1";
  const framed = window.parent !== window;
  const [open, setOpen] = useState<Open>(null);

  useEffect(() => {
    if (!auto) return;
    const start = performance.now();
    const timers: number[] = [];
    const mark = (step: string) => {
      const trace = (window as { __sheetTrace?: unknown[] }).__sheetTrace;
      trace?.push({ t: performance.now(), step });
    };
    const schedule = (offset: number) => {
      for (const { at, step } of SCRIPT)
        timers.push(
          window.setTimeout(
            () => {
              mark(step);
              if (step === "open-menu") setOpen("menu");
              else if (step === "open-list") setOpen("list");
              else if (step === "close") setOpen(null);
              else {
                const scroller = topScroller();
                if (scroller)
                  scrollToDetent(scroller, step as "full" | "medium");
              }
            },
            (offset + at) * 1000 - (performance.now() - start),
          ),
        );
    };
    for (let loop = 0; loop < 20; loop++) schedule(loop * LOOP);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [auto]);

  useEffect(() => {
    if (!track) return;
    const trace: unknown[] = [];
    (window as { __sheetTrace?: unknown[] }).__sheetTrace = trace;
    let frame = 0;
    const sample = () => {
      const sheets = document.querySelectorAll<HTMLElement>(
        ".reader-sheet [data-sheet-content]",
      );
      const sheet = sheets[sheets.length - 1];
      const top = sheet?.getBoundingClientRect().top;
      trace.push({ t: performance.now(), top: top ?? null });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    // `?collect=<url>` posts the trace there each second, for a phone or a
    // simulator that has no console to read it from.
    const collect = params.get("collect");
    const timer = collect
      ? window.setInterval(() => {
          void fetch(collect, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ motion: motionId, trace: trace.splice(0) }),
          }).catch(() => {});
        }, 1000)
      : 0;
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [track, params, motionId]);

  const detentButton = (detent: "full" | "medium", label: string) => (
    <button
      type="button"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        const scroller = event.currentTarget.closest<HTMLElement>(
          "[data-sheet-scroll]",
        );
        if (scroller) scrollToDetent(scroller, detent);
      }}
      className="h-10 flex-1 rounded-full bg-secondary text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  );

  return (
    <SheetSpringContext.Provider value={spring}>
      <div
        className="relative h-dvh w-full overflow-hidden bg-background text-foreground"
        style={track ? { background: "#d91a8c" } : undefined}
      >
        {track && (
          <style>{`.reader-sheet { background: #fff !important; border-color: #fff !important; }`}</style>
        )}
        {!track && <SamplePage />}
        {!framed && !track && (
          <div className="absolute inset-x-0 top-0 flex h-12 items-center gap-2 bg-background/90 px-3 backdrop-blur">
            <Link
              to="/debug/elements/sheets"
              aria-label="Back to sheet ideas"
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <span className="text-sm font-medium">Sheet motion</span>
          </div>
        )}
        {!auto && (
          <div className="absolute inset-x-0 bottom-0 flex gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button
              type="button"
              onClick={() => setOpen("menu")}
              className="h-11 flex-1 rounded-full bg-foreground text-[14px] font-medium text-background focus-visible:outline-2 focus-visible:outline-ring"
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => setOpen("list")}
              className="h-11 flex-1 rounded-full bg-foreground text-[14px] font-medium text-background focus-visible:outline-2 focus-visible:outline-ring"
            >
              List
            </button>
          </div>
        )}
        <DetentSheet
          isOpen={open === "menu"}
          onOpenChange={(next) => !next && setOpen(null)}
          title="Menu"
        >
          <div className="flex flex-col gap-1 px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {["Contents", "Search book", "Notebook", "Appearance"].map(
              (label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setOpen(label === "Notebook" ? "list" : null)}
                  className="h-12 rounded-2xl px-4 text-left text-[15px] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </DetentSheet>
        <DetentSheet
          isOpen={open === "list"}
          onOpenChange={(next) => !next && setOpen(null)}
          title="List"
          snapPoints={[MEDIUM_DETENT]}
        >
          <div className="flex gap-2 px-4 pb-3">
            {detentButton("full", "Full height")}
            {detentButton("medium", "Medium")}
          </div>
          <div
            data-detent-scroll=""
            className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4"
          >
            {Array.from({ length: 24 }, (_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/60 bg-secondary/25 px-4 py-3 text-[14px]"
              >
                Entry {index + 1}
              </div>
            ))}
          </div>
        </DetentSheet>
      </div>
    </SheetSpringContext.Provider>
  );
}
