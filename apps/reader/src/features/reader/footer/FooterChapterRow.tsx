import type { ChapterEntry } from "@/features/reader/types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { FOOTER_READY_DETAIL_DELAY } from "./FooterLoadingState";

// Touch targets reach 44 px. They extend up through the footer padding, short
// of the prompt stack above the footer, and stop at the scrubber's top edge.
// The 22 px chapter steps gain 17 px above and 5 px below; the 32 px title
// gains 12 px above.
const CHAPTER_STEP_TARGET =
  "relative before:absolute before:-inset-x-2 before:-top-[17px] before:-bottom-[5px] before:content-['']";
const CHAPTER_TITLE_TARGET =
  "relative before:absolute before:-inset-x-2 before:-top-3 before:bottom-0 before:content-['']";

interface FooterChapterRowProps {
  currentChapterIndex: number;
  currentChapterEndIndex: number;
  displayChapterIndex: number | null;
  detailCurrentChapterIndex?: number;
  detailCurrentChapterEndIndex?: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentPage: number;
  totalPages: number;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onOpenContents: () => void;
  isContentsOpen: boolean;
  isLoading?: boolean;
  showPageNumbers?: boolean;
  preserveDetailsWhileLoading?: boolean;
  animateReadyDetails?: boolean;
}

