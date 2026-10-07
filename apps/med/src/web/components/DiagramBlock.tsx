import { useEffect, useRef, useState } from "react";
import { renderDiagram } from "../markdown/diagrams";
import type { MarkdownBlock } from "../markdown/model";

/** A Mermaid block from the Markdown worker. It renders when it nears the
 * viewport and shows its source when the diagram cannot render. Previews and
 * briefs share it; the styles are in MarkdownPreview.css. */
export function DiagramBlock({ block, dark }: { block: MarkdownBlock; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void renderDiagram(block.diagram!, dark)
          .then((next) => {
            if (!cancelled) {
              setSvg(next);
              setFailed(false);
            }
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: "300px" },
    );
    observer.observe(host.current!);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [block.diagram, dark]);
  return (
    <div
      ref={host}
      className="med-md-block"
      data-block-line={block.start}
      data-block-end={block.end}
    >
      <pre
        data-mermaid="true"
        data-language="mermaid"
        data-rendered={svg && !failed ? "true" : undefined}
        data-diagram-error={failed ? "true" : undefined}
      >
        {svg && !failed ? (
          <div
            className="med-md-diagram"
            role="img"
            aria-label="Mermaid diagram"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <code>{block.diagram}</code>
        )}
      </pre>
    </div>
  );
}
