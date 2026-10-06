import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type DeleteFlashcardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
};

export default function DeleteFlashcardDialog({
  open,
  onOpenChange,
  onDelete,
}: DeleteFlashcardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl w-72 py-4 px-2">
        <AlertDialogHeader className="text-center">
          <AlertDialogTitle className="text-center text-lg">
            Delete card?
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-row items-center justify-center sm:justify-center gap-2">
          <AlertDialogCancel
            className={cn(
              buttonVariants({ variant: "outline" }),
              "rounded-lg h-12 w-32 sm:h-10 sm:w-28 mt-0",
            )}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className={cn(
              buttonVariants({ variant: "default" }),
              "rounded-lg h-12 w-32 sm:h-10 sm:w-28",
            )}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
