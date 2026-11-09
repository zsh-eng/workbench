import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Mounted } from "pele/lazy";
import { mountDiagram } from "../markdown/diagrams";
import type { MarkdownBlock } from "../markdown/model";
import { useTheme } from "../themes";
import { Icon } from "./Icon";

const DiagramDialog = lazy(() =>
  import("./DiagramDialog").then((module) => ({ default: module.DiagramDialog })),
);

/** A Mermaid block from the Markdown worker. It draws when it nears the
 * viewport and shows its source until then, or when the diagram cannot draw.
 * Full screen, at its corner, shows it larger over the page. Previews and
 * briefs share it; the styles are in MarkdownPreview.css. */
export function DiagramBlock({ block }: { block: MarkdownBlock }) {
  const host = useRef<HTMLPreElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted>(undefined);
  const [state, setState] = useState<"source" | "drawn" | "failed">("source");
  // Full screen, with the size that the page drew the diagram at.
  const [large, setLarge] = useState<{ natural?: { width: number; height: number } } | null>(null);
  const theme = useTheme().active.id;
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
          <button
            type="button"
            className="med-md-expand"
            aria-label="Show the diagram full screen"
            title="Full screen"
            onClick={() => {
              const drawn = mounted.current?.result;
              setLarge({ natural: drawn && { width: drawn.width, height: drawn.height } });
            }}
          >
            <Icon name="focus" size={14} />
          </button>
        )}
      </pre>
      {large && (
        <Suspense fallback={null}>
          <DiagramDialog
            source={block.diagram!}
            natural={large.natural}
            onClose={() => setLarge(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
