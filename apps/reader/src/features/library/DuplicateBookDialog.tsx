import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFileUrl } from "@/hooks/use-file-url";
import { getBookCoverFileId } from "@/lib/book-file-references";
import type { Book } from "@/lib/db";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { enterReadingFullscreen } from "@/features/reader/reading-fullscreen";

interface DuplicateBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingBook: Book;
}

export function DuplicateBookDialog({
  open,
  onOpenChange,
  existingBook,
}: DuplicateBookDialogProps) {
  const navigate = useNavigate();
  const coverFileId = getBookCoverFileId(existingBook);
  const { url: coverUrl, isLoading: isLoadingCover } = useFileUrl(coverFileId, {
    skip: !open || !coverFileId,
  });

  const handleOpenBook = () => {
    onOpenChange(false);
    enterReadingFullscreen();
    beginReaderTrace({
      bookId: existingBook.id,
      bookTitle: existingBook.title,
      source: "duplicate-book-dialog",
    });
    navigate(`/reader/${existingBook.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
            Book already added
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This book is already in your library.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 py-4">
          {coverUrl ? (
            <div className="flex-shrink-0">
              <img
                src={coverUrl}
                alt={existingBook.title}
                className="image-outline h-24 rounded-md shadow-md"
              />
            </div>
          ) : isLoadingCover ? (
            <div className="flex-shrink-0 h-24 w-16 flex items-center justify-center bg-secondary rounded-md">
              <Loader2 className="h-6 w-6 text-muted-foreground/50 animate-spin" />
            </div>
          ) : null}

          <div className="flex flex-col justify-center min-w-0">
            <h3 className="text-balance font-semibold text-lg break-words">
              {existingBook.title}
            </h3>
            <p className="text-xs text-muted-foreground break-words mt-0.5">
              {existingBook.author}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Added{" "}
              {new Date(existingBook.dateAdded).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Close
          </Button>
          <Button onClick={handleOpenBook} className="rounded-xl">
            Open book
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
