import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import type { Mounted } from "pele/lazy";
import { mountDiagram } from "../markdown/diagrams";
import { tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import { Icon } from "./Icon";

/** The most that the dialog enlarges a diagram, against its size on the page. */
const MAX_FIT = 3;
/** How far Pele's zoom goes, against the diagram's own size. */
const MAX_ZOOM = 12;
/** The room around the diagram, in pixels. */
const SIDES = 32;
const TOP = 8;
const BOTTOM = 32;

/**
 * A Mermaid diagram over the page, as large as the window lets it be: the SVG
 * scales, so its text stays sharp, and Pele's zoom and drag go further.
 * Escape or × closes it.
 */
export function DiagramDialog({
  source,
  natural,
  onClose,
}: {
  source: string;
  /** The diagram's own size, as the page drew it. */
  natural?: { width: number; height: number };
  onClose(): void;
}) {
  const [room, setRoom] = useState<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>();
  const [mounted, setMounted] = useState<Mounted>();
  const [failed, setFailed] = useState(false);
  const theme = useTheme().active.id;
  // The width that fills the room in both directions, as the window resizes.
  useLayoutEffect(() => {
    if (!room || !natural?.width || !natural.height) return;
    const fit = () => {
      const scale = Math.min(
        (room.clientWidth - 2 * SIDES) / natural.width,
        (room.clientHeight - TOP - BOTTOM) / natural.height,
      );
      setWidth(Math.round(natural.width * Math.min(MAX_FIT, Math.max(1, scale))));
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
      (drawn) => {
        if (cancelled) return drawn.destroy();
        diagram = drawn;
        setMounted(drawn);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      diagram?.destroy();
    };
  }, [element, source]);
  useEffect(() => mounted?.refresh(), [mounted, theme]);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
        <Dialog.Popup {...stylex.props(styles.popup, ui.instant)}>
          <div {...stylex.props(styles.header)}>
            <Dialog.Title {...stylex.props(styles.title)}>Diagram</Dialog.Title>
            <Dialog.Close aria-label="Close" {...stylex.props(ui.button, ui.iconButton)}>
              <Icon name="close" size={15} />
            </Dialog.Close>
          </div>
          <div ref={setRoom} {...stylex.props(styles.room)}>
            {failed ? (
              <p {...stylex.props(styles.failed)}>The diagram could not be drawn.</p>
            ) : (
              <div
                ref={setElement}
                className="med-md-diagram med-md-diagram-large"
                role={mounted ? "img" : undefined}
                aria-label={mounted ? "Mermaid diagram" : undefined}
                style={
                  width ? ({ "--med-diagram-width": `${width}px` } as CSSProperties) : undefined
                }
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  backdrop: { zIndex: 110 },
  popup: {
    position: "fixed",
    inset: 24,
    zIndex: 111,
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: tokens.shadow,
    outline: "none",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
    paddingBlock: 6,
    paddingLeft: 14,
    paddingRight: 6,
  },
  title: {
    margin: 0,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
  },
  room: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    paddingTop: TOP,
    paddingBottom: BOTTOM,
    paddingInline: SIDES,
  },
  failed: {
    margin: 0,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 13,
    textAlign: "center",
  },
});
