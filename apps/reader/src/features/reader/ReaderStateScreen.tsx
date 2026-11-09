import { Button } from "@/components/ui/button";

interface ReaderStateAction {
  label: string;
  onClick: () => void;
}

interface ReaderStateScreenProps {
  title?: string;
  message?: string;
  showSpinner?: boolean;
  action?: ReaderStateAction;
}

/**
 * The Reader's whole screen while a book is not there to read: a title in
 * the serif, a line that says what happened, and one thing to do, as the
 * Library and Highlights say they are empty.
 */
export function ReaderStateScreen({
  title,
  message,
  showSpinner = false,
  action,
}: ReaderStateScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div role="status" className="w-full max-w-sm text-center">
        {showSpinner && (
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
        )}
        {title && (
          <h1 className="font-serif text-[26px] leading-tight font-normal text-balance md:text-[34px]">
            {title}
          </h1>
        )}
        {message && (
          <p className="mx-auto mt-3 max-w-sm text-[14px] text-pretty text-muted-foreground">
            {message}
          </p>
        )}
        {action && (
          <Button className="mt-6" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
