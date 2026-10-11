import CurrentCardBadge from "@/components/current-card-badge";
import FlashcardContent from "@/components/flashcard-content";
import ActionsDropdownMenu from "@/components/review/actions-dropdown-menu";
import EmptyReviewUi from "@/components/review/empty";
import DesktopGradeButtons from "@/components/review/grade-buttons";
import MobileGradeButtons from "@/components/review/mobile-grade-buttons";
import MobileReviewCarousel from "@/components/review/review-carousel";
import { RATING_TO_KEY } from "@/lib/card-mapping";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@uidotdev/usehooks";
import { useEffect, useState } from "react";
import { Rating } from "ts-fsrs";
import { sampleReviewQueue } from "./card-fixture";
import { prefersReducedMotion, type FrameSpecimenProps } from "./selection";

/** Keys go to the window, as a keyboard would send them. */
function sendKey(type: "keydown" | "keyup", key: string) {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
}

/**
 * The review screen's parts on a sample queue. The route reads the live
 * queue and writes grades, so this frame arranges the same parts with the
 * route's classes; a grade only moves to the next sample card.
 */
export function ReviewScreen({ state, nonce = 0 }: FrameSpecimenProps) {
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [queue, setQueue] = useState(() =>
    state === "done" || state === "empty" ? [] : sampleReviewQueue(),
  );
  const [saved, setSaved] = useState<string[]>([]);
  const card = queue[0];
  const next = () => setQueue((cards) => cards.slice(1));
  const play = nonce > 0 || !prefersReducedMotion();

  // On a phone the answer is the second slide; Space turns to it, as in the
  // app. Desktop shows both sides.
  useEffect(() => {
    if (state !== "answer" || !isMobile || !play) return;
    const timer = window.setTimeout(() => sendKey("keydown", " "), 500);
    return () => window.clearTimeout(timer);
  }, [state, isMobile, play]);

  // A short press of 3 grades Good; the button squashes while it is held.
  useEffect(() => {
    if (state !== "grade" || !play) return;
    const key = RATING_TO_KEY[Rating.Good];
    const timers = [
      window.setTimeout(() => sendKey("keydown", key), 700),
      window.setTimeout(() => sendKey("keyup", key), 880),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [state, play]);

  return (
    <div className="min-h-svh bg-muted px-2 pt-20 pb-12 dark:bg-background md:px-0 md:pt-8">
      <div className="mx-auto w-full md:mt-12 md:w-2/3">
        <div
          className={cn(
            "relative flex h-full flex-col gap-x-4 gap-y-0 rounded-t-2xl bg-background/60 px-1 pt-1 backdrop-blur-sm dark:bg-muted/30 md:px-0 [@media(width>640px)]:gap-y-1 [@media(width>640px)]:rounded-b-2xl",
            "dark:border",
            "[@media(width>640px)]:shadow-lg",
          )}
        >
          <div className="absolute top-1 right-2 z-20 flex [@media(width>640px)]:-top-1">
            {card && (
              <ActionsDropdownMenu
                key={card.id}
                bookmarked={saved.includes(card.id)}
                handleBookmark={(bookmarked) =>
                  setSaved((ids) =>
                    bookmarked
                      ? [...ids, card.id]
                      : ids.filter((id) => id !== card.id),
                  )
                }
                handleDelete={next}
                handleSkip={next}
                handleBury={next}
                handleEdit={() => {}}
              />
            )}
          </div>
          <div className="flex w-full flex-col-reverse items-center justify-between gap-4 px-2 [@media(width>640px)]:flex-row">
            <div className="ml-2 flex items-center gap-2">
              {card && <CurrentCardBadge card={card} />}
            </div>
          </div>
          <div className="flex h-full w-full flex-col items-center justify-stretch gap-2 rounded-b-2xl md:flex-row md:justify-center lg:gap-4 [@media(width>640px)]:border-t [@media(width>640px)]:bg-background">
            {card ? (
              isMobile ? (
                <MobileReviewCarousel card={card} />
              ) : (
                <div className="flex w-full items-center gap-6 p-6">
                  <FlashcardContent content={card.front} />
                  <FlashcardContent content={card.back} />
                </div>
              )
            ) : (
              <EmptyReviewUi noCardsCreatedYet={state === "empty"} />
            )}
          </div>
        </div>
        {!isMobile && card && (
          <div className="mx-auto mb-4 w-max px-4 pb-2">
            <DesktopGradeButtons key={card.id} card={card} onGrade={next} />
          </div>
        )}
        {isMobile && card && (
          <MobileGradeButtons key={card.id} onGrade={next} />
        )}
      </div>
    </div>
  );
}
