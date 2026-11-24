import {
  memo,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keepBrief, renderBrief, renderedBrief } from "../../markdown/brief-render";
import { useKeptFolds } from "../../markdown/folds";
import { loadMarkdownImages, markdownImageUrl } from "../../markdown/images";
import type { MarkdownResult } from "../../markdown/model";
import { useTheme } from "../../themes";
import { branchRefOf, fileRefOf } from "../../data/file-refs";
import { useCodeCopy } from "../CodeCopy";
import { DiagramBlock } from "../DiagramBlock";
import { ChartBlock } from "../chart/ChartBlock";
import { useFileRefBlocks, useFileRefs } from "../FileRefs";
import { useTableCopy } from "../TableCopy";
import { HandoffContext, medReviewId, openMedReview, ReviewLinkCard } from "./HandoffCard";
import {
  DashboardBeside,
  DashboardLinkCard,
  medDashboardPath,
  openDashboardPath,
} from "./DashboardLinkCard";
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
  settled = false,
  imageRepo,
  onOpenLink,
  at,
}: {
  text: string;
  /** The thread's latest reply while the agent works: its text can grow. */
  streaming: boolean;
  /** A streamed reply's text is whole: its render is kept for the
   * transcript's copy, which then shows at once. */
  settled?: boolean;
  /** The checkout that an image's relative path starts from. A thread loads no images. */
  imageRepo?: string;
  /** A link to a file in the repository, such as src/summary.ts:5. */
  onOpenLink?(href: string): void;
  /** When the agent wrote it: a chart's range relative to now counts from here. */
  at?: number;
}) {
  const { active: theme } = useTheme();
  const [rendered, setRendered] = useState<MarkdownResult>();
  // A reply that rendered before, as when it scrolls back into a list, shows at once.
  const result = renderedBrief(theme.pierreTheme, text, "session") ?? rendered;
  const host = useRef<HTMLDivElement>(null);
  // The newest request; a render that finishes starts the next one from here.
  const latest = useRef({ text, theme: theme.pierreTheme, streaming, settled });
  const pump = useRef({ running: false, mounted: true });
  const lastRendered = useRef<{ text: string; theme: string; result: MarkdownResult } | null>(null);
  const open = useRef(onOpenLink);
  // Paths that name a file of the thread's checkout are links to it.
  const refs = useFileRefs();
  const fileRefs = useRef(refs);
  const blocks = useFileRefBlocks(result?.blocks);
  const reviewLinks = useMemo(() => blocks?.map((block) => reviewLinkOf(block.html)), [blocks]);
  const dashboardLinks = useMemo(
    () => blocks?.map((block) => dashboardLinkOf(block.html)),
    [blocks],
  );
  // A link to a dashboard of this Med's opens it beside the thread.
  const beside = useContext(DashboardBeside);
  const besideNow = useRef(beside);
  // A link to a review of this Med's opens it here, not in a new window.
  const handoff = useContext(HandoffContext);
  const reviews = useRef(handoff);
  // A table copies as its Markdown, from this reply's text, and as a table.
  useTableCopy(host, () => text);
  // A code block copies as its fence holds it, once the reply has closed it.
  useCodeCopy(host, streaming);
  useKeptFolds(host);
  useReveal(host, blocks, streaming);

  useLayoutEffect(() => {
    latest.current = { text, theme: theme.pierreTheme, streaming, settled };
    open.current = onOpenLink;
    fileRefs.current = refs;
    reviews.current = handoff;
    besideNow.current = beside;
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
    if (renderedBrief(theme.pierreTheme, text, "session")) return;
    // If the exact text and theme were already rendered while streaming,
    // promote that result into the cache instead of running a duplicate worker pass.
    if (
      (!streaming || settled) &&
      lastRendered.current &&
      lastRendered.current.text === text &&
      lastRendered.current.theme === theme.pierreTheme
    ) {
      keepBrief(theme.pierreTheme, text, lastRendered.current.result, "session");
      return;
    }
    if (state.running) return;
    const run = (request: typeof latest.current) => {
      state.running = true;
      renderBrief(request.theme, request.text, true, {
        cache: "session",
        keep: !request.streaming || request.settled,
      })
        .then((next) => {
          lastRendered.current = { text: request.text, theme: request.theme, result: next };
          if (state.mounted) setRendered(next);
        })
        .catch(() => {})
        .finally(() => {
          state.running = false;
          const next = latest.current;
          const changed = next.text !== request.text || next.theme !== request.theme;
          if (!state.mounted) return;
          if (changed) {
            run(next);
            return;
          }
          const kept = (request.streaming && !next.streaming) || (!request.settled && next.settled);
          if (
            kept &&
            lastRendered.current &&
            lastRendered.current.text === next.text &&
            lastRendered.current.theme === next.theme
          ) {
            keepBrief(next.theme, next.text, lastRendered.current.result, "session");
          } else if (kept) {
            run(next);
          }
        });
    };
    run(latest.current);
  }, [text, streaming, settled, theme.pierreTheme]);

  // Links to files open in Med; web links open in a new tab from the worker's HTML.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const follow = (event: MouseEvent) => {
      const branch = branchRefOf(event.target as Element);
      if (branch) {
        event.preventDefault();
        fileRefs.current?.branches?.open(branch, event.metaKey || event.ctrlKey);
        return;
      }
      const file = fileRefOf(event.target as Element);
      if (file) {
        event.preventDefault();
        fileRefs.current?.open(file, event.metaKey || event.ctrlKey);
        return;
      }
      const link = (event.target as Element).closest<HTMLElement>("a[data-brief-href]");
      const href = link?.dataset.briefHref;
      if (!href) return;
      const dashboard = medDashboardPath(href);
      if (dashboard && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
        event.preventDefault();
        openDashboardPath(dashboard, besideNow.current);
        return;
      }
      const review = reviews.current && medReviewId(href);
      if (review && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
        event.preventDefault();
        openMedReview(review, reviews.current);
        return;
      }
      if (/^https?:/i.test(href)) return;
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
          ) : block.chart !== undefined ? (
            <ChartBlock key={`${index}:${block.chart}`} text={block.chart} at={at} />
          ) : reviewLinks?.[index] ? (
            <ReviewLinkCard key={index} {...reviewLinks[index]} />
          ) : dashboardLinks?.[index] ? (
            <DashboardLinkCard key={index} {...dashboardLinks[index]} />
          ) : (
            <div
              key={index}
              className="med-md-block"
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          ),
        )
      ) : streaming ? null : (
        // A reply that streams shows each block rendered, as it fades in.
        <p className="med-session-plain">{text}</p>
      )}
    </div>
  );
});