export function FooterChapterRow({
  currentChapterIndex,
  currentChapterEndIndex,
  displayChapterIndex,
  detailCurrentChapterIndex,
  detailCurrentChapterEndIndex,
  chapterEntries,
  chapterStartPages,
  currentPage,
  totalPages,
  onGoToChapter,
  onPrevChapter,
  onOpenContents,
  isContentsOpen,
  isLoading = false,
  showPageNumbers = true,
  preserveDetailsWhileLoading = false,
  animateReadyDetails = false,
}: FooterChapterRowProps) {
  const metricsChapterIndex = detailCurrentChapterIndex ?? currentChapterIndex;
  const metricsChapterEndIndex = Math.max(
    metricsChapterIndex,
    detailCurrentChapterEndIndex ?? currentChapterEndIndex,
  );
  // In multi-column spreads, the next chapter may already be visible in a later
  // slot. Keep the CTA actionable by targeting the first chapter not currently
  // visible on the spread.
  const nextActionableChapterIndex = metricsChapterEndIndex + 1;
  const hasPrev = metricsChapterIndex > 0;
  const hasNext = nextActionableChapterIndex < chapterEntries.length;
  const showBlurredLoadingDetails = isLoading && preserveDetailsWhileLoading;
  const showDetails = !isLoading || showBlurredLoadingDetails;

  const prevChapterStart = chapterStartPages[metricsChapterIndex - 1];
  const currentChapterStart = chapterStartPages[metricsChapterIndex];
  const nextChapterStart = hasNext
    ? chapterStartPages[nextActionableChapterIndex]
    : null;

  const pagesFromCurrentChapterStart =
    currentChapterStart != null ? currentPage - currentChapterStart : null;
  const isPastCurrentChapterStart =
    pagesFromCurrentChapterStart != null && pagesFromCurrentChapterStart > 0;
  const pagesBack = isPastCurrentChapterStart
    ? pagesFromCurrentChapterStart
    : prevChapterStart != null
      ? currentPage - prevChapterStart
      : null;
  const pagesForward =
    nextChapterStart != null
      ? nextChapterStart - currentPage
      : hasNext
        ? null
        : totalPages - currentPage;

  const handlePrevClick = () => {
    if (isPastCurrentChapterStart) {
      onGoToChapter(metricsChapterIndex);
      return;
    }
    onPrevChapter();
  };

  const handleNextClick = () => {
    if (!hasNext) return;
    onGoToChapter(nextActionableChapterIndex);
  };

  const currentChapterTitle =
    displayChapterIndex != null
      ? (chapterEntries[displayChapterIndex]?.title ?? "")
      : "";

  return (
    // relative container: buttons sit at edges, title is absolutely centered
    <div className="relative flex h-8 items-center">
      {/* Prev chapter — hidden entirely when not available */}
      <AnimatePresence initial={false}>
        {hasPrev && showDetails && (
          <motion.button
            key="prev"
            onClick={handlePrevClick}
            className={cn(
              CHAPTER_STEP_TARGET,
              "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-numeric tabular-nums text-muted-foreground transition-[background-color,color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:active:scale-100",
              showBlurredLoadingDetails
                ? "pointer-events-none"
                : "hover:bg-secondary/70 hover:text-foreground",
            )}
            aria-label={
              isPastCurrentChapterStart
                ? "Start of current chapter"
                : "Previous chapter"
            }
            disabled={showBlurredLoadingDetails}
            initial={
              animateReadyDetails ? { opacity: 0, filter: "blur(8px)" } : false
            }
            animate={{
              opacity: showBlurredLoadingDetails ? 0.76 : 1,
              filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
            }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={
              animateReadyDetails || showBlurredLoadingDetails
                ? {
                    duration: 0.24,
                    delay: FOOTER_READY_DETAIL_DELAY,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : undefined
            }
          >
            <ChevronLeft className="size-3.5 flex-shrink-0" />
            {showPageNumbers && pagesBack !== null && pagesBack > 0 && (
              <span className="leading-none">{pagesBack}p</span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chapter title — absolutely centered so it's unaffected by button presence */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-20">
        <AnimatePresence mode="wait" initial={false}>
          {currentChapterTitle && (
            <motion.button
              key={displayChapterIndex ?? "unknown"}
              type="button"
              onClick={onOpenContents}
              disabled={showBlurredLoadingDetails}
              aria-label="Open table of contents"
              aria-haspopup="dialog"
              aria-expanded={isContentsOpen}
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{
                opacity: showBlurredLoadingDetails ? 0.76 : 1,
                y: 0,
                scale: isContentsOpen ? 1.03 : 1,
                filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
              }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              whileHover={
                showBlurredLoadingDetails ? undefined : { scale: 1.03 }
              }
              whileTap={showBlurredLoadingDetails ? undefined : { scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className={cn(
                CHAPTER_TITLE_TARGET,
                "pointer-events-auto flex min-h-8 max-w-full min-w-0 items-center justify-center rounded-full px-2.5 py-1 text-[10px] font-medium uppercase leading-tight tracking-[0.16em] text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                showBlurredLoadingDetails
                  ? "pointer-events-none"
                  : "hover:bg-secondary/70 hover:text-foreground",
                isContentsOpen &&
                  "bg-secondary/70 text-foreground shadow-sm ring-1 ring-border/70",
              )}
            >
              <span className="truncate">{currentChapterTitle}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Next chapter — hidden entirely when not available */}
      <AnimatePresence initial={false}>
        {hasNext && showDetails && (
          <motion.button
            key="next"
            onClick={handleNextClick}
            className={cn(
              CHAPTER_STEP_TARGET,
              "ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-numeric tabular-nums text-muted-foreground transition-[background-color,color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:active:scale-100",
              showBlurredLoadingDetails
                ? "pointer-events-none"
                : "hover:bg-secondary/70 hover:text-foreground",
            )}
            aria-label="Next chapter"
            disabled={showBlurredLoadingDetails}
            initial={
              animateReadyDetails ? { opacity: 0, filter: "blur(8px)" } : false
            }
            animate={{
              opacity: showBlurredLoadingDetails ? 0.76 : 1,
              filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
            }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={
              animateReadyDetails || showBlurredLoadingDetails
                ? {
                    duration: 0.24,
                    delay: FOOTER_READY_DETAIL_DELAY,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : undefined
            }
          >
            {showPageNumbers && pagesForward !== null && pagesForward > 0 && (
              <span className="leading-none">{pagesForward}p</span>
            )}
            <ChevronRight className="size-3.5 flex-shrink-0" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
