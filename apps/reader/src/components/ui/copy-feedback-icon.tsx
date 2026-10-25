import { cn } from "@/lib/utils";
import { SPRINGS, springTransition } from "@workbench/elements/spring";
import { Copy } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

interface CopyFeedbackIconProps {
  copied: boolean;
  className?: string;
}

const SWAP = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;

/** Keeps copy confirmation compact without moving the surrounding control.
 * The copy glyph shrinks away and a check draws itself in its place, short
 * stroke first, as a pen would. With reduced motion the two cross-fade. */
export function CopyFeedbackIcon({ copied, className }: CopyFeedbackIconProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const away = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" };

  return (
    <>
      <span
        className={cn("relative grid place-items-center", className)}
        aria-hidden="true"
      >
        <AnimatePresence initial={false} mode="sync">
          {copied ? (
            <motion.svg
              key="copied"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-copy-check=""
              className="absolute inset-0 size-full"
              initial={{ opacity: reducedMotion ? 0 : 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: SWAP }}
              transition={SWAP}
            >
              <motion.path
                d="M4.5 12.5 9.5 17.5 19.5 6.5"
                initial={{ pathLength: reducedMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{
                  ...springTransition(SPRINGS.snappy),
                  delay: 0.04,
                }}
              />
            </motion.svg>
          ) : (
            <motion.span
              key="copy"
              className="absolute inset-0 grid place-items-center"
              initial={away}
              animate={{
                opacity: 1,
                transform: "scale(1)",
                filter: "blur(0px)",
              }}
              exit={away}
              transition={SWAP}
            >
              <Copy className="size-full" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="sr-only" role="status">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
