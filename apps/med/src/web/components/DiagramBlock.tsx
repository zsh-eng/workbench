import * as stylex from "@stylexjs/stylex";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Mounted } from "pele/lazy";
import { mountDiagram } from "../markdown/diagrams";
import type { MarkdownBlock } from "../markdown/model";
import { tokens } from "../theme.stylex";
import { useTheme } from "../themes";
import {
  CopyNoteText,
  DiagramCopyMenu,
  diagramCopies,
  pointItems,
  useCopyNote,
} from "./DiagramCopy";
import { Icon } from "./Icon";
import { PointMenu, type PointMenuState } from "./PointMenu";
import { preloadable } from "./preloadable";
import { tooltip } from "./ToolButton";

// Loaded once a diagram draws, so Full screen opens in the click's frame:
// React.lazy would suspend on the first open and hold the dialog back 300 ms.
const DiagramDialog = preloadable(async () => ({
  default: (await import("./DiagramDialog")).DiagramDialog,
}));

/** A Mermaid block from the Markdown worker. It draws when it nears the
 * viewport and shows its source until then, or when the diagram cannot draw.
 * Copy and Full screen, at its corner, show while the pointer or the focus is
 * on it; right-click offers the same copies. Previews and briefs share it; the
 * styles are in MarkdownPreview.css. */
export function DiagramBlock({ block }: { block: MarkdownBlock }) {
  const host = useRef<HTMLPreElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted>(undefined);
  const [state, setState] = useState<"source" | "drawn" | "failed">("source");
  // Full screen, with the size that the page drew the diagram at.
  const [large, setLarge] = useState<{ natural?: { width: number; height: number } } | null>(null);
  const [menu, setMenu] = useState<PointMenuState | null>(null);
  const [note, say] = useCopyNote();
  const theme = useTheme().active.id;
  const source = block.diagram!;
  const figure = useCallback(() => target.current, []);
  useEffect(() => {
    // An edit draws again in place. After a mistake Pele keeps the last
    // drawing, dimmed, above a line that names it, so the text does not jump.
    if (mounted.current) return mounted.current.update(block.diagram!);
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        mountDiagram(target.current!, block.diagram!).then(
          (diagram) => {
            if (cancelled) return diagram.destroy();
            mounted.current = diagram;
            // Before the next paint, so the drawing never shows above its source.
            flushSync(() => setState("drawn"));
            DiagramDialog.preload();
          },
          () => !cancelled && setState("failed"),
        );
      },
      { rootMargin: "300px" },
    );
    observer.observe(host.current!);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [block.diagram]);
  useEffect(
    () => () => {
      mounted.current?.destroy();
      mounted.current = undefined;
    },
    [],
  );
  // A theme can change the font, which sizes the labels; colors follow by CSS.
  useEffect(() => mounted.current?.refresh(), [theme]);
  // Right-click on the drawing opens the copies; on its source, the
  // browser's menu. The listener is the element's own, so it runs before a
  // page's listener above it (MarkdownPreview), which leaves a handled event.
  useEffect(() => {
    const pre = host.current;
    if (state !== "drawn" || !pre) return;
    const open = (event: MouseEvent) => {
      if (!target.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: "Diagram actions",
        items: pointItems(diagramCopies(figure, source, say)),
      });
    };
    pre.addEventListener("contextmenu", open);
    return () => pre.removeEventListener("contextmenu", open);
  }, [state, figure, source, say]);
  return (
    <div className="med-md-block" data-block-line={block.start} data-block-end={block.end}>
      <pre
        ref={host}
        data-mermaid="true"
        data-language="mermaid"
        data-rendered={state === "drawn" ? "true" : undefined}
        data-diagram-error={state === "failed" ? "true" : undefined}
      >
        <div
          ref={target}
          className="med-md-diagram"
          role={state === "drawn" ? "img" : undefined}
          aria-label={state === "drawn" ? "Mermaid diagram" : undefined}
          hidden={state === "failed"}
        />
        {state !== "drawn" && <code>{block.diagram}</code>}
        {state === "drawn" && (
          // Not prose: a brief's passages skip the buttons and the note.
          <div
            className="med-md-diagram-tools"
            data-noted={note ? "" : undefined}
            data-passage-ui=""
          >
            <CopyNoteText note={note} />
            <DiagramCopyMenu
              figure={figure}
              source={source}
              say={say}
              copied={!!note && !note.failed}
              trigger={styles.tool}
            />
            <button
              type="button"
              aria-label="Show the diagram full screen"
              {...tooltip("Full screen")}
              {...stylex.props(styles.tool)}
              onClick={() => {
                const drawn = mounted.current?.result;
                setLarge({ natural: drawn && { width: drawn.width, height: drawn.height } });
              }}
            >
              <Icon name="focus" size={14} />
            </button>
          </div>
        )}
      </pre>
      {/* Only while open: a thread can hold many diagrams. */}
      {menu && <PointMenu menu={menu} onClose={() => setMenu(null)} />}
      {large && (
        <Suspense fallback={null}>
          <DiagramDialog source={source} natural={large.natural} onClose={() => setLarge(null)} />
        </Suspense>
      )}
    </div>
  );
}

const surface = "var(--med-md-surface, var(--med-panel))";
const styles = stylex.create({
  // A square on the diagram's surface, so it reads over the drawing's edge.
  tool: {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 30,
    padding: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${tokens.text} 20%, ${surface})`,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: {
      default: surface,
      ":hover": `color-mix(in srgb, ${tokens.text} 7%, ${surface})`,
    },
    color: tokens.text,
    cursor: "pointer",
    outlineColor: tokens.accent,
    outlineOffset: -2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
  },
});
