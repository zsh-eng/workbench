import { useId } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { ArrowLeft, ArrowRight, BookOpen, Laptop, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReaderStatusAction } from "./hooks/use-reader-status-prompt";
import type { ReaderHandoffPrompt } from "./types";

export type ChromePromptKind = "reading" | "handoff";
export type ChromePromptAppearance = "soft" | "minimal" | "outline";

const statusLabels = {
  "want-to-read": "Want to read",
  dnf: "Did not finish",
  reading: "Reading",
  finished: "Finished",
};

const surfaces: Record<ChromePromptAppearance, string> = {
  soft: "border-transparent bg-secondary/70",
  minimal: "border-transparent bg-transparent",
  outline: "border-border bg-background/60",
};

type ReaderChromeAccessoryProps = {
  /** Alternative surfaces remain available in the debug preview. */
  appearance?: ChromePromptAppearance;
  /** Phones float the prompt at the top edge, over the page and the header. */
  floating?: boolean;
} & (
  | { kind: "reading"; prompt: ReaderStatusAction }
  | { kind: "handoff"; prompt: ReaderHandoffPrompt; currentPage: number }
);

/** Reader prompts share one compact surface on desktop and phones. Only the
 * page order determines a handoff's arrow; a more recent checkpoint can be
 * earlier in the book. */
export function ReaderChromeAccessory(props: ReaderChromeAccessoryProps) {
  const errorId = useId();
  const tooltipId = useId();
  const { appearance = "soft", floating = false, prompt } = props;
  const handoff = props.kind === "handoff";
  const label =
    props.kind === "handoff"
      ? `Continue at p. ${props.prompt.targetPage}`
      : props.prompt.targetStatus === "finished"
        ? "Mark as finished"
        : "Mark as reading";
  const detail =
    props.kind === "handoff"
      ? `Newer position on ${props.prompt.sourceLabel}: page ${props.prompt.targetPage}`
      : "";
  const direction =
    props.kind !== "handoff" || props.prompt.targetPage === props.currentPage
      ? null
      : props.prompt.targetPage < props.currentPage
        ? "backward"
        : "forward";
  const Arrow = direction === "backward" ? ArrowLeft : ArrowRight;
  const Icon = handoff ? Laptop : BookOpen;
  const pending = props.kind === "reading" && props.prompt.isPending;
  const error = props.kind === "reading" ? props.prompt.error : "";
  const action = (
    <Button
      variant="ghost"
      size="sm"
      title={handoff ? detail : undefined}
      aria-label={
        props.kind === "handoff"
          ? `${label} from ${props.prompt.sourceLabel}`
          : label
      }
      aria-describedby={
        props.kind === "reading"
          ? [tooltipId, error && errorId].filter(Boolean).join(" ")
          : undefined
      }
      aria-busy={pending}
      disabled={pending}
      onClick={
        props.kind === "handoff" ? props.prompt.onJump : props.prompt.onConfirm
      }
      className={cn(
        "min-w-0 shrink-0 gap-2 text-xs hover:bg-muted",
        floating
          ? "h-8 rounded-full pr-2.5 pl-3"
          : "h-7 rounded-[calc(var(--radius-xl)-3px)] px-2",
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="whitespace-nowrap">{pending ? "Saving…" : label}</span>
      {direction && (
        <Arrow
          data-reader-jump-direction={direction}
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </Button>
  );
  return (
    <div
      data-reader-header-accessory={floating ? undefined : ""}
      data-reader-top-prompt={floating ? "" : undefined}
      data-testid="chrome-accessory"
      className={cn("relative shrink-0", !floating && "mr-2")}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 border",
          floating
            ? "h-10 rounded-full border-border/80 bg-background p-1 shadow-lg"
            : cn("h-9 rounded-xl p-0.5", surfaces[appearance]),
        )}
      >
        {props.kind === "handoff" ? (
          action
        ) : (
          <Tooltip.Root disabled={pending}>
            <Tooltip.Trigger delay={380} render={action} />
            <Tooltip.Portal>
              <Tooltip.Positioner
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
                className="z-50"
              >
                <Tooltip.Popup
                  id={tooltipId}
                  role="tooltip"
                  className="max-w-72 rounded-xl bg-foreground px-3 py-2 text-xs text-background"
                >
                  {props.prompt.previousStatus ? (
                    <>
                      Change from{" "}
                      <strong>
                        {statusLabels[props.prompt.previousStatus]}
                      </strong>{" "}
                      to{" "}
                      <strong>{statusLabels[props.prompt.targetStatus]}</strong>
                    </>
                  ) : (
                    <>
                      Set this book’s status to{" "}
                      <strong>{statusLabels[props.prompt.targetStatus]}</strong>
                    </>
                  )}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
        <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-sm"
          title="Dismiss"
          aria-label={
            handoff ? "Dismiss sync prompt" : "Dismiss reading status prompt"
          }
          onClick={prompt.onDismiss}
          className={cn(
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            floating
              ? "size-8 rounded-full"
              : "size-7 rounded-[calc(var(--radius-xl)-3px)]",
          )}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className={cn(
            "absolute top-full mt-2 w-64 rounded-xl border border-border bg-background p-3 text-xs text-foreground",
            floating ? "left-1/2 -translate-x-1/2" : "right-0",
          )}
        >
          {error}
        </p>
      )}
    </div>
  );
}
