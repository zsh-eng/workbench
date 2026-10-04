import { motion, useReducedMotionConfig } from "motion/react";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";
import {
  colorVar,
  EASE,
  selectionToRange,
  type LabColor,
  type LabSelection,
  type TextRange,
} from "./lab-model";

export interface PageMark extends TextRange {
  id: string;
  color: LabColor | "pending";
  /** Quieter fill for marks that are not the current focus. */
  tone?: "rest" | "focus";
}

/**
 * One page of book text with decorated passages.
 *
 * Marks are rendered as text segments, like Reader's injected highlight markup,
 * so offsets survive reflow. A mark that is new or changes colour sweeps in
 * from its first character, across line breaks, like a highlighter.
 */
export function LabPage({
  paragraphs,
  marks,
  onSelect,
  onMarkClick,
  onMarkHover,
  afterMark,
  afterParagraph,
  paragraphAside,
  className,
  style,
  ref,
  selectable = true,
  from = 0,
}: {
  paragraphs: string[];
  marks: PageMark[];
  onSelect?: (selection: LabSelection | null) => void;
  onMarkClick?: (id: string) => void;
  onMarkHover?: (id: string | null) => void;
  afterMark?: (id: string) => ReactNode;
  afterParagraph?: (index: number) => ReactNode;
  paragraphAside?: (index: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  selectable?: boolean;
  /** First paragraph on this page; earlier paragraphs belong to the previous page. */
  from?: number;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionConfig();
  const seen = useRef<Set<string> | null>(null);
  const keys = new Set(marks.map((mark) => `${mark.id}:${mark.color}`));
  const firstRender = seen.current === null;
  const fresh = (key: string) => !firstRender && !seen.current!.has(key);
  useLayoutEffect(() => {
    seen.current = keys;
  });

  function capture() {
    if (!onSelect || !root.current) return;
    const selection = selectionToRange(root.current, paragraphs);
    if (!selection) return;
    window.getSelection()?.removeAllRanges();
    onSelect(selection);
  }

  return (
    <div
      ref={(element) => {
        root.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      className={cn(
        "text-foreground",
        selectable ? "select-text" : "select-none",
        className,
      )}
      style={{ fontFamily: "Lora, serif", ...style }}
      onPointerUp={() => requestAnimationFrame(capture)}
      onKeyUp={(event) => {
        if (event.shiftKey) capture();
      }}
    >
      {paragraphs.map((text, index) =>
        index < from ? null : (
          <Fragment key={index}>
            <div className="group/para relative">
              {paragraphAside?.(index)}
              <p data-paragraph={index} className="mb-[0.9em]">
                {segments(
                  text,
                  marks.filter((mark) => mark.paragraph === index),
                ).map((segment, segmentIndex) => {
                  if (!segment.mark)
                    return (
                      <Fragment key={segmentIndex}>{segment.text}</Fragment>
                    );
                  const mark = segment.mark;
                  const key = `${mark.id}:${mark.color}`;
                  const fill =
                    mark.color === "invisible"
                      ? "transparent"
                      : mark.tone === "rest"
                        ? `color-mix(in srgb, ${colorVar(mark.color)} 55%, transparent)`
                        : colorVar(mark.color);
                  return (
                    <Fragment key={`${key}:${segmentIndex}`}>
                      <motion.mark
                        data-mark-id={mark.id}
                        initial={
                          fresh(key) && !reduced
                            ? { backgroundSize: "0% 100%" }
                            : false
                        }
                        animate={{ backgroundSize: "100% 100%" }}
                        transition={{ duration: 0.46, ease: EASE }}
                        onClick={
                          onMarkClick
                            ? (event) => {
                                if (window.getSelection()?.toString()) return;
                                event.stopPropagation();
                                onMarkClick(mark.id);
                              }
                            : undefined
                        }
                        onPointerEnter={() => onMarkHover?.(mark.id)}
                        onPointerLeave={() => onMarkHover?.(null)}
                        className={cn(
                          "rounded-[2px] bg-no-repeat transition-[text-decoration-color] duration-150",
                          onMarkClick && "cursor-pointer",
                          mark.color === "invisible" &&
                            "underline decoration-dotted decoration-[1.5px] underline-offset-[5px]",
                        )}
                        style={{
                          color: "inherit",
                          backgroundColor: "transparent",
                          backgroundImage: `linear-gradient(${fill}, ${fill})`,
                          textDecorationColor:
                            mark.color === "invisible"
                              ? mark.tone === "focus"
                                ? "var(--foreground)"
                                : "color-mix(in srgb, var(--muted-foreground) 70%, transparent)"
                              : undefined,
                          boxShadow:
                            mark.tone === "focus" && mark.color !== "invisible"
                              ? `0 1.5px 0 0 color-mix(in srgb, var(--foreground) 45%, transparent)`
                              : undefined,
                        }}
                      >
                        {segment.text}
                      </motion.mark>
                      {segment.lastOfMark && afterMark?.(mark.id)}
                    </Fragment>
                  );
                })}
              </p>
            </div>
            {afterParagraph?.(index)}
          </Fragment>
        ),
      )}
    </div>
  );
}

const PRIORITY: Record<string, number> = { pending: 3 };

/** Splits text at every mark boundary and picks the most specific mark. */
function segments(text: string, marks: PageMark[]) {
  const cuts = new Set([0, text.length]);
  for (const mark of marks) {
    if (mark.end <= mark.start) continue;
    cuts.add(mark.start);
    cuts.add(mark.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const result: { text: string; mark?: PageMark; lastOfMark: boolean }[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const covering = marks
      .filter((mark) => mark.start <= start && mark.end >= end)
      .sort(
        (a, b) =>
          (PRIORITY[b.color] ?? 0) - (PRIORITY[a.color] ?? 0) ||
          a.end - a.start - (b.end - b.start),
      );
    const mark = covering[0];
    result.push({
      text: text.slice(start, end),
      mark,
      lastOfMark: Boolean(mark && mark.end === end),
    });
  }
  return result;
}
