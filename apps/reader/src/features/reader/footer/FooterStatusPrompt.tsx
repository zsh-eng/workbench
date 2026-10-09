import { Button } from "@/components/ui/button";
import { MOTION } from "@/lib/motion";
import { X } from "lucide-react";
import { motion } from "motion/react";
import type { ReaderStatusAction } from "../hooks/use-reader-status-prompt";

export function FooterStatusPrompt({ prompt }: { prompt: ReaderStatusAction }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: MOTION.enter }}
      exit={{ opacity: 0, transition: MOTION.exit }}
      className="pointer-events-auto px-3 sm:px-4"
      role="status"
    >
      <div className="mx-auto flex max-w-[min(100%,34rem)] items-center gap-2 rounded-full border border-border/80 bg-background p-2 pl-4 shadow-lg shadow-background/20">
        <span className="min-w-0 flex-1 text-xs text-foreground">
          {prompt.error || prompt.title}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 rounded-full"
          disabled={prompt.isPending}
          onClick={prompt.onConfirm}
        >
          {prompt.isPending ? "Saving…" : prompt.actionLabel}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-full"
          aria-label="Dismiss reading status prompt"
          onClick={prompt.onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
