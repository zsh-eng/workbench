import { APP_PAGE_FRAME, APP_TITLE_TYPE } from "@/components/app-header-styles";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import type { Book } from "@/lib/db";
import { MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { ActivityEnvironmentProvider } from "../ActivityContext";
import { ActivityGlyph } from "../ActivityGlyph";
import { CoverActivity } from "../CoverActivity";
import { UpdateChip } from "../UpdateChip";
import { ActivityIsland } from "./ActivityIsland";
import { SAMPLE_BOOKS } from "./sample-books";
import { SimCover, Ticks } from "./SimCover";
import {
  createSimulation,
  SCENARIOS,
  type ScenarioId,
  type SimBook,
  type Simulation,
} from "./simulation";

export type BackgroundIdeaId = "covers" | "island" | "glyph";

interface Look {
  title: string;
  author: string;
  coverUrl?: string;
  tone?: string;
}

/** Your books when this browser has enough, else public-domain samples. */
function useIdeaBooks(): {
  books: readonly SimBook[] | null;
  looks: Map<string, Look>;
} {
  const { data } = useBooksWithStatuses();
  const own: Book[] = useMemo(
    () => (data && data.books.length >= 6 ? data.books.slice(0, 12) : []),
    [data],
  );
  const { coverUrls } = useLibraryCoverUrls(own, {
    loadRemainingInBackground: true,
  });
  const books = useMemo((): readonly SimBook[] | null => {
    if (!data) return null;
    if (own.length === 0) return SAMPLE_BOOKS;
    return own.map((book, index) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      size: 900_000 + ((index * 1_337_101) % 3_900_000),
    }));
  }, [data, own]);
  const looks = useMemo(
    () =>
      own.length === 0
        ? new Map<string, Look>(SAMPLE_BOOKS.map((book) => [book.id, book]))
        : new Map<string, Look>(
            own.map((book) => [
              book.id,
              {
                title: book.title,
                author: book.author,
                coverUrl: coverUrls.get(book.id),
              },
            ]),
          ),
    [coverUrls, own],
  );
  return { books, looks };
}

/** Taps through every scenario once, the same way for each idea. */
const AUTO_RUN: Record<
  BackgroundIdeaId,
  [seconds: number, step: ScenarioId | `tap:${string}` | "escape"][]
> = {
  covers: [
    [0.6, "new-device"],
    [5.0, "download"],
    [11.5, "offline"],
    [21.0, "update"],
    [25.5, "tap:button[title^='A new version']"],
    [29.5, "failure"],
    [34.0, "tap:[aria-label^='Retry ']"],
  ],
  island: [
    [0.6, "new-device"],
    [5.0, "download"],
    [7.5, "tap:[aria-label='Open activity']"],
    [9.5, "tap:[data-activity-island] button:not([aria-label])"],
    [11.5, "offline"],
    [21.0, "update"],
    [25.5, "tap:[data-island-restart]"],
    [29.5, "failure"],
    [34.0, "tap:[data-island-retry]"],
  ],
  glyph: [
    [0.6, "new-device"],
    [5.0, "download"],
    [7.0, "tap:[data-activity-glyph]"],
    [9.5, "escape"],
    [11.5, "offline"],
    [21.0, "update"],
    [24.5, "tap:[data-activity-glyph]"],
    [25.8, "tap:[data-activity-restart]"],
    [29.5, "failure"],
    [33.0, "tap:[data-activity-glyph]"],
    [34.2, "tap:[aria-label^='Retry ']"],
    [36.0, "escape"],
  ],
};

/**
 * Design ideas → Background activity. The Library at phone size, with the
 * real engine on simulated jobs: `covers` keeps progress on each book's
 * cover, `island` gathers it into one floating island, and `glyph` puts it
 * behind a glyph and a sheet. `?run=auto` taps through every scenario.
 */
