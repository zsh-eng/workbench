import { CircularBookCover } from "@/components/CircularBookCover";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import type { ReadingStatus } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  BookMarked,
  BookOpen,
  Check,
  CheckCircle,
  ChevronLeft,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

export interface ReadingStatusOption {
  value: ReadingStatus;
  label: string;
  icon: LucideIcon;
}

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  "want-to-read": "Want to read",
  reading: "Reading",
  finished: "Finished",
  dnf: "Did not finish",
};

export const READING_STATUS_OPTIONS: ReadingStatusOption[] = [
  {
    value: "want-to-read",
    label: READING_STATUS_LABELS["want-to-read"],
    icon: BookMarked,
  },
  { value: "reading", label: READING_STATUS_LABELS.reading, icon: BookOpen },
  {
    value: "finished",
    label: READING_STATUS_LABELS.finished,
    icon: CheckCircle,
  },
  { value: "dnf", label: READING_STATUS_LABELS.dnf, icon: XCircle },
];

interface BookStatusSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string | undefined;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onBack: () => void;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
}

function BookStatusOptionButton({
  option,
  isSelected,
  isUpdating,
  onSelect,
}: {
  option: ReadingStatusOption;
  isSelected: boolean;
  isUpdating: boolean;
  onSelect: () => void;
}) {
  const springPress = useSpringPressAnimation();

  return (
    <motion.button
      type="button"
      aria-pressed={isSelected}
      disabled={isUpdating}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-[1.25rem] border bg-secondary/35 px-4 py-3 text-left outline-none transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-ring/60",
        isSelected
          ? "border-foreground bg-secondary/65"
          : "border-border/60 hover:bg-secondary/55",
        isUpdating && "cursor-wait opacity-70",
      )}
      onClick={onSelect}
      {...springPress}
    >
      <option.icon
        className={cn(
          "size-5 shrink-0",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">
        {option.label}
      </span>
      {isSelected && (
        <Check className="size-5 shrink-0 text-foreground" aria-hidden="true" />
      )}
    </motion.button>
  );
}

/** Mobile book actions with persistent, directly visible reading statuses. */
export function BookStatusSheet({
  open,
  onOpenChange,
  bookTitle,
  bookAuthor,
  coverUrl,
  status,
  isUpdating,
  onBack,
  onSelectStatus,
  onRemove,
}: BookStatusSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reading status"
      showHeader
      header={
        <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to reader tools"
            className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Button>

          <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Reading status
          </p>

          <div className="size-8" aria-hidden="true" />
        </div>
      }
      panelClassName="max-w-md"
      bodyClassName="overflow-y-auto"
    >
      <BookStatusPanel
        bookTitle={bookTitle}
        bookAuthor={bookAuthor}
        coverUrl={coverUrl}
        status={status}
        isUpdating={isUpdating}
        onSelectStatus={onSelectStatus}
        onRemove={onRemove}
        onOpenChange={onOpenChange}
      />
    </BottomSheet>
  );
}

export function BookStatusPanel({
  bookTitle,
  bookAuthor,
  coverUrl,
  status,
  isUpdating,
  onSelectStatus,
  onRemove,
  onOpenChange,
}: Omit<BookStatusSheetProps, "open" | "onBack">) {
  const removePress = useSpringPressAnimation();
  const bookSummary = (
    <>
      <CircularBookCover coverUrl={coverUrl} className="size-20 shrink-0" />
      <div className="min-w-0">
        <p className="break-words text-balance font-serif text-xl font-medium tracking-[-0.01em] text-foreground">
          {bookTitle}
        </p>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {bookAuthor}
        </p>
      </div>
    </>
  );

  return (
    <div
      className="px-4 pt-3"
      style={{
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
      }}
    >
      <div className="mb-5 flex min-w-0 items-center gap-4 px-2 py-1">
        {bookSummary}
      </div>

      <div className="flex flex-col gap-2">
        {READING_STATUS_OPTIONS.map((option) => {
          const isSelected = status === option.value;

          return (
            <BookStatusOptionButton
              key={option.value}
              option={option}
              isSelected={isSelected}
              isUpdating={isUpdating}
              onSelect={() => onSelectStatus(option.value)}
            />
          );
        })}
      </div>

      <motion.button
        type="button"
        className="mt-6 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[1.1rem] border border-destructive/40 bg-destructive/5 px-4 py-3 text-center text-sm font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={() => {
          if (onRemove()) onOpenChange(false);
        }}
        {...removePress}
      >
        <Trash2 className="size-5" aria-hidden="true" />
        Remove book
      </motion.button>
    </div>
  );
}
