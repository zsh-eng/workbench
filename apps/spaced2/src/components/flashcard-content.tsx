import { drawDiagrams, type DiagramOpen } from "@/lib/markdown/diagrams";
import { useRenderedCard } from "@/lib/markdown/cards";
import { cn } from "@/lib/utils";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

const DiagramDialog = lazy(() => import("@/components/diagram-dialog"));
const stop = (event: SyntheticEvent) => event.stopPropagation();

type Large = {
  source: Parameters<DiagramOpen>[0];
  natural: Parameters<DiagramOpen>[1];
};

/**
 * A card side's rendered Markdown (lib/markdown). It is empty for the few
 * milliseconds until the worker's HTML is ready; review preloads the next
 * cards, so they paint at once. Mermaid blocks draw here, with Pele.
 */
export function CardMarkdown({
  content,
  className,
  keepPrevious,
}: {
  content: string;
  className?: string;
  /** Show the last content until this one renders, as a preview does. */
  keepPrevious?: boolean;
}) {
  const card = useRenderedCard(content, { keepPrevious });
  const ref = useRef<HTMLElement>(null);
  const [large, setLarge] = useState<Large | null>(null);
  const html = card?.html ?? "";
  useEffect(() => {
    if (!card?.diagrams.length || !ref.current) return;
    const undo = drawDiagrams(ref.current, (source, natural) =>
      setLarge({ source, natural }),
    );
    return () => {
      undo();
      // Another card's diagram never stays open over this one.
      setLarge(null);
    };
    // The HTML, not the card object: an equal card draws once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return (
    <>
      <article
        ref={ref}
        className={cn("card-markdown", className)}
        aria-busy={card ? undefined : true}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {large && (
        // React events bubble out of a portal to its React parents: a tap in
        // the dialog would reach the card form's preview, and a key the
        // review's grade shortcuts. Stopping them here also stops the native
        // event at the portal's container.
        <span
          className="contents"
          onClick={stop}
          onPointerDown={stop}
          onContextMenu={stop}
          onKeyDown={stop}
          onKeyUp={stop}
        >
          <Suspense fallback={null}>
            <DiagramDialog
              source={large.source}
              natural={large.natural}
              onClose={() => setLarge(null)}
            />
          </Suspense>
        </span>
      )}
    </>
  );
}

export default function FlashcardContent({ content }: { content: string }) {
  // We can't use justify-center here because it prevents scrolling to the top of the container
  // when the container overflows.
  // See this https://stackoverflow.com/questions/33454533/cant-scroll-to-top-of-flex-item-that-is-overflowing-container

  // To solve this we add 2 pseudo elements that take up the remaining height
  // and only use `items-center` to center horizontally.
  return (
    <CardMarkdown
      content={content}
      className={cn(
        'prose min-h-96 h-[55dvh] overflow-y-auto flex flex-col flex-1 p-2 rounded-none w-full animate-in fade-in before:content-[""] after:content-[""] before:flex-1 after:flex-1 items-center prose-img:rounded-lg transition-all duration-300',
        "sm:h-[400px] sm:shadow-xs",
        "sm:dark:bg-muted/20 sm:border dark:border-none dark:text-foreground dark:prose-p:text-foreground dark:prose-strong:text-foreground dark:prose-li:text-foreground dark:prose-code:text-foreground dark:prose-pre:text-foreground dark:prose-ul:text-foreground dark:prose-ol:text-foreground",
      )}
    />
  );
}
