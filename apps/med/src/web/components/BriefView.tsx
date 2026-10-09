import * as stylex from "@stylexjs/stylex";
import {
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffOptions,
  type SelectedLineRange,
} from "@pierre/diffs/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Note, NoteInput, NoteMutation } from "../../shared/protocol";
import type { ParsedReviewFile } from "../../shared/review";
import type { SavedBrief } from "../../shared/saved-review";
import {
  annotateBrief,
  diffExcerpt,
  sourceExcerpt,
  type BriefExcerpt,
  type Excerpt,
} from "../data/brief";
import type { MarkdownResult } from "../markdown/model";
import { renderBrief, renderedBrief } from "../markdown/brief-render";
import { useTheme } from "../themes";
import { tokens } from "../theme.stylex";
import { ActionMenu } from "./Controls";
import { DiagramBlock } from "./DiagramBlock";
import { markdownImageUrl } from "../markdown/images";
import { DiffStat } from "./DiffStat";
import { Icon } from "./Icon";
import { NoteCard, NoteComposer, type NoteTarget } from "./NoteCard";
import { diffSurfaceStyle, EXPANSION_LINES } from "./diff-surface";
import "./MarkdownPreview.css";
import "./BriefView.css";
import { visibleElement } from "../data/palette-focus";

export interface BriefLocation {
  fileId: string;
  side?: "old" | "new";
  start?: number;
  end?: number;
}
export interface BriefViewProps {
  brief: SavedBrief;
  /** All changed files of the saved comparison. */
  files: ParsedReviewFile[];
  /** Repository root, for absolute paths in links. */
  root?: string;
  /** The Brief tab is showing; its keys are active. */
  active: boolean;
  loadSource(path: string): Promise<{ old: string; new: string }>;
  onOpen(location: BriefLocation): void;
  onOpenPath(path: string, line?: number): void;
  onPaste(): void;
  onCopy(): void;
  onRemove(): void;
  /** Brief texts to render in the background, such as other iterations. */
  prerender?: readonly string[];
  /** An agent's iterations that have a brief, oldest first, and the shown one. */
  iterations?: readonly { number: number; createdAt: string }[];
  iteration?: number;
  onIteration?(number: number): void;
  /** Notes of the open comparison; excerpts show those on their lines. */
  notes: readonly Note[];
  onMutateNote(mutation: NoteMutation): Promise<void>;
}
interface Draft {
  key: string;
  target: NoteTarget;
}
interface Submission {
  draft: Draft;
  note: NoteInput;
  existing: Set<string>;
  error?: string;
}
type Annotation = { note?: Note; draft?: NoteTarget };

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The brief on screen, with the comparison it was annotated with. */
interface Shown {
  key: string;
  text: string;
  result: MarkdownResult;
  files: ParsedReviewFile[];
  root?: string;
}