/** Blocks that a streaming reply showed, by their HTML: the same block
 * shows again without its fade, as when the transcript's copy replaces the
 * reply that streamed. */
const revealed = new Set<string>();
/**
 * Fades in each block that a streaming reply adds, once. A reply that
 * streams arrives in whole blocks (streamed-replies.ts), so a block's HTML
 * does not change after it shows.
 */
function useReveal(
  host: RefObject<HTMLDivElement | null>,
  blocks: readonly { html: string }[] | undefined,
  streaming: boolean,
) {
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || !blocks || !streaming) return;
    blocks.forEach((block, index) => {
      if (revealed.has(block.html)) return;
      if (revealed.size > 500) revealed.clear();
      revealed.add(block.html);
      node.children[index]?.classList.add("med-reveal");
    });
  }, [host, blocks, streaming]);
}

const dashboardLinks = new Map<string, { path: string; text: string } | null>();
/** A paragraph that is only a link to a dashboard of Med's, as `med dashboard
 * link` prints it, which shows as its card; null for any other block. */
function dashboardLinkOf(html: string) {
  if (!html.includes("/dashboards/")) return null;
  const known = dashboardLinks.get(html);
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
  const path = !others.length && !rest.length && href ? medDashboardPath(href) : undefined;
  const found = path ? { path, text: link!.textContent?.trim() || "Dashboard" } : null;
  if (dashboardLinks.size > 200) dashboardLinks.clear();
  dashboardLinks.set(html, found);
  return found;
}

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
  const id = !others.length && !rest.length && href ? medReviewId(href) : undefined;
  const found = id ? { id, href: href!, text: link!.textContent?.trim() || "Review" } : null;
  if (reviewLinks.size > 200) reviewLinks.clear();
  reviewLinks.set(html, found);
  return found;
}
