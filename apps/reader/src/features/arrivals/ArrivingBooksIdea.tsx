import { COVER_SHADOW, BookCover } from "@/features/library/LibraryBooks";
import { ArrivalRecords } from "@/lib/book-arrivals";
import type { Book } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useDemoPlayer } from "@workbench/elements/react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  createArrivalDemo,
  loadSceneAssets,
  SCENARIOS,
  type ArrivalDemo,
  type ScenarioId,
  type SceneAssets,
} from "./arrival-demo";
import {
  ArrivalProvider,
  type Arrival,
  type ArrivalLook,
} from "./arrival-store";
import { ArrivalSheet } from "./ArrivalSheet";
import { ArrivalTile, useArrivalGrid } from "./ArrivalTile";

/**
 * Design ideas → Arriving books. A phone's Library receiving one book, one
 * it already has, five, or a slow, a failed and a duplicate one, in each
 * look. One book on its own arrives in the arrival sheet, in ink; several
 * arrive in the grid in the chosen look. The imports are simulated, but
 * they run through the real job queue, the real places in the grid and the
 * real drawing; `today` is what ships: nothing until a book is done, then
 * its cover.
 */

type IdeaLook = ArrivalLook | "today";

const LOOKS: { id: IdeaLook; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "light", label: "Raking light" },
  { id: "develop", label: "Develop" },
  { id: "ink", label: "Ink" },
  { id: "calm", label: "Calm (CSS)" },
  { id: "still", label: "Reduced motion" },
];

function isLook(value: string | null): value is IdeaLook {
  return LOOKS.some((look) => look.id === value);
}

function isScenario(value: string | null): value is ScenarioId {
  return SCENARIOS.some((scenario) => scenario.id === value);
}

