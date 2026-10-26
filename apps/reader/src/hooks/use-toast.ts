import type { MouseEvent, ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  message: ReactNode;
  /** A second line: what happened, and what to do. */
  description?: ReactNode;
  variant?: "default" | "destructive" | "loading";
  duration?: number;
  /** One subject keeps one toast: a toast with the same id changes in place. */
  id?: string;
  /** `event.preventDefault()` keeps the toast open, to change it in place. */
  action?: {
    label: string;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  };
}

/** App notifications use one message, with optional actions. */
function toast({
  message,
  description,
  variant,
  duration = 4000,
  id,
  action,
}: ToastOptions) {
  const notify =
    variant === "destructive"
      ? sonnerToast.error
      : variant === "loading"
        ? sonnerToast.loading
        : sonnerToast.success;
  return notify(message, { id, description, duration, action });
}

function dismiss(id: string) {
  sonnerToast.dismiss(id);
}

export function useToast() {
  return { toast, dismiss };
}