export function BackgroundActivityIdea() {
  const [params] = useSearchParams();
  const raw = params.get("idea");
  const idea: BackgroundIdeaId =
    raw === "island" || raw === "glyph" ? raw : "covers";
  const { books, looks } = useIdeaBooks();
  const [sim, setSim] = useState<Simulation | null>(null);
  useEffect(() => {
    if (!books) return;
    const next = createSimulation(books);
    setSim(next);
    return () => next.dispose();
  }, [books]);

  const auto = params.get("run") === "auto";
  useEffect(() => {
    if (!auto || !sim) return;
    const timers = AUTO_RUN[idea].map(([at, step]) =>
      window.setTimeout(() => {
        if (step === "escape")
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        else if (step.startsWith("tap:"))
          document.querySelector<HTMLElement>(step.slice(4))?.click();
        else sim.run(step as ScenarioId);
      }, at * 1000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [auto, idea, sim]);

  if (!sim)
    return (
      <p className="p-8 text-sm text-muted-foreground">Loading your books…</p>
    );
  return (
    <ActivityEnvironmentProvider value={sim.environment}>
      <IdeaLibrary sim={sim} idea={idea} looks={looks} />
      {idea === "island" && <ActivityIsland sim={sim} looks={looks} />}
    </ActivityEnvironmentProvider>
  );
}

function ScenarioBar({ sim }: { sim: Simulation }) {
  return (
    <div className="sticky top-0 z-40 border-b border-dashed border-border bg-background/92 backdrop-blur">
      <div
        className={cn(
          APP_PAGE_FRAME,
          "flex items-center gap-1.5 overflow-x-auto py-2 [scrollbar-width:none]",
        )}
        role="group"
        aria-label="Scenarios"
      >
        <span className="mr-1 shrink-0 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Try
        </span>
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => sim.run(scenario.id)}
            className="h-7 shrink-0 rounded-full bg-foreground/[0.06] px-2.5 text-[12px] whitespace-nowrap text-foreground outline-none hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {scenario.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => sim.reset()}
          className="h-7 shrink-0 rounded-full px-2.5 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function IdeaLibrary({
  sim,
  idea,
  looks,
}: {
  sim: Simulation;
  idea: BackgroundIdeaId;
  looks: ReadonlyMap<string, Look>;
}) {
  const world = useSyncExternalStore(sim.subscribe, sim.getWorld);
  const shownBooks = world.arrived
    ? sim.books.filter((book) => world.arrived!.includes(book.id))
    : sim.books;
  const here = sim.books.filter((book) => world.onDevice.has(book.id)).length;
  // On the covers, the page itself says what the shelf can do right now.
  const subline =
    idea !== "covers"
      ? null
      : world.arrived
        ? `Restoring your library · ${world.arrived.length} ${world.arrived.length === 1 ? "book" : "books"}`
        : !world.online
          ? `Offline · ${here} ${here === 1 ? "book" : "books"} on this device`
          : null;

  return (
    <div className="min-h-dvh bg-background pb-28">
      <ScenarioBar sim={sim} />
      <header className={cn(APP_PAGE_FRAME, "pt-4 pb-2")} data-sim-header="">
        <div className="flex h-10 items-center justify-between gap-3">
          <h1 className={cn(APP_TITLE_TYPE, "text-foreground")}>Library</h1>
          <div className="flex items-center gap-0.5">
            {idea === "covers" && <UpdateChip className="mr-1" />}
            {idea === "glyph" && <ActivityGlyph includeUpdate />}
            <span
              aria-hidden="true"
              className="ml-1 grid size-8 place-items-center rounded-full bg-secondary text-[12px] font-medium text-secondary-foreground"
            >
              R
            </span>
          </div>
        </div>
        <p
          aria-live="polite"
          className="mt-1 h-5 text-[12.5px] text-muted-foreground tabular-nums"
        >
          {subline}
        </p>
      </header>
      <ul
        className={cn(
          APP_PAGE_FRAME,
          "mt-3 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:gap-x-8",
        )}
      >
        <AnimatePresence initial={false}>
          {shownBooks.map((book) => {
            const look = looks.get(book.id) ?? book;
            const onDevice = world.onDevice.has(book.id);
            const pending = world.pending.get(book.id) ?? 0;
            const synced = world.synced.has(book.id);
            const faded = idea === "covers" && !world.online && !onDevice;
            return (
              <motion.li
                key={book.id}
                className="relative min-w-0"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: MOTION.enter }}
              >
                <button
                  type="button"
                  onClick={() => sim.download(book.id)}
                  aria-label={
                    onDevice
                      ? book.title
                      : `${book.title}, not on this device. Download it.`
                  }
                  className="block w-full rounded-[3px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
                >
                  <span
                    data-sim-cover={book.id}
                    className={cn(
                      "block aspect-[2/3] w-full overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.1),0_10px_22px_-14px_rgb(0_0_0/0.4)] transition-[opacity,filter] duration-200",
                      faded && "opacity-35 grayscale",
                    )}
                  >
                    <SimCover {...look} className="size-full" />
                  </span>
                  <h3 className="mt-3 line-clamp-2 text-[13px] leading-snug font-normal">
                    {book.title}
                  </h3>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {book.author}
                  </span>
                </button>
                {idea === "covers" && (
                  <CoverActivity
                    bookId={book.id}
                    className="inset-x-0 top-0 aspect-[2/3] overflow-hidden rounded-[3px]"
                  />
                )}
                {idea === "covers" && (pending > 0 || synced) && (
                  <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[2/3] items-end p-1.5">
                    <Ticks synced={synced} />
                  </span>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
