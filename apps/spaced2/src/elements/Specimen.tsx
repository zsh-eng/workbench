import { cn } from "@/lib/utils";
import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Choice } from "./Choice";
import { keepLinksInPlace, type SpecimenState } from "./selection";
import { useStage } from "./stage";

type Surface = "page" | "card";

const SURFACES: Record<Surface, { label: string; className: string }> = {
  page: { label: "Page", className: "bg-muted dark:bg-background" },
  card: { label: "Card", className: "bg-background dark:bg-muted/30" },
};

/**
 * One part or a small group on a stage, with a caption, a row of named
 * states, and optional demo controls. The stage takes the chosen surface and
 * the page zoom.
 */
export function Specimen({
  title,
  note,
  states,
  selection,
  controls,
  surface: initialSurface = "page",
  zoomable = true,
  padded = true,
  stageRef,
  stageProps,
  stageClassName,
  children,
}: {
  title: string;
  note?: ReactNode;
  states?: readonly SpecimenState[];
  selection?: { state: string; choose: (state: string) => void };
  controls?: ReactNode;
  surface?: Surface;
  zoomable?: boolean;
  padded?: boolean;
  stageRef?: (node: HTMLElement | null) => void;
  stageProps?: HTMLAttributes<HTMLDivElement>;
  stageClassName?: string;
  children: ReactNode;
}) {
  const { zoom } = useStage();
  const [surface, setSurface] = useState(initialSurface);
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-3 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{title}</h3>
            {note && (
              <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                {note}
              </p>
            )}
          </div>
          <div
            role="group"
            aria-label={`${title} surface`}
            className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {(Object.keys(SURFACES) as Surface[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={surface === value}
                aria-label={`Show on ${SURFACES[value].label.toLowerCase()}`}
                title={`Show on ${SURFACES[value].label.toLowerCase()}`}
                onClick={() => setSurface(value)}
                className="grid size-7 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                <span
                  className={cn(
                    "size-3 rounded-sm border border-border",
                    SURFACES[value].className,
                  )}
                />
              </button>
            ))}
          </div>
        </div>
        {(states || controls) && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {states && selection && states.length > 1 && (
              <Choice
                label={`${title} state`}
                value={selection.state}
                options={states}
                onChange={selection.choose}
              />
            )}
            {controls}
          </div>
        )}
      </figcaption>
      <div
        ref={stageRef}
        data-specimen-stage=""
        {...stageProps}
        onClickCapture={keepLinksInPlace}
        className={cn(
          "relative overflow-auto rounded-xl border border-border text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          SURFACES[surface].className,
          padded && "p-4 sm:p-6",
          stageClassName,
        )}
      >
        <div style={zoomable && zoom !== "1" ? { zoom: Number(zoom) } : {}}>
          {children}
        </div>
      </div>
    </figure>
  );
}
