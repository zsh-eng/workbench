import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { resolveTheme } from "@pierre/diffs";
import type { FileRead } from "../../shared/local-file";
import { useTheme } from "../themes";
import type {
  MarkdownModel,
  MarkdownBlock,
  MarkdownHeading,
  MarkdownResult,
} from "../markdown/model";
import { connectPreviewScroll } from "../markdown/scroll";
import RenderWorker from "../markdown/render.worker?worker";
import type { Mounted } from "pele/lazy";
import { mountDiagram } from "../markdown/diagrams";
import { DiagramBlock } from "./DiagramBlock";
import "katex/dist/katex.min.css";
import "./MarkdownPreview.css";
import { relativeFileLink } from "../markdown/file-link";
import { markdownImageUrl } from "../markdown/images";

const Block = memo(
  function Block({
    block,
    source,
    path,
    vault,
  }: {
    block: MarkdownBlock;
    source: FileRead["source"];
    path: string;
    vault?: boolean;
  }) {
    const element = useRef<HTMLDivElement>(null);
    const mounted = useRef<Mounted[]>([]);
    const theme = useTheme().active.id;
    useEffect(() => {
      if (block.diagram !== undefined) return;
      const host = element.current!;
      let cancelled = false;
      for (const image of host.querySelectorAll<HTMLImageElement>("img[data-image-source]")) {
        const raw = image.dataset.imageSource ?? "";
        let url: string | undefined;
        try {
          url = markdownImageUrl(raw, source, path, vault);
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
      // A diagram inside a list or a quote; a top-level one is a DiagramBlock.
      const diagrams: Mounted[] = [];
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const pre = entry.target as HTMLElement;
            const code = pre.querySelector("code")!;
            const figure = document.createElement("div");
            figure.className = "med-md-diagram";
            pre.prepend(figure);
            mountDiagram(figure, code.textContent ?? "").then(
              (diagram) => {
                if (cancelled) return diagram.destroy();
                diagrams.push(diagram);
                figure.setAttribute("role", "img");
                figure.setAttribute("aria-label", "Mermaid diagram");
                code.remove();
                pre.dataset.rendered = "true";
              },
              () => {
                if (cancelled) return;
                figure.remove();
                pre.dataset.diagramError = "true";
              },
            );
          }
        },
        { rootMargin: "300px" },
      );
      host
        .querySelectorAll("pre[data-mermaid]:not([data-rendered])")
        .forEach((pre) => observer.observe(pre));
      mounted.current = diagrams;
      return () => {
        cancelled = true;
        observer.disconnect();
        for (const diagram of diagrams) diagram.destroy();
        mounted.current = [];
      };
    }, [block.html, block.diagram, source, path, vault]);
    // A theme can change the font, which sizes the labels; colors follow by CSS.
    useEffect(() => {
      for (const diagram of mounted.current) diagram.refresh();
    }, [theme]);
    if (block.diagram !== undefined) return <DiagramBlock block={block} />;
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
    a.vault === b.vault,
);

/**
 * The headings that the table of contents lists: a document's one top-level
 * heading is its title, which the page shows at its top, so the list starts
 * below it. Fewer than three is too short a document to need the list.
 */
function contentsOf(headings: MarkdownHeading[]) {
  const titles = headings.filter((heading) => heading.level === 1);
  const listed = titles.length === 1 && headings[0] === titles[0] ? headings.slice(1) : headings;
  if (listed.length < 3) return [];
  const top = Math.min(...listed.map((heading) => heading.level));
  return listed.map((heading) => ({ ...heading, depth: heading.level - top }));
}

