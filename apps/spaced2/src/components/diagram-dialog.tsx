import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { mountDiagram } from "@/lib/markdown/diagrams";
import type { Mounted } from "pele/lazy";
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

/** The most that the dialog enlarges a diagram, against its size on the card. */
const MAX_FIT = 3;
/** How far Pele's zoom goes, against the diagram's own size. */
const MAX_ZOOM = 12;
/** The room around the diagram, in pixels. */
const SIDES = 24;
const TOP = 8;
const BOTTOM = 24;

/**
 * A Mermaid diagram over the page, as large as the window lets it be: the
 * SVG scales, so its text stays sharp, and Pele's zoom and drag go further.
 * Escape, a tap outside or × closes it.
 */
export default function DiagramDialog({
  source,
  natural,
  onClose,
}: {
  source: string;
  /** The diagram's own size, as the card drew it. */
  natural?: { width: number; height: number };
  onClose(): void;
}) {
  const [room, setRoom] = useState<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>();
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  // The width that fills the room in both directions, as the window resizes.
  useLayoutEffect(() => {
    if (!room || !natural?.width || !natural.height) return;
    const fit = () => {
      const scale = Math.min(
        (room.clientWidth - 2 * SIDES) / natural.width,
        (room.clientHeight - TOP - BOTTOM) / natural.height,
      );
      setWidth(
        Math.round(natural.width * Math.min(MAX_FIT, Math.max(1, scale))),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(room);
    return () => observer.disconnect();
  }, [room, natural]);
  useEffect(() => {
    if (!element) return;
    let cancelled = false;
    let diagram: Mounted | undefined;
    mountDiagram(element, source, { zoom: { maxScale: MAX_ZOOM } }).then(
      (mounted) => {
        if (cancelled) return mounted.destroy();
        diagram = mounted;
        setDrawn(true);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      diagram?.destroy();
    };
  }, [element, source]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex flex-col gap-0 p-0 w-[calc(100vw-2rem)] max-w-none h-[calc(100dvh-2rem)] overflow-hidden"
      >
        <DialogTitle className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">
          Diagram
        </DialogTitle>
        <DialogDescription className="sr-only">
          Pinch, scroll or use the zoom buttons to look closer.
        </DialogDescription>
        <div
          ref={setRoom}
          className="relative grow min-h-0 overflow-auto"
          style={{
            paddingTop: TOP,
            paddingBottom: BOTTOM,
            paddingInline: SIDES,
          }}
        >
          {failed ? (
            <p className="text-center text-sm text-muted-foreground">
              The diagram could not be drawn.
            </p>
          ) : (
            <div
              ref={setElement}
              className="card-diagram card-diagram-large"
              aria-busy={drawn ? undefined : true}
              style={
                width
                  ? ({ "--card-diagram-width": `${width}px` } as CSSProperties)
                  : undefined
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
