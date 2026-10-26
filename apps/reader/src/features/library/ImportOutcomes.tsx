import { Button } from "@/components/ui/button";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import { DetentSheet } from "@/components/ui/detent-sheet";
import {
  describeImportError,
  importErrorDetails,
  type BookImportError,
} from "@/lib/book-import-errors";
import { copyText } from "@/lib/clipboard";
import type { Book } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useState } from "react";

/** How one chosen file ended. */
export type ImportOutcome =
  | { fileName: string; status: "added"; book: Book }
  | { fileName: string; status: "duplicate"; book: Book }
  | { fileName: string; status: "failed"; error: BookImportError };

/** A batch in a few words: "3 added, 1 couldn’t be added." */
export function importSummary({
  added,
  duplicates,
  failed,
}: {
  added: number;
  duplicates: number;
  failed: number;
}): string {
  if (!duplicates && !failed)
    return `Added ${added} book${added === 1 ? "" : "s"}.`;
  if (!added && !failed)
    return duplicates === 1
      ? "This book is already in your library."
      : `These ${duplicates} books are already in your library.`;
  if (!added && !duplicates)
    return failed === 1
      ? "This file couldn’t be added."
      : `${failed} files couldn’t be added.`;
  const parts = [
    added && `${added} added`,
    duplicates && `${duplicates} already in your library`,
    failed && `${failed} couldn’t be added`,
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}

export function countOutcomes(outcomes: readonly ImportOutcome[]) {
  const count = (status: ImportOutcome["status"]) =>
    outcomes.filter((outcome) => outcome.status === status).length;
  return {
    added: count("added"),
    duplicates: count("duplicate"),
    failed: count("failed"),
  };
}

/** Copies an error's technical account, for a report. */
export function CopyDetailsButton({
  error,
  fileName,
  className,
}: {
  error: BookImportError;
  fileName: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() =>
        void copyText(importErrorDetails(error, fileName)).then((done) => {
          if (!done) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        })
      }
      className={cn("rounded-full", className)}
    >
      <CopyFeedbackIcon copied={copied} className="size-4" />
      {copied ? "Details copied" : "Copy details"}
    </Button>
  );
}

function OutcomeRow({ outcome }: { outcome: ImportOutcome }) {
  const copy =
    outcome.status === "failed"
      ? describeImportError(outcome.error)
      : {
          title: "Already in your library",
          what: "You added this book before.",
          next: "",
        };
  return (
    <li className="min-w-0 py-3" data-import-outcome={outcome.status}>
      <p className="truncate text-[14px] text-foreground">{outcome.fileName}</p>
      <p className="mt-0.5 text-[13px] font-medium text-foreground">
        {copy.title}
      </p>
      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
        {copy.what} {copy.next}
      </p>
      {outcome.status === "failed" && outcome.error.kind === "unexpected" && (
        <CopyDetailsButton
          error={outcome.error}
          fileName={outcome.fileName}
          className="mt-2 h-8 text-[13px]"
        />
      )}
    </li>
  );
}

/**
 * Why each file of a batch was not added: the sheet behind the summary
 * toast's See why.
 */
export function ImportProblemsSheet({
  outcomes,
  isOpen,
  onOpenChange,
}: {
  outcomes: readonly ImportOutcome[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const count = outcomes.length;
  return (
    <DetentSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={
        count === 1 ? "1 file wasn’t added" : `${count} files weren’t added`
      }
    >
      <ul
        className="divide-y divide-border px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        data-import-problems=""
      >
        {outcomes.map((outcome, index) => (
          <OutcomeRow key={`${index}:${outcome.fileName}`} outcome={outcome} />
        ))}
      </ul>
    </DetentSheet>
  );
}
