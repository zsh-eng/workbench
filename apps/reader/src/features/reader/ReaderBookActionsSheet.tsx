import { RemoveBookDialog } from "@/components/RemoveBookDialog";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { BookStatusPanel, BookStatusSheet } from "@/components/BookStatusSheet";
import { useFileUrl } from "@/hooks/use-file-url";
import { useReadingStatus } from "@/hooks/use-reading-status";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface ReaderBookActionsSheetProps {
  isOpen: boolean;
  embedded?: boolean;
  onClose: () => void;
  onBack: () => void;
  book: Book;
}

/** Keeps the full book-status sheet available from the mobile reader tools. */
export function ReaderBookActionsSheet({
  isOpen,
  embedded = false,
  onClose,
  onBack,
  book,
}: ReaderBookActionsSheetProps) {
  const navigate = useNavigate();
  const [removeOpen, setRemoveOpen] = useState(false);
  const { url: coverUrl } = useFileUrl(book.cover?.fileId, { skip: !isOpen });
  const { toast } = useToast();
  const { deleteBook } = useSync();
  const { status, isLoading, setStatusAsync, isUpdating } = useReadingStatus(
    book.id,
  );
  const [displayStatus, setDisplayStatus] = useState<ReadingStatus | null>(
    status,
  );

  useEffect(() => {
    if (isLoading) return;
    setDisplayStatus(status);
  }, [isLoading, status]);

  const handleSelectStatus = (nextStatus: ReadingStatus) => {
    if (nextStatus === (displayStatus ?? "want-to-read") || isUpdating) return;

    const previousStatus = displayStatus;
    setDisplayStatus(nextStatus);
    void setStatusAsync(nextStatus)
      .then(() => {
        toast({
          message: (
            <ReadingStatusChangeMessage
              previousStatus={previousStatus}
              status={nextStatus}
            />
          ),
        });
      })
      .catch(() => {
        setDisplayStatus(previousStatus);
        toast({
          message: "Could not change reading status.",
          variant: "destructive",
        });
      });
  };

  const handleRemove = (): boolean => {
    setRemoveOpen(true);
    return false;
  };

  const confirmRemove = async () => {
    await deleteBook(book.id);
    toast({ message: "Removed book from library." });
    navigate("/");
  };

  const Content = embedded ? BookStatusPanel : BookStatusSheet;
  return (
    <>
    <Content
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      bookTitle={book.title}
      bookAuthor={book.author}
      coverUrl={coverUrl}
      status={displayStatus}
      isUpdating={isLoading || isUpdating}
      onBack={onBack}
      onSelectStatus={handleSelectStatus}
      onRemove={handleRemove}
    />
    <RemoveBookDialog open={removeOpen} onOpenChange={setRemoveOpen} bookTitle={book.title} onConfirm={confirmRemove} />
    </>
  );
}
