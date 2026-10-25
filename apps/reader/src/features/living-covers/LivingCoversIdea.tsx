import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import type { Book } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DebugView } from "./engine/engine";
import { LivingCover } from "./LivingCover";
import { DEFAULT_SCENE, type CoverScene } from "./scene";
import { useSceneRegistry } from "./scene-registry";
import { TiltButton } from "./TiltButton";

/**
 * Living covers, three ways: one book to hold (`hero`), the Library's
 * covers (`grid`) and a book's own page (`detail`). Hand-made scenes come
 * first; the rest of the Library shows the automatic sheen.
 */

type Variant = "hero" | "grid" | "detail";

interface ShowcaseItem {
  key: string;
  title: string;
  author: string;
  coverUrl: string;
  scene: CoverScene;
  book: Book | null;
}

function useShowcase() {
  const registry = useSceneRegistry();
  const { data } = useBooksWithStatuses();
  const books = useMemo(() => data?.books ?? [], [data]);
  const { coverUrls } = useLibraryCoverUrls(books, {
    loadRemainingInBackground: true,
  });
  return useMemo(() => {
    if (!registry) return null;
    const used = new Set<string>();
    const scened: ShowcaseItem[] = [];
    for (const entry of registry) {
      const book =
        books.find(
          (item) =>
            item.cover && entry.scene.covers.includes(item.cover.fileId),
        ) ?? null;
      const coverUrl = (book && coverUrls.get(book.id)) ?? entry.coverUrl;
      if (!coverUrl) continue;
      if (book) used.add(book.id);
      scened.push({
        key: entry.scene.id,
        title: book?.title ?? entry.scene.title,
        author: book?.author ?? "",
        coverUrl,
        scene: entry.scene,
        book,
      });
    }
    // Yours first, then the public-domain showcase.
    scened.sort((a, b) => Number(!a.book) - Number(!b.book));
    const rest: ShowcaseItem[] = books
      .filter((book) => !used.has(book.id) && coverUrls.has(book.id))
      .map((book) => ({
        key: book.id,
        title: book.title,
        author: book.author,
        coverUrl: coverUrls.get(book.id)!,
        scene: DEFAULT_SCENE,
        book,
      }));
    return { scened, rest };
  }, [registry, books, coverUrls]);
}

export function LivingCoversIdea() {
  const [params] = useSearchParams();
  const variantParam = params.get("variant");
  const variant: Variant =
    variantParam === "grid" || variantParam === "detail"
      ? variantParam
      : "hero";
  const showcase = useShowcase();
  const framed = window.parent !== window;

  return (
    <div className="min-h-svh bg-background text-foreground">
      {!framed && (
        <div className="flex h-12 items-center gap-2 px-3">
          <Link
            to="/debug/elements/covers"
            aria-label="Back to Living covers ideas"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-sm font-medium">Living covers</span>
        </div>
      )}
      {!showcase ? (
        <p className="py-24 text-center text-sm text-muted-foreground">
          Finding scenes…
        </p>
      ) : variant === "grid" ? (
        <GridVariant items={[...showcase.scened, ...showcase.rest]} />
      ) : (
        <HeroVariant
          initial={params.get("scene")}
          items={
            showcase.scened.length > 0
              ? [...showcase.scened, ...showcase.rest.slice(0, 2)]
              : showcase.rest
          }
          detail={variant === "detail"}
        />
      )}
    </div>
  );
}

const VIEWS: { id: DebugView; label: string }[] = [
  { id: "lit", label: "Lit" },
  { id: "depth", label: "Depth" },
  { id: "materials", label: "Foil and life" },
];

