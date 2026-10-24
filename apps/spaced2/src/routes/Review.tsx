import PreloadReviewImages from "@/components/review/preload-images";
import { reviewSession } from "@/lib/review/session";
import { toast } from "sonner";
import { useReviewActionTarget } from "@/components/hooks/use-review-action-target";
import EditFlashcardResponsive from "@/components/card-actions/edit-flashcard-responsive";
import CardCountBadges from "@/components/card-count-badges";
import CurrentCardBadge from "@/components/current-card-badge";
import FlashcardContent from "@/components/flashcard-content";
import {
  useCards,
  useReviewCards,
  useCurrentCard,
} from "@/components/hooks/query";
import CachedImagesContainer from "@/components/images/cached-images-container";
import ActionsDropdownMenu from "@/components/review/actions-dropdown-menu";
import DeleteFlashcardDialog from "@/components/review/delete-flashcard-dialog";
import DesktopActionsContextMenu from "@/components/review/desktop-actions-context-menu";
import EmptyReviewUi from "@/components/review/empty";
import DesktopGradeButtons from "@/components/review/grade-buttons";
import MobileGradeButtons from "@/components/review/mobile-grade-buttons";
import MobileReviewCarousel from "@/components/review/review-carousel";
import UndoGradeButton from "@/components/review/undo-grade-button";
import { CardContentFormValues } from "@/lib/form-schema";
import {
  handleCardBury,
  handleCardDelete,
  handleCardEdit,
  handleCardSave,
  handleCardSuspend,
} from "@/lib/review/actions";
import { gradeCardOperation } from "@/lib/sync/operation";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@uidotdev/usehooks";
import { SPACED_GAP_MS } from "@workbench/activity-time";
import { useActivitySession } from "@workbench/activity-time/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Grade } from "ts-fsrs";

