import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { resolveTheme } from "@pierre/diffs";
import type { FileRead } from "../../shared/local-file";
import { useTheme } from "../themes";
import type {
  MarkdownModel,
  MarkdownBlock,
  MarkdownResult,
  PreviewPosition,
} from "../markdown/model";
import RenderWorker from "../markdown/render.worker?worker";
import { renderDiagram } from "../markdown/diagrams";
import "katex/dist/katex.min.css";
import "./MarkdownPreview.css";

function imageUrl(raw: string, source: FileRead["source"], path: string) {
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    return url.origin !== location.origin ? url.href : undefined;
  }
  if (
    /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(raw) &&
    raw.length < 2_000_000
  )
    return raw;
  if (source.kind === "drop" || /^(?:[a-z][\w+.-]*:|\/)/i.test(raw)) return;
  return `/api/markdown/image?${new URLSearchParams({ source: JSON.stringify(source), document: path, href: raw })}`;
}
function DiagramBlock({ block, dark }: { block: MarkdownBlock; dark: boolean }) {
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
const Block = memo(
  function Block({
    block,
    source,
    path,
    dark,
  }: {
    block: MarkdownBlock;
    source: FileRead["source"];
    path: string;
    dark: boolean;
  }) {
    const element = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (block.diagram !== undefined) return;
      const host = element.current!;
      let cancelled = false;
      for (const image of host.querySelectorAll<HTMLImageElement>("img[data-image-source]")) {
        const raw = image.dataset.imageSource ?? "";
        let url: string | undefined;
        try {
          url = imageUrl(raw, source, path);
        } catch {
          /* Display the alt text. */
        }
        if (url) image.src = url;
        else
          image.title =
            source.kind === "drop"
              ? "Open the file by its disk path to load relative images."
              : "This image URL is not supported.";
        image.onerror = () => {
          image.title = `Image unavailable: ${raw}`;
        };
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const pre = entry.target as HTMLElement;
            const code = pre.querySelector("code")!;
            const source = code.textContent ?? "";
            void renderDiagram(source, dark)
              .then((svg) => {
                if (cancelled) return;
                const figure = document.createElement("div");
                figure.className = "med-md-diagram";
                figure.setAttribute("role", "img");
                figure.setAttribute("aria-label", "Mermaid diagram");
                figure.innerHTML = svg;
                pre.replaceChildren(figure);
                pre.dataset.rendered = "true";
              })
              .catch(() => {
                if (cancelled) return;
                pre.dataset.diagramError = "true";
                pre.title = "Diagram could not render. Check the Mermaid syntax.";
              });
          }
        },
        { rootMargin: "300px" },
      );
      host
        .querySelectorAll("pre[data-mermaid]:not([data-rendered])")
        .forEach((pre) => observer.observe(pre));
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }, [block.html, block.diagram, source, path, dark]);
    if (block.diagram !== undefined) return <DiagramBlock block={block} dark={dark} />;
    return (
      <div
        ref={element}
        className="med-md-block"
        data-block-line={block.start}
        data-block-end={block.end}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  },
  (a, b) =>
    a.block.html === b.block.html &&
    a.block.start === b.block.start &&
    a.block.end === b.block.end &&
    a.source === b.source &&
    a.path === b.path &&
    a.dark === b.dark,
);