function HeroVariant({
  items,
  detail,
  initial,
}: {
  items: ShowcaseItem[];
  detail: boolean;
  /** `?scene=` opens on that scene, for links and recordings. */
  initial: string | null;
}) {
  // Keep the chosen book by key: the order settles as the library loads.
  const [chosen, setChosen] = useState(initial);
  const [view, setView] = useState<DebugView>("lit");
  if (items.length === 0) {
    return (
      <p className="py-24 text-center text-sm text-muted-foreground">
        No covers yet.
      </p>
    );
  }
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === chosen),
  );
  const item = items[index]!;
  const handMade = item.scene !== DEFAULT_SCENE;
  const setIndex = (next: number) => setChosen(items[next]!.key);
  const step = (delta: number) =>
    setIndex((index + delta + items.length) % items.length);

  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col px-6",
        detail ? "pt-4" : "min-h-[calc(100svh-3rem)] justify-center pb-10",
      )}
    >
      <div className={cn("flex justify-center", detail ? "py-8" : "py-10")}>
        <LivingCover
          key={item.key}
          coverUrl={item.coverUrl}
          scene={item.scene}
          mode="hero"
          fit="fill"
          naturalAspect
          draggable
          debugView={view}
          className={cn(
            "rounded-[4px]",
            detail ? "w-[52%] max-w-[220px]" : "w-[68%] max-w-[300px]",
          )}
          style={{ aspectRatio: "2 / 3" }}
        />
      </div>

      {detail ? (
        <DetailText item={item} handMade={handMade} />
      ) : (
        <div className="text-center">
          <h1 className="font-serif text-[22px] leading-tight">{item.title}</h1>
          {item.author && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {item.author}
            </p>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">
            {handMade ? "Hand-made scene" : "Automatic sheen"} · drag to turn
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        <TiltButton />
        {handMade && (
          <div
            role="group"
            aria-label="Layer"
            className="flex items-center gap-1 rounded-full bg-secondary p-0.5"
          >
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className="h-7 rounded-full px-3 text-[12px] text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous book"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="w-14 text-center font-numeric text-[12px] text-muted-foreground tabular-nums">
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next book"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="-mx-6 mt-6 flex gap-2 overflow-x-auto px-6 pb-4 [scrollbar-width:none]">
        {items.map((other, otherIndex) => (
          <button
            key={other.key}
            type="button"
            aria-label={other.title}
            aria-pressed={otherIndex === index}
            onClick={() => setIndex(otherIndex)}
            className="h-[60px] w-[40px] shrink-0 overflow-hidden rounded-[2px] opacity-60 transition-opacity aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-2 aria-pressed:ring-offset-background"
          >
            <img
              src={other.coverUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function DetailText({
  item,
  handMade,
}: {
  item: ShowcaseItem;
  handMade: boolean;
}) {
  return (
    <div>
      <h1 className="text-center font-serif text-[26px] leading-tight text-balance">
        {item.title}
      </h1>
      {item.author && (
        <p className="mt-1.5 text-center text-[14px] text-muted-foreground">
          {item.author}
        </p>
      )}
      <div className="mt-6 flex justify-center">
        {item.book ? (
          <Link
            to={`/reader/${item.book.id}`}
            className="inline-flex h-10 items-center rounded-full bg-foreground px-6 text-[14px] font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Read
          </Link>
        ) : (
          <span className="inline-flex h-10 items-center rounded-full bg-secondary px-6 text-[13px] text-muted-foreground">
            Public-domain sample
          </span>
        )}
      </div>
      <dl className="mt-8 grid grid-cols-2 gap-y-3 border-t border-border pt-4 text-[13px]">
        <dt className="text-muted-foreground">Pages</dt>
        <dd className="text-right font-numeric tabular-nums">
          {item.scene.object.pages
            ? `About ${item.scene.object.pages}`
            : "Unknown"}
        </dd>
        <dt className="text-muted-foreground">Cover</dt>
        <dd className="text-right">
          {handMade ? "Hand-made scene" : "Automatic sheen"}
        </dd>
      </dl>
    </div>
  );
}

function GridVariant({ items }: { items: ShowcaseItem[] }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <div className="flex items-end justify-between gap-3 pt-2 pb-5">
        <h1 className="font-serif text-[28px] leading-none">Library</h1>
        <TiltButton />
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => {
          const cover = (
            <>
              <LivingCover
                coverUrl={item.coverUrl}
                scene={item.scene}
                mode="grid"
                className="aspect-[2/3] w-full rounded-[3px]"
              />
              <h3 className="mt-3 line-clamp-2 text-[13px] leading-snug">
                {item.title}
              </h3>
              {item.author && (
                <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                  {item.author}
                </span>
              )}
            </>
          );
          return (
            <li key={item.key} className="min-w-0">
              {item.book ? (
                <Link
                  to={`/reader/${item.book.id}`}
                  aria-label={`Open ${item.title}`}
                  className="block outline-none"
                >
                  {cover}
                </Link>
              ) : (
                cover
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