const Block = memo(
  function Block({ html, start, end }: { html: string; start: number; end: number }) {
    return (
      <div
        className="med-md-block"
        data-block-line={start}
        data-block-end={end}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
  (a, b) => a.html === b.html && a.start === b.start && a.end === b.end,
);

/** The pasted explanation, with each cited range shown as a short diff below
 * the sentence that cites it, and the changed files it never mentions. */
export default function BriefView({
  brief,
  files: nextFiles,
  root: nextRoot,
  prerender,
  active,
  loadSource,
  onOpen,
  onOpenPath,
  onPaste,
  onCopy,
  onRemove,
  iterations,
  iteration,
  onIteration,
  notes,
  onMutateNote,
}: BriefViewProps) {
  const { active: theme } = useTheme();
  const key = `${theme.pierreTheme}\0${brief.text}`;
  // A new brief or comparison replaces the one on screen only when its
  // Markdown is ready, so both change in one frame and the page never blanks.
  const [rendered, setRendered] = useState<{ key: string; result: MarkdownResult } | null>(null);
  const available =
    renderedBrief(theme.pierreTheme, brief.text) ??
    (rendered?.key === key ? rendered.result : undefined);
  const [shown, setShown] = useState<Shown | undefined>(() =>
    available
      ? { key, text: brief.text, result: available, files: nextFiles, root: nextRoot }
      : undefined,
  );
  if (
    available &&
    (shown?.key !== key ||
      shown.result !== available ||
      shown.files !== nextFiles ||
      shown.root !== nextRoot)
  )
    setShown({ key, text: brief.text, result: available, files: nextFiles, root: nextRoot });
  const result = shown?.result;
  const files = shown?.files ?? nextFiles;
  const root = shown?.root ?? nextRoot;
  const [error, setError] = useState("");
  const pane = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const [slots, setSlots] = useState<Map<string, HTMLElement>>(() => new Map());
  const [linked, setLinked] = useState<string | null>(null);
  // One note draft at a time, in the excerpt where it started, as in Changes.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  // The controller publishes a saved note before its save completes; hide the
  // draft in that render so an excerpt never shows both.
  const draftSaved =
    !!draft &&
    submitted?.draft === draft &&
    notes.some(
      (note) =>
        !submitted.existing.has(note.id) &&
        !note.parentId &&
        note.path === draft.target.path &&
        note.side === draft.target.side &&
        note.line === draft.target.line,
    );
  const visibleDraft = draftSaved ? null : draft;
  // Another brief starts without the last one's note draft, selection, or scroll.
  const [shownText, setShownText] = useState(shown?.text);
  if (shown && shown.text !== shownText) {
    setShownText(shown.text);
    setDraft(null);
    setSelected(null);
    setSubmitted(null);
    setLinked(null);
  }
  const lastText = useRef(shownText);
  useLayoutEffect(() => {
    if (lastText.current === shownText) return;
    const first = lastText.current === undefined;
    lastText.current = shownText;
    if (!first) pane.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [shownText]);

  useEffect(() => {
    if (renderedBrief(theme.pierreTheme, brief.text)) return;
    let current = true;
    renderBrief(theme.pierreTheme, brief.text).then(
      (result) => {
        if (!current) return;
        setRendered({ key, result });
        setError("");
      },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [key, brief.text, theme.pierreTheme]);
  // Other iterations render after this one, so choosing one shows it at once.
  const prerenderKey = JSON.stringify(prerender ?? []);
  const hasShown = !!shown;
  useEffect(() => {
    if (!hasShown) return;
    for (const text of JSON.parse(prerenderKey) as string[])
      renderBrief(theme.pierreTheme, text, false).catch(() => {});
  }, [hasShown, prerenderKey, theme.pierreTheme]);

  const annotated = useMemo(
    () => (result ? annotateBrief(result.blocks, files, root) : null),
    [result, files, root],
  );
  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const uncited = useMemo(
    () => files.filter((file) => !annotated?.cited.includes(file.id)),
    [files, annotated],
  );

  // Excerpts render through portals into slots inside the rendered Markdown.
  useLayoutEffect(() => {
    const found = new Map<string, HTMLElement>();
    article.current
      ?.querySelectorAll<HTMLElement>("[data-brief-slot]")
      .forEach((slot) => found.set(slot.dataset.briefSlot!, slot));
    // The slots exist only in the rendered HTML, so they are read after commit.
    // oxlint-disable-next-line react/set-state-in-effect
    setSlots((current) =>
      current.size === found.size && [...found].every(([key, node]) => current.get(key) === node)
        ? current
        : found,
    );
  }, [annotated]);

  // A link and its excerpt light up together.
  useEffect(() => {
    const host = article.current;
    if (!host) return;
    host.querySelectorAll(".med-brief-ref[data-linked]").forEach((node) => {
      node.removeAttribute("data-linked");
    });
    if (linked)
      host
        .querySelectorAll(`.med-brief-ref[data-brief-ref="${CSS.escape(linked)}"]`)
        .forEach((node) => node.setAttribute("data-linked", ""));
  }, [linked, annotated]);

  const scrollToNode = (node: HTMLElement, offset = 28) => {
    const scroller = pane.current;
    if (!scroller) return;
    // Scroll this pane only: scrollIntoView can move hidden split ancestors.
    const top =
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({
      top: Math.max(0, top - offset),
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };

  // [ and ] step through the excerpts, like hunks in Changes.
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const editing = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)),
        );
      if (editing || visibleElement('[role="dialog"]')) return;
      const scroller = pane.current;
      const cards = [
        ...(article.current?.querySelectorAll<HTMLElement>("[data-brief-excerpt]") ?? []),
      ];
      if (!scroller || !cards.length) return;
      event.preventDefault();
      event.stopPropagation();
      const top = scroller.getBoundingClientRect().top;
      const focused = cards.findIndex((card) => card.contains(document.activeElement));
      let index: number;
      if (focused >= 0) index = focused + (event.key === "]" ? 1 : -1);
      else if (event.key === "]")
        index = cards.findIndex((card) => card.getBoundingClientRect().top > top + 40);
      else index = cards.findLastIndex((card) => card.getBoundingClientRect().top < top + 20);
      const card = cards[Math.max(0, Math.min(cards.length - 1, index < 0 ? 0 : index))]!;
      scrollToNode(card, 56);
      card.querySelector<HTMLElement>("[data-excerpt-open]")?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active]);

  // c starts a note on the lines selected in an excerpt, as in Changes.
  useEffect(() => {
    if (!active || !selected) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (visibleElement('[role="dialog"]')) return;
      event.preventDefault();
      setDraft(selected);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, selected]);

  // Links resolve through delegation: the Markdown is HTML, not React elements.
  const handlers = useRef({ onOpen, onOpenPath });
  useEffect(() => {
    handlers.current = { onOpen, onOpenPath };
  });
  useEffect(() => {
    const host = article.current;
    if (!host) return;
    const follow = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || !host.contains(anchor)) return;
      const data = anchor.dataset;
      if (data.briefRef && data.briefFile) {
        event.preventDefault();
        handlers.current.onOpen({
          fileId: data.briefFile,
          ...(data.briefStart
            ? {
                side: data.briefSide as "old" | "new",
                start: Number(data.briefStart),
                end: Number(data.briefEnd),
              }
            : {}),
        });
      } else if (data.briefPath) {
        event.preventDefault();
        handlers.current.onOpenPath(
          data.briefPath,
          data.briefLine ? Number(data.briefLine) : undefined,
        );
      } else if (anchor.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
        let id: string;
        try {
          id = decodeURIComponent(anchor.getAttribute("href")!.slice(1));
        } catch {
          return;
        }
        const target = id && host.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (target) scrollToNode(target);
      }
    };
    const hover = (event: PointerEvent) => {
      const node = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-brief-ref], [data-brief-excerpt]",
      );
      setLinked(node?.dataset.briefRef ?? node?.dataset.briefExcerpt ?? null);
    };
    const leave = () => setLinked(null);
    host.addEventListener("click", follow);
    host.addEventListener("pointerover", hover);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("click", follow);
      host.removeEventListener("pointerover", hover);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  // Images load as in a file preview; relative paths start at the repository root.
  useEffect(() => {
    const host = article.current;
    if (!host || !annotated) return;
    const source = root
      ? { kind: "worktree" as const, repo: root }
      : { kind: "drop" as const, id: "brief" };
    for (const image of host.querySelectorAll<HTMLImageElement>("img[data-image-source]")) {
      if (image.src) continue;
      const raw = image.dataset.imageSource ?? "";
      let url: string | undefined;
      try {
        url = markdownImageUrl(raw, source, "BRIEF.md");
      } catch {
        /* Display the alt text. */
      }
      if (url) image.src = url;
      else image.title = "This image URL is not supported.";
      image.onerror = () => {
        image.title = `Image unavailable: ${raw}`;
      };
    }
  }, [annotated, root]);

  const citedCount = annotated?.cited.length ?? 0;
  return (
    <section aria-label="Brief" {...stylex.props(styles.root)}>
      <div className="med-md-scroll med-brief-scroll" ref={pane}>
        <article ref={article} className="med-md-prose med-brief-prose">
          <header {...stylex.props(styles.meta)}>
            <span {...stylex.props(styles.label)}>
              <Icon name="brief" size={14} />
              Brief
            </span>
            {iterations && iterations.length > 1 && (
              <IterationKeys
                iterations={iterations}
                iteration={iteration}
                onIteration={onIteration}
              />
            )}
            {annotated && files.length > 0 && (
              <span
                {...stylex.props(styles.coverage)}
                title="Changed files that the brief links to"
              >
                <span {...stylex.props(styles.meter)} aria-hidden="true">
                  <span {...stylex.props(styles.meterFill(citedCount / files.length))} />
                </span>
                <span {...stylex.props(styles.coverageText)}>
                  Cites {citedCount} of {files.length} changed{" "}
                  {files.length === 1 ? "file" : "files"}
                </span>
              </span>
            )}
            <span {...stylex.props(styles.grow)} />
            <ActionMenu
              label="Brief options"
              sections={[
                [
                  { label: "Paste a new brief", shortcut: "⌘ V", onClick: onPaste },
                  { label: "Copy brief text", onClick: onCopy },
                ],
                [{ label: "Remove brief", onClick: onRemove }],
              ]}
            >
              <Icon name="more" size={15} />
            </ActionMenu>
          </header>
          {error && (
            <div role="alert" className="med-md-notice">
              {error}
            </div>
          )}
          {annotated?.blocks.map((block, index) =>
            block.diagram !== undefined ? (
              <DiagramBlock key={index} block={block} dark={theme.appearance === "dark"} />
            ) : (
              <Block key={index} html={block.html} start={block.start} end={block.end} />
            ),
          )}
        </article>
        {annotated && files.length > 0 && (
          // Outside the prose, so Markdown heading and list styles do not apply.
          <footer
            aria-label="Changed files the brief does not cite"
            {...stylex.props(styles.column)}
          >
            <div {...stylex.props(styles.uncited)}>
              {uncited.length ? (
                <>
                  <h2 {...stylex.props(styles.uncitedTitle)}>
                    Not in the brief
                    <span {...stylex.props(styles.uncitedCount)}>{uncited.length}</span>
                  </h2>
                  <p {...stylex.props(styles.uncitedHint)}>
                    The brief does not mention these changes. Read them in Changes.
                  </p>
                  <ul {...stylex.props(styles.uncitedList)}>
                    {uncited.map((file) => {
                      const slash = file.path.lastIndexOf("/") + 1;
                      return (
                        <li key={file.id}>
                          <button
                            {...stylex.props(styles.uncitedRow)}
                            onClick={() => onOpen({ fileId: file.id })}
                          >
                            <Icon name="file" size={13} />
                            <span {...stylex.props(styles.path)}>
                              <span {...stylex.props(styles.directory)}>
                                {file.path.slice(0, slash)}
                              </span>
                              {file.path.slice(slash)}
                            </span>
                            <span {...stylex.props(styles.stats)}>
                              {file.info.additions > 0 && (
                                <span {...stylex.props(styles.added)}>+{file.info.additions}</span>
                              )}
                              {file.info.deletions > 0 && (
                                <span {...stylex.props(styles.removed)}>
                                  −{file.info.deletions}
                                </span>
                              )}
                              <DiffStat
                                additions={file.info.additions}
                                deletions={file.info.deletions}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p {...stylex.props(styles.covered)}>
                  <Icon name="check" size={14} />
                  The brief cites every changed file.
                </p>
              )}
            </div>
          </footer>
        )}
      </div>
      {annotated?.excerpts.map((excerpt) => {
        const slot = slots.get(excerpt.key);
        const file = fileById.get(excerpt.fileId);
        return slot && file
          ? createPortal(
              <ExcerptCard
                excerpt={excerpt}
                file={file}
                linked={linked === excerpt.key}
                pierreTheme={theme.pierreTheme}
                themeType={theme.appearance}
                loadSource={loadSource}
                onOpen={onOpen}
                notes={notes}
                draft={visibleDraft?.key === excerpt.key ? visibleDraft : null}
                selected={selected?.key === excerpt.key ? selected.target : null}
                submitted={submitted}
                onSelect={(target) => {
                  setSelected(target && { key: excerpt.key, target });
                  // A selection moves an open draft in the same excerpt.
                  if (target && draft?.key === excerpt.key) setDraft({ key: excerpt.key, target });
                }}
                onDraft={(target) => {
                  setSubmitted(null);
                  setDraft({ key: excerpt.key, target });
                }}
                onSave={async (current, note) => {
                  const submission: Submission = {
                    draft: current,
                    note,
                    existing: new Set(notes.map((entry) => entry.id)),
                  };
                  setSubmitted(submission);
                  try {
                    await onMutateNote({ type: "add", note });
                  } catch (error) {
                    setSubmitted((value) =>
                      value === submission
                        ? {
                            ...submission,
                            error:
                              error instanceof Error ? error.message : "Could not save comment",
                          }
                        : value,
                    );
                    throw error;
                  }
                }}
                onCancel={(current) => {
                  setDraft((value) => (value === current ? null : value));
                  setSelected(null);
                  setSubmitted((value) => (value?.draft === current ? null : value));
                }}
                onMutate={onMutateNote}
              />,
              slot,
              excerpt.key,
            )
          : null;
      })}
    </section>
  );
}

function ExcerptCard({
  excerpt,
  file,
  linked,
  pierreTheme,
  themeType,
  loadSource,
  onOpen,
  notes,
  draft,
  selected,
  submitted,
  onSelect,
  onDraft,
  onSave,
  onCancel,
  onMutate,
}: {
  excerpt: BriefExcerpt;
  file: ParsedReviewFile;
  linked: boolean;
  pierreTheme: FileDiffOptions<Annotation, undefined>["theme"];
  themeType: "light" | "dark";
  loadSource: BriefViewProps["loadSource"];
  onOpen: BriefViewProps["onOpen"];
  notes: readonly Note[];
  draft: Draft | null;
  selected: NoteTarget | null;
  submitted: Submission | null;
  onSelect(target: NoteTarget | null): void;
  onDraft(target: NoteTarget): void;
  onSave(draft: Draft, note: NoteInput): Promise<void>;
  onCancel(draft: Draft): void;
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  const { range } = excerpt;
  const host = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [source, setSource] = useState<Excerpt | "missing" | null>(null);
  // Mount the diff only near the viewport; long briefs stay cheap to open. An
  // excerpt already near it mounts before the first paint, so a new brief
  // never shows an empty card for a frame.
  useLayoutEffect(() => {
    const node = host.current!;
    const { top, bottom } = node.getBoundingClientRect();
    if (node.checkVisibility() && top < innerHeight + 900 && bottom > -900) {
      // The position is known only after layout.
      // oxlint-disable-next-line react/set-state-in-effect
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const diff = useMemo(() => {
    const result = diffExcerpt(file, range);
    // The excerpt starts at its first row: no "unmodified lines" bar above it.
    if (result?.metadata.hunks[0]) result.metadata.hunks[0].collapsedBefore = 0;
    return result;
  }, [file, range]);
  useEffect(() => {
    if (diff || !near || source) return;
    let cancelled = false;
    loadSource(file.path)
      .then((text) => {
        if (cancelled) return;
        const result = sourceExcerpt(file, range, range.side === "new" ? text.new : text.old);
        if (result?.metadata.hunks[0]) result.metadata.hunks[0].collapsedBefore = 0;
        setSource(result ?? "missing");
      })
      .catch(() => {
        if (!cancelled) setSource("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [diff, near, source, file, range, loadSource]);
  const shown = diff ?? (source && source !== "missing" ? source : null);
  const open = (side = range.side, start = range.start, end = range.end) =>
    onOpen({ fileId: file.id, side, start, end });
  // Notes and drafts on the lines this excerpt shows. Pierre places each below
  // its first line, as in Changes.
  const annotations = useMemo<DiffLineAnnotation<Annotation>[]>(() => {
    if (!shown) return [];
    const visible = { old: new Set(shown.lines.old), new: new Set(shown.lines.new) };
    const list: DiffLineAnnotation<Annotation>[] = notes
      .filter(
        (note) =>
          note.path === file.path &&
          !note.parentId &&
          note.resolution !== "orphaned" &&
          note.resolution !== "stale" &&
          visible[note.side].has(note.line),
      )
      .map((note) => ({
        side: note.side === "old" ? "deletions" : "additions",
        lineNumber: note.line,
        metadata: { note },
      }));
    if (draft && visible[draft.target.side].has(draft.target.line))
      list.push({
        side: draft.target.side === "old" ? "deletions" : "additions",
        lineNumber: draft.target.line,
        metadata: { draft: draft.target },
      });
    return list;
  }, [shown, notes, draft, file.path]);
  const noteCount = annotations.filter((annotation) => annotation.metadata?.note).length;
  const handlers = useRef({ onSelect, onDraft });
  useEffect(() => {
    handlers.current = { onSelect, onDraft };
  });
  const options = useMemo<FileDiffOptions<Annotation, undefined>>(() => {
    const target = (range: SelectedLineRange | null): NoteTarget | null =>
      !range || (range.endSide && range.side !== range.endSide)
        ? null
        : {
            path: file.path,
            side: range.side === "deletions" ? "old" : "new",
            line: Math.min(range.start, range.end),
            endLine: Math.max(range.start, range.end),
          };
    const label = (root: Node | null | undefined) =>
      (root as ShadowRoot | null | undefined)
        ?.querySelector?.("[data-utility-button]")
        ?.setAttribute("aria-label", "Add note to line");
    return {
      theme: pierreTheme,
      themeType,
      diffStyle: "unified",
      overflow: "wrap",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      disableFileHeader: true,
      hunkSeparators: "line-info",
      expansionLineCount: EXPANSION_LINES,
      // Select lines on the numbers, or drag the gutter + to start a note.
      enableLineSelection: true,
      enableGutterUtility: true,
      unsafeCSS: `[data-separator-content] { font-size: 11px; }
        [data-utility-button]::before { inset: 0; }`,
      onLineSelectionEnd(range) {
        handlers.current.onSelect(target(range));
      },
      onGutterUtilityClick(range) {
        const next = target(range);
        if (next) handlers.current.onDraft(next);
      },
      onLineEnter(line) {
        label(line.lineElement.getRootNode());
      },
      onPostRender(node, _instance, phase) {
        if (phase !== "unmount") label(node.shadowRoot);
      },
    };
  }, [pierreTheme, themeType, file.path]);
  const slash = file.path.lastIndexOf("/") + 1;
  const lines = `L${range.start}${range.end > range.start ? `–${range.end}` : ""}`;
  return (
    <figure
      ref={host}
      data-brief-excerpt={excerpt.key}
      {...stylex.props(styles.card, linked && styles.cardLinked)}
    >
      <button
        data-excerpt-open
        aria-label={`Open ${file.path} ${lines} in Changes`}
        onClick={() => open()}
        {...stylex.props(styles.cardHeader, stylex.defaultMarker())}
      >
        <Icon name="file" size={13} />
        <span {...stylex.props(styles.path)}>
          <span {...stylex.props(styles.directory)}>{file.path.slice(0, slash)}</span>
          <span {...stylex.props(styles.name)}>{file.path.slice(slash)}</span>
        </span>
        <span {...stylex.props(styles.lines)}>{lines}</span>
        <span {...stylex.props(styles.grow)} />
        {shown && diff && (shown.additions > 0 || shown.deletions > 0) && (
          <span {...stylex.props(styles.stats)}>
            {shown.additions > 0 && <span {...stylex.props(styles.added)}>+{shown.additions}</span>}
            {shown.deletions > 0 && (
              <span {...stylex.props(styles.removed)}>−{shown.deletions}</span>
            )}
          </span>
        )}
        {!diff && source && source !== "missing" && (
          <span {...stylex.props(styles.unchanged)}>Unchanged lines</span>
        )}
        {noteCount > 0 && (
          <span
            {...stylex.props(styles.noteCount)}
            title={`${noteCount} ${noteCount === 1 ? "note" : "notes"} on these lines`}
          >
            <Icon name="note" size={12} />
            {noteCount}
          </span>
        )}
        <span {...stylex.props(styles.jump)}>
          <Icon name="jump" size={13} />
        </span>
      </button>
      <div
        {...stylex.props(
          styles.cardBody,
          near && shown
            ? styles.cardBodyReady
            : styles.placeholder(Math.min(14, range.end - range.start + 7) * 20),
        )}
      >
        {near && shown && (
          <FileDiff
            fileDiff={shown.metadata}
            options={options}
            style={diffSurfaceStyle}
            lineAnnotations={annotations}
            selectedLines={
              selected
                ? {
                    start: selected.line,
                    end: selected.endLine ?? selected.line,
                    side: selected.side === "old" ? "deletions" : "additions",
                  }
                : null
            }
            renderAnnotation={(annotation) =>
              annotation.metadata?.draft && draft ? (
                <NoteComposer
                  key={JSON.stringify(draft.target)}
                  target={draft.target}
                  initialText={submitted?.draft === draft ? submitted.note.text : undefined}
                  initialError={submitted?.draft === draft ? submitted.error : undefined}
                  onSave={(note) => onSave(draft, note)}
                  onCancel={() => onCancel(draft)}
                />
              ) : annotation.metadata?.note ? (
                <NoteCard
                  note={annotation.metadata.note}
                  replies={notes.filter((note) => note.parentId === annotation.metadata?.note?.id)}
                  onMutate={onMutate}
                />
              ) : null
            }
          />
        )}
        {near && source === "missing" && (
          <p {...stylex.props(styles.missing)}>
            These lines are outside the captured change. Open the file to read them.
          </p>
        )}
      </div>
      {shown && shown.hidden > 0 && (
        <button {...stylex.props(styles.more)} onClick={() => open()}>
          <Icon name="jump" size={12} />
          {shown.hidden} more {shown.hidden === 1 ? "line" : "lines"} in Changes
        </button>
      )}
    </figure>
  );
}

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});
const grow = stylex.keyframes({ from: { transform: "scaleX(0)" } });
const reduced = "@media (prefers-reduced-motion: reduce)";

/** Keys for at most this many latest iterations; earlier ones open from a menu. */
const RECENT_ITERATIONS = 6;
/** The header's label, citation meter, and options button keep this much room. */
const HEADER_ROOM = 210;
const KEY_WIDTH = 24;

/**
 * The agent's rounds as numbered keys; the shown one is filled. A long review
 * keeps the latest keys that fit and lists earlier rounds in a menu, so the
 * header keeps its width. The menu key shows an earlier round while it is shown.
 */
function IterationKeys({
  iterations,
  iteration,
  onIteration,
}: {
  iterations: readonly { number: number; createdAt: string }[];
  iteration?: number;
  onIteration?(number: number): void;
}) {
  // A narrow pane shows fewer keys, down to the menu alone.
  const group = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(Infinity);
  useLayoutEffect(() => {
    const header = group.current?.parentElement;
    if (!header) return;
    const measure = () => setWidth(header.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const fits = Math.max(
    0,
    Math.min(RECENT_ITERATIONS, Math.floor((width - HEADER_ROOM) / KEY_WIDTH)),
  );
  const recent =
    iterations.length > fits + 1 ? iterations.slice(iterations.length - fits) : iterations;
  const earlier = iterations.slice(0, iterations.length - recent.length);
  const shownEarlier = earlier.find((entry) => entry.number === iteration);
  const when = (entry: { createdAt: string }) =>
    new Date(entry.createdAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <span ref={group} role="group" aria-label="Iterations" {...stylex.props(styles.iterations)}>
      {earlier.length > 0 && (
        <ActionMenu
          label={
            shownEarlier
              ? `Iteration ${shownEarlier.number}, earlier iterations`
              : "Earlier iterations"
          }
          align="start"
          trigger={[styles.iteration, styles.earlier, shownEarlier && styles.iterationOn]}
          sections={[
            earlier.toReversed().map((entry) => ({
              label: `Iteration ${entry.number} · ${when(entry)}`,
              checked: entry.number === iteration,
              choice: true,
              onClick: () => onIteration?.(entry.number),
            })),
          ]}
        >
          {shownEarlier?.number ?? "…"}
          <Icon name="chevron" size={10} />
        </ActionMenu>
      )}
      {recent.map((entry) => (
        <button
          key={entry.number}
          type="button"
          aria-pressed={entry.number === iteration}
          aria-label={`Iteration ${entry.number}`}
          title={`Iteration ${entry.number} · ${when(entry)}`}
          onClick={() => onIteration?.(entry.number)}
          {...stylex.props(styles.iteration, entry.number === iteration && styles.iterationOn)}
        >
          {entry.number}
        </button>
      ))}
    </span>
  );
}

const styles = stylex.create({
  root: {
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    backgroundColor: tokens.canvas,
    color: tokens.text,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 30,
    marginBottom: 30,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.4,
    color: tokens.muted,
  },
  label: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: 7,
    whiteSpace: "nowrap",
    color: tokens.text,
    fontWeight: 500,
  },
  // In a narrow pane the coverage text shortens before the header overflows.
  coverage: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: tokens.faint },
  coverageText: { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  iterations: {
    display: "inline-flex",
    flexShrink: 0,
    gap: 2,
    padding: 2,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  iteration: {
    minWidth: 22,
    height: 20,
    paddingInline: 5,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${tokens.accentLine}` },
  },
  earlier: { display: "inline-flex", alignItems: "center", gap: 1, paddingInlineEnd: 3 },
  iterationOn: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.raised, ":hover": tokens.raised },
    boxShadow: {
      default: `0 0 0 1px ${tokens.line}, 0 1px 2px #0000001a`,
      ":focus-visible": `0 0 0 2px ${tokens.accentLine}`,
    },
  },
  meter: {
    display: "block",
    width: 40,
    height: 3,
    borderRadius: `calc(2px * ${tokens.round})`,
    overflow: "hidden",
    backgroundColor: tokens.fillStrong,
  },
  meterFill: (scale: number) => ({
    display: "block",
    transform: `scaleX(${scale})`,
    height: "100%",
    backgroundColor: tokens.accent,
    transformOrigin: "left",
    transitionProperty: "transform",
    transitionDuration: "420ms",
    transitionTimingFunction: tokens.easeOut,
    animationName: { default: grow, [reduced]: "none" },
    animationDuration: "520ms",
    animationTimingFunction: tokens.easeOut,
  }),
  grow: { flex: "1" },
  card: {
    // Code is wider than prose: the card reaches a little past the text column.
    marginTop: 12,
    marginBottom: 22,
    marginInlineStart: "calc(-1 * var(--med-brief-bleed, 0px))",
    marginInlineEnd: "calc(-1 * var(--med-brief-bleed, 0px))",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    boxShadow: "0 0 0 0 transparent",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "160ms",
    transitionTimingFunction: tokens.easeOut,
    fontSize: 12,
    lineHeight: "normal",
  },
  cardLinked: {
    borderColor: tokens.accentLine,
    boxShadow: `0 0 0 3px ${tokens.accentSoft}`,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    height: 32,
    paddingInline: 11,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    backgroundColor: { default: tokens.panel, ":hover": tokens.hover },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color, color",
    transitionDuration: "120ms",
  },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  directory: { color: tokens.faint },
  name: { color: tokens.text, fontWeight: 500 },
  lines: {
    flexShrink: 0,
    fontFamily: tokens.code,
    fontSize: 10.5,
    color: tokens.faint,
    fontVariantNumeric: "tabular-nums",
  },
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: tokens.green },
  removed: { color: tokens.red },
  noteCount: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    color: tokens.accent,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  unchanged: { flexShrink: 0, color: tokens.faint, fontSize: 11 },
  jump: {
    display: "flex",
    flexShrink: 0,
    color: tokens.faint,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
    },
    transform: {
      default: "translateX(-2px)",
      [stylex.when.ancestor(":hover")]: "none",
      [stylex.when.ancestor(":focus-visible")]: "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: "140ms",
    transitionTimingFunction: tokens.easeOut,
  },
  cardBody: { position: "relative", backgroundColor: tokens.canvas },
  placeholder: (height: number) => ({ height }),
  cardBodyReady: {
    animationName: { default: enter, [reduced]: "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  missing: {
    margin: 0,
    padding: 14,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  more: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: 28,
    paddingInline: 11,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: { default: tokens.panel, ":hover": tokens.hover },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  // The reading column of .med-md-prose, for content outside the prose.
  column: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "calc(var(--med-measure, 38em) + 2 * clamp(24px, 4cqw, 48px))",
    marginInline: "auto",
    paddingInlineStart: "clamp(24px, 4cqw, 48px)",
    paddingInlineEnd: "clamp(24px, 4cqw, 48px)",
    paddingBottom: 64,
    // The prose's font size, so this em-based column matches its width.
    fontSize: 16,
  },
  uncited: {
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    fontFamily: tokens.ui,
  },
  uncitedTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    fontFamily: tokens.ui,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: tokens.muted,
  },
  uncitedCount: {
    fontFamily: tokens.code,
    fontSize: 10.5,
    letterSpacing: 0,
    color: tokens.faint,
  },
  uncitedHint: {
    marginTop: 6,
    marginBottom: 12,
    marginInline: 0,
    fontSize: 12.5,
    color: tokens.faint,
  },
  uncitedList: { listStyle: "none", margin: 0, padding: 0 },
  uncitedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "calc(100% + 16px)",
    height: 30,
    marginInline: -8,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  covered: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    color: tokens.faint,
    fontSize: 12.5,
  },
});
