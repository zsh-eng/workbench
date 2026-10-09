import type { ReaderChromeSurfaceProps } from "@/features/reader/chrome";
import { MOTION } from "@/lib/motion";
import type {
  ChapterEntry,
  ReaderHandoffPrompt,
} from "@/features/reader/types";
import type { ReaderStatusAction } from "../hooks/use-reader-status-prompt";
import { FooterStatusPrompt } from "./FooterStatusPrompt";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";
import { FooterChapterRow } from "./FooterChapterRow";
import { FooterHandoffPrompt } from "./FooterHandoffPrompt";
import { FooterScrubberLoading } from "./FooterLoadingState";
import { FooterPageIndicator } from "./FooterPageIndicator";
import { FooterScrubberCanvas } from "./FooterScrubberCanvas";

export interface ReaderFooterProps {
  /** Another bottom surface owns the viewport; omit even the exit animation. */
  suppressed?: boolean;
  chromeVisible: boolean;
  isMobile: boolean;
  chromeSurfaceProps?: ReaderChromeSurfaceProps;
  currentPage: number;
  pageStep?: number;
  totalPages: number;
  currentChapterIndex: number;
  currentChapterEndIndex: number;
  displayChapterIndex: number | null;
  isContentsOpen: boolean;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  onScrubPreview: (page: number) => void;
  onScrubCommit: (page: number) => void;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onOpenContents: () => void;
  /** The Notes Island capsule. It rides on the footer while the chrome shows. */
  noteAccessory?: ReactNode;
  handoffPrompt?: ReaderHandoffPrompt;
  statusPrompt?: ReaderStatusAction;
  isLoading?: boolean;
  showPageNumbers?: boolean;
  /** Progress content shared by the Reader and debug playground. */
  pageIndicator?: ReactNode;
}