export default function MarkdownPreview({
  model,
  file,
  onOpenFile,
}: {
  model: MarkdownModel;
  file: FileRead;
  onOpenFile?(path: string, line?: number): void;
}) {
  const canOpenFiles = !!onOpenFile;
  const { active } = useTheme();
  const text = useSyncExternalStore(model.subscribe, model.getText);
  const [result, setResult] = useState<MarkdownResult>();
  const [error, setError] = useState("");
  const [heading, setHeading] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const contents = useRef<HTMLElement>(null);
  const scrollController = useRef<ReturnType<typeof connectPreviewScroll> | null>(null);
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
            if (id === sequence.current)
              worker.current?.postMessage({
                id,
                text,
                theme,
                vault: "vault" in file && !!file.vault,
                fileLinks: canOpenFiles,
              });
          })
          .catch(() => setError("Preview theme could not load."));
      },
      result ? 100 : 0,
    );
    return () => clearTimeout(timer);
    // A result must not schedule another parse. Only source or theme changes do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active.pierreTheme, canOpenFiles]);

  useLayoutEffect(() => {
    const pane = scroller.current;
    if (!pane || !result) return;
    const controller = connectPreviewScroll(pane, model);
    scrollController.current = controller;
    return () => {
      controller.dispose();
      scrollController.current = null;
    };
  }, [model, result]);
  useEffect(() => {
    const pane = scroller.current;
    if (!pane) return;
    const followLink = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href^='#']");
      if (!anchor) return;
      event.preventDefault();
      const relative = anchor.getAttribute("data-file-link");
      if (relative && onOpenFile) {
        try {
          const target = relativeFileLink(file.path, relative);
          onOpenFile(target.path, target.line);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not open this link.");
        }
        return;
      }
      if (anchor.hasAttribute("data-vault-link")) {
        window.dispatchEvent(
          new CustomEvent("med-vault-navigate", {
            detail: {
              href: anchor.getAttribute("data-vault-link"),
              syntax: anchor.getAttribute("data-vault-syntax"),
            },
          }),
        );
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(anchor.getAttribute("href")!.slice(1));
      } catch {
        return;
      }
      const target = pane.querySelector(`#${CSS.escape(id)}`);
      if (target) scrollController.current?.reveal(target);
    };
    pane.addEventListener("click", followLink);
    return () => pane.removeEventListener("click", followLink);
  }, [file.path, onOpenFile]);
  const toc = result ? contentsOf(result.headings) : [];
  // The heading being read: the last one above a line near the pane's top,
  // or the last one once the pane reaches the document's end.
  const updateHeading = () => {
    const pane = scroller.current;
    if (!pane || !toc.length) return;
    const nodes = toc.flatMap(({ id }) => {
      const node = pane.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      return node ? [node] : [];
    });
    const atEnd = pane.scrollTop > 0 && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    const top = pane.getBoundingClientRect().top + 100;
    const current = atEnd
      ? nodes.at(-1)
      : nodes.findLast((node) => node.getBoundingClientRect().top <= top);
    setHeading(current?.id ?? "");
  };
  // A list taller than the pane scrolls to keep the current heading in view.
  useEffect(() => {
    const list = contents.current;
    const entry = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !entry || list.scrollHeight <= list.clientHeight) return;
    const above = entry.offsetTop - list.scrollTop;
    if (above < 24 || above + entry.offsetHeight > list.clientHeight - 24)
      list.scrollTop = entry.offsetTop - list.clientHeight / 2;
  }, [heading]);
  const read = toc.findIndex(({ id }) => id === heading);
  return (
    <section className="med-markdown" aria-label="Markdown preview">
      {error && (
        <div role="alert" className="med-md-notice">
          {error}
        </div>
      )}
      <div
        className="med-md-scroll"
        ref={scroller}
        onScroll={updateHeading}
        data-render-ms={result?.milliseconds}
      >
        <div className="med-md-page" data-toc={toc.length ? "" : undefined}>
          {toc.length > 0 && (
            <nav className="med-md-toc" aria-label="Table of contents" ref={contents}>
              <ol>
                {toc.map((h, index) => (
                  <li key={h.id}>
                    <button
                      aria-current={heading === h.id ? "location" : undefined}
                      data-read={index < read ? "" : undefined}
                      style={{ "--med-md-toc-depth": h.depth } as CSSProperties}
                      onClick={() => {
                        const target = scroller.current?.querySelector(`#${CSS.escape(h.id)}`);
                        if (target) scrollController.current?.reveal(target);
                        model.navigate(h.line);
                        setHeading(h.id);
                      }}
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <article className="med-md-prose">
            {result?.blocks.map((block, index) => (
              <Block
                key={index}
                block={block}
                vault={"vault" in file && !!file.vault}
                source={file.source}
                path={file.path}
              />
            ))}
            {result && !result.blocks.length && (
              <p className="med-md-empty">Your words will appear here.</p>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
