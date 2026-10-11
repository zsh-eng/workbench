import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderBrief, renderedBrief } from "../../markdown/brief-render";
import type { MarkdownResult } from "../../markdown/model";
import { useTheme } from "../../themes";
import { DiagramBlock } from "../DiagramBlock";
import "../MarkdownPreview.css";

/**
 * One reply as Markdown, rendered in the brief's worker. While the reply
 * streams, one render runs at a time and the newest text goes next, so a
 * fast stream does not queue a render for each chunk. Until the first render
 * arrives, the text shows as it is.
 */
export const SessionMarkdown = memo(function SessionMarkdown({
  text,
  streaming,
  onOpenLink,
}: {
  text: string;
  streaming: boolean;
  /** A link to a file in the repository, such as src/summary.ts:5. */
  onOpenLink?(href: string): void;
}) {
  const { active: theme } = useTheme();
  const [rendered, setRendered] = useState<MarkdownResult>();
  // A reply that rendered before, as when it scrolls back into a list, shows at once.
  const result = renderedBrief(theme.pierreTheme, text, "session") ?? rendered;
  const host = useRef<HTMLDivElement>(null);
  // The newest request; a render that finishes starts the next one from here.
  const latest = useRef({ text, theme: theme.pierreTheme, streaming });
  const pump = useRef({ running: false, mounted: true });
  const open = useRef(onOpenLink);

  useLayoutEffect(() => {
    latest.current = { text, theme: theme.pierreTheme, streaming };
    open.current = onOpenLink;
  });

  useEffect(() => {
    const state = pump.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);

  useEffect(() => {
    const state = pump.current;
    if (renderedBrief(theme.pierreTheme, text, "session") || state.running) return;
    const run = (request: typeof latest.current) => {
      state.running = true;
      renderBrief(request.theme, request.text, true, { cache: "session", keep: !request.streaming })
        .then((next) => {
          if (state.mounted) setRendered(next);
        })
        .catch(() => {})
        .finally(() => {
          state.running = false;
          const next = latest.current;
          const changed = next.text !== request.text || next.theme !== request.theme;
          if (state.mounted && (changed || (request.streaming && !next.streaming))) run(next);
        });
    };
    run(latest.current);
  }, [text, streaming, theme.pierreTheme]);

  // Links to files open in Med; web links open in a new tab from the worker's HTML.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const follow = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLElement>("a[data-brief-href]");
      const href = link?.dataset.briefHref;
      if (!href || /^https?:/i.test(href)) return;
      event.preventDefault();
      open.current?.(href);
    };
    node.addEventListener("click", follow);
    return () => node.removeEventListener("click", follow);
  }, []);

  return (
    <div ref={host} className="med-md-prose med-session-prose">
      {result ? (
        result.blocks.map((block, index) =>
          block.diagram !== undefined ? (
            <DiagramBlock key={index} block={block} dark={theme.appearance === "dark"} />
          ) : (
            <div
              key={index}
              className="med-md-block"
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          ),
        )
      ) : (
        <p className="med-session-plain">{text}</p>
      )}
    </div>
  );
});