export function ReaderFooter({
  suppressed = false,
  chromeVisible,
  isMobile,
  chromeSurfaceProps,
  currentPage,
  pageStep = 1,
  totalPages,
  currentChapterIndex,
  currentChapterEndIndex,
  displayChapterIndex,
  isContentsOpen,
  chapterEntries,
  chapterStartPages,
  onScrubPreview,
  onScrubCommit,
  onGoToChapter,
  onPrevChapter,
  onOpenContents,
  noteAccessory,
  handoffPrompt,
  statusPrompt,
  isLoading = false,
  showPageNumbers = true,
  pageIndicator,
}: ReaderFooterProps) {
  const [cancelMomentumSignal, setCancelMomentumSignal] = useState(0);
  const animateReadyTransition = false;
  const animateLoadingTransition = false;
  const preserveDetailsWhileLoading = false;

  const interruptScrubberMomentum = useCallback(() => {
    setCancelMomentumSignal((signal) => signal + 1);
  }, []);

  const handleGoToChapter = useCallback(
    (chapterIndex: number) => {
      interruptScrubberMomentum();
      onGoToChapter(chapterIndex);
    },
    [interruptScrubberMomentum, onGoToChapter],
  );

  const handlePrevChapter = useCallback(() => {
    interruptScrubberMomentum();
    onPrevChapter();
  }, [interruptScrubberMomentum, onPrevChapter]);

  const detailCurrentPage = currentPage;
  const detailTotalPages = totalPages;
  const detailCurrentChapterIndex = currentChapterIndex;
  const detailCurrentChapterEndIndex = currentChapterEndIndex;
  const detailChapterStartPages = chapterStartPages;
  const shouldRenderChromeShell =
    chromeVisible || handoffPrompt !== undefined || statusPrompt !== undefined;

  if (suppressed) return null;

  return (
    <AnimatePresence>
      {shouldRenderChromeShell && (
        <motion.div
          key={isMobile ? "mobile-footer" : "desktop-footer"}
          data-reader-footer=""
          initial={isMobile ? { y: "100%", opacity: 0 } : { opacity: 0 }}
          animate={
            isMobile
              ? {
                  y: chromeVisible ? 0 : "100%",
                  opacity: 1,
                  transition: {
                    y: MOTION.chromeEnter,
                    opacity: MOTION.chromeFadeIn,
                  },
                }
              : { opacity: 1, transition: MOTION.desktopChromeFade }
          }
          exit={
            isMobile
              ? {
                  y: "100%",
                  opacity: 0,
                  transition: {
                    y: MOTION.chromeExit,
                    opacity: MOTION.chromeFadeOut,
                  },
                }
              : { opacity: 0, transition: MOTION.desktopChromeFade }
          }
          className="absolute inset-x-0 bottom-0 z-20 overflow-visible border-t border-border/70 bg-background/88 backdrop-blur-xl"
          {...chromeSurfaceProps}
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
          }}
        >
          <div
            // A capsule action stops a scrubber fling before it opens notes.
            onClickCapture={interruptScrubberMomentum}
            className={`pointer-events-none absolute inset-x-0 flex flex-col gap-2 transition-[bottom] duration-200 ease-out ${
              chromeVisible
                ? "bottom-[calc(100%+0.5rem)]"
                : "bottom-[calc(100%+0.75rem)]"
            }`}
          >
            {noteAccessory && chromeVisible && noteAccessory}
            <AnimatePresence initial={false}>
              {!handoffPrompt && statusPrompt && (
                <FooterStatusPrompt key="status-prompt" prompt={statusPrompt} />
              )}
              {handoffPrompt && (
                <FooterHandoffPrompt
                  key="handoff-prompt"
                  prompt={handoffPrompt}
                />
              )}
            </AnimatePresence>
          </div>

          <div
            inert={!chromeVisible}
            className="mx-auto flex max-w-7xl flex-col px-3 pt-1 sm:px-4"
          >
            <FooterChapterRow
              currentChapterIndex={currentChapterIndex}
              displayChapterIndex={displayChapterIndex}
              chapterEntries={chapterEntries}
              detailCurrentChapterIndex={detailCurrentChapterIndex}
              currentChapterEndIndex={currentChapterEndIndex}
              detailCurrentChapterEndIndex={detailCurrentChapterEndIndex}
              chapterStartPages={detailChapterStartPages}
              showPageNumbers={showPageNumbers}
              currentPage={detailCurrentPage}
              totalPages={detailTotalPages}
              onGoToChapter={handleGoToChapter}
              onPrevChapter={handlePrevChapter}
              onOpenContents={onOpenContents}
              isContentsOpen={isContentsOpen}
              isLoading={isLoading}
              preserveDetailsWhileLoading={preserveDetailsWhileLoading}
              animateReadyDetails={animateReadyTransition}
            />
            <div className="px-1">
              <div className="relative h-14">
                <AnimatePresence>
                  {isLoading ? (
                    <motion.div
                      key="loading"
                      className="absolute inset-0"
                      initial={
                        animateLoadingTransition
                          ? { opacity: 0, filter: "blur(6px)" }
                          : false
                      }
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, filter: "blur(6px)" }}
                      transition={
                        animateLoadingTransition
                          ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                          : undefined
                      }
                    >
                      <FooterScrubberLoading />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="ready"
                      className="absolute inset-0"
                      initial={
                        animateReadyTransition
                          ? {
                              opacity: 0,
                              filter: "blur(8px)",
                              clipPath: "inset(0 50% 0 50%)",
                            }
                          : false
                      }
                      animate={{
                        opacity: 1,
                        filter: "blur(0px)",
                        clipPath: "inset(0 0% 0 0%)",
                      }}
                      exit={{ opacity: 0, filter: "blur(4px)" }}
                      transition={
                        animateReadyTransition
                          ? {
                              opacity: {
                                duration: 0.22,
                                ease: [0.22, 1, 0.36, 1],
                              },
                              filter: {
                                duration: 0.22,
                                ease: [0.22, 1, 0.36, 1],
                              },
                              clipPath: {
                                duration: 0.46,
                                ease: [0.22, 1, 0.36, 1],
                              },
                            }
                          : undefined
                      }
                    >
                      <motion.div
                        initial={
                          animateReadyTransition ? { opacity: 0.72 } : false
                        }
                        animate={{ opacity: 1 }}
                        transition={
                          animateReadyTransition
                            ? { duration: 0.18 }
                            : undefined
                        }
                      >
                        <FooterScrubberCanvas
                          pageStep={pageStep}
                          currentPage={currentPage}
                          totalPages={totalPages}
                          chapterStartPages={chapterStartPages}
                          onScrubCommit={onScrubCommit}
                          onScrubPreview={onScrubPreview}
                          cancelMomentumSignal={cancelMomentumSignal}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="relative">
              {showPageNumbers && !isLoading && pageIndicator ? (
                pageIndicator
              ) : (
                <FooterPageIndicator
                  showPageNumbers={showPageNumbers}
                  currentPage={detailCurrentPage}
                  totalPages={detailTotalPages}
                  isLoading={isLoading}
                  preserveDetailsWhileLoading={preserveDetailsWhileLoading}
                  animateReadyDetails={animateReadyTransition}
                />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