export default function ReviewRoute() {
  const allCards = useCards();
  const noCardsCreatedYet = allCards.length === 0;

  const reviewCards = useReviewCards();
  const selected = useCurrentCard();
  const nextReviewCard = selected ?? reviewCards[0];
  useLayoutEffect(() => {
    reviewSession.start();
    return () => reviewSession.stop();
  }, []);
  useLayoutEffect(() => {
    if (!reviewSession.getSnapshot() && nextReviewCard)
      reviewSession.select(nextReviewCard);
  }, [nextReviewCard]);
  const grading = useRef(false);
  const unavailable =
    !!nextReviewCard && !allCards.some((card) => card.id === nextReviewCard.id);

  const { target, capture, getTarget } = useReviewActionTarget(
    allCards,
    nextReviewCard,
  );

  // Time on the card under the shared rule (packages/activity-time): a hidden
  // tab or another window pauses it, and a pause over two minutes counts
  // nothing.
  const cardTime = useActivitySession(
    nextReviewCard ? { kind: "card", id: nextReviewCard.id } : null,
    { app: "spaced", gapMs: SPACED_GAP_MS },
  );
  const isMobile = useMediaQuery("(max-width: 640px)");

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  async function handleEdit(values: CardContentFormValues) {
    await handleCardEdit(values, getTarget(true));
    setIsEditing(false);
  }

  async function handleGrade(grade: Grade) {
    if (!nextReviewCard || unavailable || grading.current) return;
    grading.current = true;
    try {
      // Grading is the card's last action.
      cardTime.input();
      const duration = cardTime.session?.activeMs ?? 0;
      await gradeCardOperation(nextReviewCard, grade, duration);
    } catch {
      toast.error("Could not save your review. Please try again.");
    } finally {
      grading.current = false;
    }
  }

  async function handleDelete() {
    await handleCardDelete(getTarget());
    setIsDeleteDialogOpen(false);
  }

  async function handleSuspend() {
    await handleCardSuspend(getTarget());
  }

  async function handleBury() {
    await handleCardBury(getTarget());
  }

  async function handleSave(bookmarked: boolean) {
    await handleCardSave(bookmarked, getTarget());
  }

  return (
    <div
      className={cn(
        "grid grid-cols-12 gap-x-6 items-start",
        "col-start-1 col-end-13",
        "md:col-start-3 md:col-end-11 md:grid-cols-8",
        "md:mt-12 mb-6",
      )}
    >
      <PreloadReviewImages current={nextReviewCard} queue={reviewCards} />
      <DeleteFlashcardDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onDelete={handleDelete}
      />

      {target && (
        <EditFlashcardResponsive
          card={target}
          open={isEditing}
          onOpenChange={setIsEditing}
          onEdit={handleEdit}
          actions={{
            bookmarked: target.bookmarked,
            onBookmark: handleSave,
            onDelete: handleDelete,
            onBury: handleBury,
          }}
        />
      )}
      <DesktopActionsContextMenu
        key={nextReviewCard?.id ?? "empty"}
        onOpenChange={(open) => {
          if (open) capture();
        }}
        bookmarked={target?.bookmarked ?? nextReviewCard?.bookmarked}
        handleBookmark={handleSave}
        handleDelete={() => setIsDeleteDialogOpen(true)}
        handleSkip={handleSuspend}
        handleBury={handleBury}
        handleEdit={() => setIsEditing(true)}
      >
        <div
          className={cn(
            "relative col-span-12 flex flex-col gap-x-4 gap-y-0 [@media(width>640px)]:gap-y-1 bg-background/60 backdrop-blur-sm dark:bg-muted/30 rounded-t-2xl [@media(width>640px)]:rounded-b-2xl px-1 md:px-0 pt-1 h-full animate-fade-in",
            "dark:border",
            "[@media(width>640px)]:shadow-lg",
          )}
        >
          {/* Actions dropdown menu */}
          <div className="absolute top-1 [@media(width>640px)]:-top-1 right-2 flex z-20">
            {/* <div className='px-2 py-3'>
                <Redo2 className='size-6 text-muted-foreground/50 hover:text-muted-foreground transition-all rotate-180' />
              </div> */}
            <UndoGradeButton />

            {nextReviewCard && (
              <ActionsDropdownMenu
                key={nextReviewCard.id}
                onOpenChange={(open) => {
                  if (open) capture();
                }}
                bookmarked={target?.bookmarked ?? nextReviewCard?.bookmarked}
                handleBookmark={handleSave}
                handleDelete={() => setIsDeleteDialogOpen(true)}
                handleSkip={handleSuspend}
                handleBury={handleBury}
                handleEdit={() => setIsEditing(true)}
              />
            )}
          </div>

          <div className="w-full flex flex-col-reverse [@media(width>640px)]:flex-row justify-between items-center gap-4 px-2">
            <div className="flex gap-2 items-center ml-2">
              <CardCountBadges />
              {nextReviewCard && <CurrentCardBadge card={nextReviewCard} />}
            </div>
          </div>

          <CachedImagesContainer
            renderItem={(ref) => {
              return (
                <div
                  className="flex flex-col md:flex-row justify-stretch md:justify-center items-center gap-2 lg:gap-4 w-full h-full [@media(width>640px)]:bg-background rounded-b-2xl [@media(width>640px)]:border-t"
                  ref={ref}
                >
                  {nextReviewCard ? (
                    isMobile ? (
                      <MobileReviewCarousel card={nextReviewCard} />
                    ) : (
                      <div className="w-full flex items-center gap-6 p-6">
                        <FlashcardContent content={nextReviewCard.front} />
                        <FlashcardContent content={nextReviewCard.back} />
                      </div>
                    )
                  ) : (
                    <EmptyReviewUi noCardsCreatedYet={noCardsCreatedYet} />
                  )}
                </div>
              );
            }}
          />
        </div>
      </DesktopActionsContextMenu>

      {unavailable && (
        <div role="status" className="col-span-12 p-4">
          This card is no longer available.
          <button
            className="ml-4 underline"
            onClick={() => reviewSession.select()}
          >
            Next card
          </button>
        </div>
      )}
      {!isMobile && !unavailable && (
        <div className="col-span-12 mx-auto w-max mb-4 px-4 pb-2">
          {nextReviewCard && (
            <DesktopGradeButtons
              key={nextReviewCard.id}
              onGrade={handleGrade}
              card={nextReviewCard}
            />
          )}
        </div>
      )}
      <div className="col-span-12 mt-0">
        {nextReviewCard && isMobile && !unavailable && (
          <MobileGradeButtons key={nextReviewCard.id} onGrade={handleGrade} />
        )}
      </div>
    </div>
  );
}
