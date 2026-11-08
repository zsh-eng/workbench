import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderBrief, renderedBrief } from "../../markdown/brief-render";
import { loadMarkdownImages, markdownImageUrl } from "../../markdown/images";
import type { MarkdownResult } from "../../markdown/model";
import { useTheme } from "../../themes";
import { fileRefOf } from "../../data/file-refs";
import { DiagramBlock } from "../DiagramBlock";
import { useFileRefBlocks, useFileRefs } from "../FileRefs";
import { ReviewLinkCard } from "./HandoffCard";
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
  imageRepo,
  onOpenLink,
}: {
  text: string;
  streaming: boolean;
  /** The checkout that an image's relative path starts from. A thread loads no images. */
  imageRepo?: string;
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
  // Paths that name a file of the thread's checkout are links to it.
  const refs = useFileRefs();
  const fileRefs = useRef(refs);
  const blocks = useFileRefBlocks(result?.blocks);
  const reviewLinks = useMemo(() => blocks?.map((block) => reviewLinkOf(block.html)), [blocks]);

  useLayoutEffect(() => {
    latest.current = { text, theme: theme.pierreTheme, streaming };
    open.current = onOpenLink;
    fileRefs.current = refs;
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
      const file = fileRefOf(event.target as Element);
      if (file) {
        event.preventDefault();
        fileRefs.current?.open(file, event.metaKey || event.ctrlKey);
        return;
      }
      const link = (event.target as Element).closest<HTMLElement>("a[data-brief-href]");
      const href = link?.dataset.briefHref;
      if (!href || /^https?:/i.test(href)) return;
      event.preventDefault();
      open.current?.(href);
    };
    node.addEventListener("click", follow);
    return () => node.removeEventListener("click", follow);
  }, []);

  useEffect(() => {
    if (!imageRepo || !host.current) return;
    const source = { kind: "worktree" as const, repo: imageRepo };
    loadMarkdownImages(host.current, (raw) => markdownImageUrl(raw, source, "BRIEF.md"));
  }, [blocks, imageRepo]);

  return (
    <div ref={host} className="med-md-prose med-session-prose">
      {blocks ? (
        blocks.map((block, index) =>
          block.diagram !== undefined ? (
            <DiagramBlock key={index} block={block} />
          ) : reviewLinks?.[index] ? (
            <ReviewLinkCard key={index} {...reviewLinks[index]} />
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

// A review of Med's, as `med review create` prints it: on this machine.
const REVIEW_URL = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/review\/([\w-]+)\/?$/i;
const reviewLinks = new Map<string, { id: string; href: string; text: string } | null>();
/** A paragraph that is only a link to a review of Med's, which shows as the
 * review's card (ReviewLinkCard); null for any other block. */
function reviewLinkOf(html: string) {
  if (!html.includes("/review/")) return null;
  const known = reviewLinks.get(html);
  if (known !== undefined) return known;
  const template = document.createElement("template");
  template.innerHTML = html;
  const parts = (node: ParentNode) =>
    [...node.childNodes].filter((child) => child.nodeType !== 3 || child.textContent?.trim());
  const [paragraph, ...others] = parts(template.content);
  const [link, ...rest] = paragraph instanceof HTMLParagraphElement ? parts(paragraph) : [];
  const href =
    link instanceof HTMLAnchorElement
      ? (link.dataset.briefHref ?? link.getAttribute("href"))
      : null;
  const id = !others.length && !rest.length && href ? REVIEW_URL.exec(href)?.[1] : undefined;
  const found = id ? { id, href: href!, text: link!.textContent?.trim() || "Review" } : null;
  if (reviewLinks.size > 200) reviewLinks.clear();
  reviewLinks.set(html, found);
  return found;
}