export default function MarkdownPreview({ model, file }: { model: MarkdownModel; file: FileRead }) {
  const { active } = useTheme();
  const text = useSyncExternalStore(model.subscribe, model.getText);
  const [result, setResult] = useState<MarkdownResult>();
  const [error, setError] = useState("");
  const [heading, setHeading] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const instance = new RenderWorker();
    worker.current = instance;
    instance.onmessage = ({ data }) => {
      if (data.id !== sequence.current) return;
      if (data.error) setError(data.error);
      else {
        setResult(data);
        setError("");
      }
    };
    instance.onerror = () =>
      setError("Markdown preview could not load. Close and reopen Preview to retry.");
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    const id = ++sequence.current;
    const timer = setTimeout(
      () => {
        void resolveTheme(active.pierreTheme)
          .then((theme) => {
            if (id === sequence.current) worker.current?.postMessage({ id, text, theme });
          })
          .catch(() => setError("Preview theme could not load."));
      },
      result ? 100 : 0,
    );
    return () => clearTimeout(timer);
    // A result must not schedule another parse. Only source or theme changes do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active.pierreTheme]);

  useLayoutEffect(() => {
    const pane = scroller.current;
    if (!pane || !result) return;
    let frame = 0;
    const follow = ({ line, reason }: PreviewPosition) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const blocks = [...pane.querySelectorAll<HTMLElement>("[data-block-line]")];
        const block =
          blocks.findLast((item) => Number(item.dataset.blockLine) <= line) ?? blocks[0];
        if (!block) return;
        const start = Number(block.dataset.blockLine),
          end = Number(block.dataset.blockEnd);
        const ratio = Math.max(0, Math.min(1, (line - start) / Math.max(1, end - start + 1)));
        const bounds = pane.getBoundingClientRect(),
          rect = block.getBoundingClientRect();
        const y = rect.top - bounds.top + Math.min(rect.height, ratio * rect.height);
        pane.dataset.followLine = String(line);
        if (reason === "scroll" || y < 48 || y > bounds.height * 0.8) {
          const top = pane.scrollTop + y - (reason === "scroll" ? 40 : bounds.height * 0.3);
          pane.scrollTo({
            top,
            behavior:
              reason === "cursor" && !matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "smooth"
                : "instant",
          });
        }
      });
    };
    const unsubscribe = model.subscribePosition(follow);
    follow(model.getPosition());
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [model, result]);
  useEffect(() => {
    const pane = scroller.current;
    if (!pane) return;
    const followLink = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href^='#']");
      if (!anchor) return;
      event.preventDefault();
      let id: string;
      try {
        id = decodeURIComponent(anchor.getAttribute("href")!.slice(1));
      } catch {
        return;
      }
      pane.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
    };
    pane.addEventListener("click", followLink);
    return () => pane.removeEventListener("click", followLink);
  }, []);
  const updateHeading = () => {
    const pane = scroller.current;
    if (!pane || !result) return;
    const top = pane.getBoundingClientRect().top + 100;
    const nodes = [
      ...pane.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]"),
    ];
    const current = nodes.findLast((node) => node.getBoundingClientRect().top <= top);
    setHeading(current?.id ?? result.headings[0]?.id ?? "");
  };
  return (
    <section className="med-markdown" aria-label="Markdown preview">
      <header className="med-md-header">
        <span>PREVIEW</span>
        <span>Markdown · live</span>
      </header>
      {error && (
        <div role="alert" className="med-md-notice">
          {error}
        </div>
      )}
      {!result && !error && (
        <div role="status" className="med-md-notice">
          Preparing preview…
        </div>
      )}
      <div className="med-md-layout">
        <div
          className="med-md-scroll"
          ref={scroller}
          onScroll={updateHeading}
          data-render-ms={result?.milliseconds}
        >
          <article className="med-md-prose">
            {result?.blocks.map((block, index) => (
              <Block
                key={`${index}:${active.id}`}
                block={block}
                source={file.source}
                path={file.path}
                dark={active.appearance === "dark"}
              />
            ))}
            {result && !result.blocks.length && (
              <p className="med-md-empty">Your words will appear here.</p>
            )}
          </article>
        </div>
        {result && result.headings.length > 1 && (
          <nav className="med-md-toc" aria-label="Table of contents">
            <span>ON THIS PAGE</span>
            {result.headings.map((h) => (
              <button
                key={h.id}
                aria-current={heading === h.id ? "location" : undefined}
                style={{ paddingLeft: 10 + (h.level - 1) * 10 }}
                onClick={() => {
                  scroller.current?.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({
                    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                    block: "start",
                  });
                  setHeading(h.id);
                }}
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}
      </div>
    </section>
  );
}