export function ArrivingBooksIdea() {
  const [params, setParams] = useSearchParams();
  const lookParam = params.get("look");
  const look: IdeaLook = isLook(lookParam) ? lookParam : "light";
  const scenarioParam = params.get("state");
  const scenario: ScenarioId = isScenario(scenarioParam)
    ? scenarioParam
    : "five";
  const framed = window.parent !== window;
  const demo = useDemoPlayer();
  const [assets, setAssets] = useState<Map<string, SceneAssets> | null>(null);
  useEffect(() => {
    void loadSceneAssets().then(setAssets);
  }, []);
  const choose = (key: "look" | "state", value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      {!framed && (
        <div className="flex h-12 items-center gap-2 px-3">
          <Link
            to="/debug/elements/arriving"
            aria-label="Back to Arriving books ideas"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-sm font-medium">Arriving books</span>
        </div>
      )}
      <div className="mx-auto max-w-5xl px-4 pb-24 md:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          <div
            role="group"
            aria-label="Import"
            className="flex flex-wrap gap-1.5"
          >
            {SCENARIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === scenario}
                onClick={() =>
                  item.id === scenario
                    ? demo.player.restart()
                    : choose("state", item.id)
                }
                className={cn(
                  "h-8 rounded-full px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.id === scenario
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            {...demo.restartButtonProps("Replay")}
            className="flex h-8 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Replay
          </button>
        </div>
        {!framed && (
          <div
            role="group"
            aria-label="Look"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {LOOKS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === look}
                onClick={() => choose("look", item.id)}
                className={cn(
                  "h-7 rounded-full px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.id === look
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <div
          ref={demo.stageRef}
          {...demo.stageProps()}
          className="outline-none"
        >
          {assets ? (
            <DemoLibrary
              scenario={scenario}
              look={look}
              run={demo.state.run}
              assets={assets}
            />
          ) : (
            <p className="py-24 text-center text-sm text-muted-foreground">
              Finding covers…
            </p>
          )}
        </div>
        {assets && look !== "today" && <Moments look={look} assets={assets} />}
      </div>
    </div>
  );
}

/**
 * A fresh demo world for each run, look and scenario; Strict Mode's second
 * mount gets its own. The last world stays on screen until the next one
 * exists, so a replay does not empty the page for a frame.
 */
function useDemo(
  scenario: ScenarioId,
  look: IdeaLook,
  run: number,
  assets: Map<string, SceneAssets>,
) {
  const [demo, setDemo] = useState<ArrivalDemo | null>(null);
  useEffect(() => {
    const created = createArrivalDemo(scenario, assets, look !== "today");
    setDemo(created);
    return () => created.dispose();
  }, [assets, look, run, scenario]);
  return demo;
}

/** The Library's grid at this size, receiving the scenario's files. */
function DemoLibrary({
  scenario,
  look,
  run,
  assets,
}: {
  scenario: ScenarioId;
  look: IdeaLook;
  run: number;
  assets: Map<string, SceneAssets>;
}) {
  const demo = useDemo(scenario, look, run, assets);
  return demo ? <DemoWorld key={demo.id} demo={demo} look={look} /> : null;
}

function DemoWorld({ demo, look }: { demo: ArrivalDemo; look: IdeaLook }) {
  // What ships draws nothing while it imports, so it reads no records.
  const [silent] = useState(() => new ArrivalRecords());
  const added = useSyncExternalStore(demo.added.subscribe, demo.added.get);
  const shown = useMemo(() => [...added, ...demo.shelf], [added, demo.shelf]);
  // One book on its own arrives in the arrival sheet, which needs no toast.
  const single = demo.keys.length === 1 && look !== "today";
  const [sheetKey, setSheetKey] = useState(single ? demo.keys[0]! : null);
  useEffect(() => {
    if (single) return;
    let cancelled = false;
    void demo.finished.then(({ added, duplicates, failed }) => {
      if (cancelled) return;
      const parts = [
        added && `Added ${added} book${added === 1 ? "" : "s"}`,
        duplicates && `skipped ${duplicates}`,
        failed && `failed ${failed}`,
      ].filter(Boolean);
      const message = parts.join("; ");
      toast.success(`${message.charAt(0).toUpperCase()}${message.slice(1)}.`, {
        id: "arriving-books-demo",
        duration: 3000,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [demo, single]);
  return (
    <ArrivalProvider
      records={look === "today" ? silent : demo.records}
      source={demo.manager}
      look={look === "today" ? "still" : look}
      reliefFor={demo.reliefFor}
    >
      <section aria-label="Library" className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-[26px] leading-none">Library</h2>
          <span className="font-numeric text-[12px] text-muted-foreground tabular-nums">
            {shown.length} books
          </span>
        </div>
        <DemoGrid shown={shown} coverUrls={demo.coverUrls} />
      </section>
      {sheetKey && (
        <ArrivalSheet
          key={sheetKey}
          arrivalKey={sheetKey}
          onOpenBook={(_, title) =>
            toast(`Read now opens ${title || "the book"} in the Reader.`, {
              id: "arriving-books-demo",
            })
          }
          onDone={() => setSheetKey(null)}
          coverUrlFor={(bookId) => demo.coverUrls.get(bookId)}
          look={look === "still" || look === "calm" ? look : "ink"}
        />
      )}
    </ArrivalProvider>
  );
}

function DemoGrid({
  shown,
  coverUrls,
}: {
  shown: readonly Book[];
  coverUrls: Map<string, string>;
}) {
  const items = useArrivalGrid(shown, true);
  return (
    <ul className="mt-6 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:gap-x-8">
      {items.map((item) =>
        "book" in item ? (
          <DemoBookTile
            key={item.book.id}
            book={item.book}
            coverUrl={coverUrls.get(item.book.id)}
          />
        ) : (
          <ArrivalTile key={item.arrivalKey} arrivalKey={item.arrivalKey} />
        ),
      )}
    </ul>
  );
}

/** The Library's tile without its link and menu: the real cover. */
function DemoBookTile({
  book,
  coverUrl,
}: {
  book: Book;
  coverUrl: string | undefined;
}) {
  return (
    <li className="relative min-w-0" data-demo-book={book.title}>
      <BookCover
        book={book}
        coverUrl={coverUrl}
        className={cn("aspect-[2/3] w-full rounded-[3px]", COVER_SHADOW)}
      />
      <h3 className="mt-3 line-clamp-2 text-[13px] leading-snug font-normal">
        {book.title}
      </h3>
      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
        {book.author}
      </span>
    </li>
  );
}

const MOMENTS = [0.15, 0.35, 0.55, 0.75, 0.9, 1];

/**
 * One cover at six moments of its arrival, from the cover being found to
 * the book at rest, drawn by the same engine and held still.
 */
function Moments({
  look,
  assets,
}: {
  look: ArrivalLook;
  assets: Map<string, SceneAssets>;
}) {
  const [scene, setScene] = useState("alice");
  const asset = assets.get(scene);
  const [cover, setCover] = useState<Blob | null>(null);
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    void fetch(asset.coverUrl)
      .then((response) => response.blob())
      .then((blob) => {
        if (!cancelled) setCover(blob);
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);
  if (look === "calm" || look === "still") return null;
  return (
    <section aria-label="Moments" className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Six moments</h2>
        <div className="flex gap-1.5">
          {[...assets.keys()].map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === scene}
              onClick={() => setScene(id)}
              className={cn(
                "h-7 rounded-full px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                id === scene
                  ? "bg-secondary font-medium"
                  : "text-muted-foreground",
              )}
            >
              {id.replace(/-/g, " ")}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        From the moment the import finds the cover to the book at rest.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {cover &&
          MOMENTS.map((reveal) => (
            <StillMoment
              key={`${scene}:${look}:${reveal}`}
              look={look}
              reveal={reveal}
              cover={cover}
              relief={asset?.relief ?? null}
            />
          ))}
      </div>
    </section>
  );
}

function StillMoment({
  look,
  reveal,
  cover,
  relief,
}: {
  look: "develop" | "light" | "ink";
  reveal: number;
  cover: Blob;
  relief: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [key] = useState(() => `moment:${Math.random()}`);
  useLayoutEffect(() => {
    const element = canvas.current;
    const slot = element?.parentElement;
    if (!element || !slot) return;
    let detach = () => {};
    let cancelled = false;
    void import("./engine/arrival-engine").then(({ engine }) => {
      if (cancelled) return;
      const arrival: Pick<Arrival, "progress" | "changedAt"> = {
        progress: { stage: "preparing", fraction: 0.55 },
        changedAt: performance.now(),
      };
      detach = engine.attach({
        key,
        canvas: element,
        slot,
        direction: look,
        read: () => ({ ...arrival, cover, relief }),
        onRest: () => {},
        fixed: 0.55 + 0.45 * reveal,
      });
    });
    return () => {
      cancelled = true;
      detach();
    };
  }, [cover, key, look, relief, reveal]);
  return (
    <figure>
      <span
        className={cn(
          "relative block aspect-[2/3] overflow-hidden rounded-[3px] bg-secondary",
          COVER_SHADOW,
        )}
      >
        <canvas ref={canvas} className="absolute inset-0 size-full" />
      </span>
      <figcaption className="mt-1.5 text-center font-numeric text-[11px] text-muted-foreground tabular-nums">
        {Math.round(reveal * 100)}%
      </figcaption>
    </figure>
  );
}
