import { useReadingStatus } from "@/hooks/use-reading-status";
import type { ReadingStatus } from "@/lib/db";
import { createElement, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";

interface ReaderStatusPrompt {
  previousStatus: ReadingStatus | null;
  targetStatus: "reading" | "finished";
  title: string;
  actionLabel: string;
}

export function getReaderStatusPrompt(
  status: ReadingStatus | null,
  isLastPage = false,
): ReaderStatusPrompt | null {
  if (isLastPage && status !== "finished") {
    return {
      previousStatus: status,
      targetStatus: "finished",
      title: "Finished this book?",
      actionLabel: "Mark as finished",
    };
  }

  if (status === "dnf") {
    return {
      previousStatus: status,
      targetStatus: "reading",
      title: "Giving this book another try?",
      actionLabel: "Start again",
    };
  }

  if (status === null || status === "want-to-read") {
    return {
      previousStatus: status,
      targetStatus: "reading",
      title: "Ready to start reading?",
      actionLabel: "Start reading",
    };
  }

  return null;
}

interface UseReaderStatusPromptOptions {
  bookId: string | undefined;
  isReady: boolean;
  isLastPage?: boolean;
}

export interface ReaderStatusAction extends ReaderStatusPrompt {
  isPending: boolean;
  error: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** Keeps reading-status feedback with the opened Reader, including save errors. */
export function useReaderStatusPrompt({
  bookId,
  isReady,
  isLastPage = false,
}: UseReaderStatusPromptOptions): ReaderStatusAction | undefined {
  const navigate = useNavigate();
  const { status, isLoading, setStatusAsync } = useReadingStatus(bookId);
  const [dismissedPrompts, setDismissedPrompts] = useState<Set<string>>(
    () => new Set(),
  );
  const [operation, setOperation] = useState({
    key: "",
    pending: false,
    error: "",
  });
  const prompt = getReaderStatusPrompt(status, isLastPage);
  if (!bookId || !isReady || isLoading || !prompt) return;
  // Starting and finishing are separate decisions within this Reader visit.
  const key = `${bookId}:${prompt.targetStatus}`;
  if (dismissedPrompts.has(key)) return;
  const dismiss = () =>
    setDismissedPrompts((previous) => new Set(previous).add(key));

  const isPending = operation.key === key && operation.pending;
  return {
    ...prompt,
    isPending,
    error: operation.key === key ? operation.error : "",
    onDismiss: dismiss,
    onConfirm: () => {
      if (isPending) return;
      setOperation({ key, pending: true, error: "" });
      void setStatusAsync(prompt.targetStatus)
        .then(() => {
          toast.success(
            createElement(ReadingStatusChangeMessage, {
              previousStatus: status,
              status: prompt.targetStatus,
            }),
            // One toast for the book's status: a second change updates it.
            prompt.targetStatus === "finished"
              ? {
                  id: "reading-status",
                  duration: 8000,
                  action: {
                    label: "Back to library",
                    onClick: () => navigate("/"),
                  },
                }
              : { id: "reading-status" },
          );
          dismiss();
          setOperation({ key, pending: false, error: "" });
        })
        .catch(() => {
          setOperation({
            key,
            pending: false,
            error: "Could not update reading status. Please try again.",
          });
        });
    },
  };
}
