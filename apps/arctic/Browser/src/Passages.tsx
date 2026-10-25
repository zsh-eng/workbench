import { Popover } from "@base-ui/react/popover";
import { Copy, NotebookPen, StickyNote, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  COLOURS,
  clearPaint,
  editAnnotation,
  newAnnotation,
  paint,
  passageAt,
  quoteOf,
  readAnnotations,
  resolve,
  saveAnnotation,
  type Annotation,
  type Colour,
} from "./annotations";
import type { Article } from "./articles";
import { reportError, showToast, useRecords, useSession } from "./state";
import { keyboardHeight, Sheet, useCompact } from "./surface";
import { Tip } from "./ui";

/** The account's passages and notes, for one article or all, oldest first. */
export function useAnnotations(articleURL?: string) {
  const session = useSession();
  const revision = useRecords(session.annotations);
  return useMemo(
    () =>
      readAnnotations(session.annotations)
        .filter((item) => !articleURL || item.articleURL === articleURL)
        .sort((a, b) => a.createdAt - b.createdAt),
    // The revision changes with the records.
    [session, articleURL, revision],
  );
}

type Bar =
  | { mode: "selection"; range: Range }
  | { mode: "passage"; id: string; note: boolean };

/**
 * Highlights in the text. Selecting text offers the colours, a note and Copy;
 * selecting a highlight offers the same for it, and Remove. `reveal` scrolls
 * to a passage and marks it for a moment.
 */
export function Passages({
  article,
  prose,
  ready,
  reveal,
}: {
  article: Article;
  prose: RefObject<HTMLDivElement | null>;
  ready: boolean;
  reveal?: { id: string };
}) {
  const session = useSession();
  const annotations = useAnnotations(article.url);
  // Where each passage is in the text: state for rendering, a ref for events.
  const [resolved, setResolved] = useState(() => new Map<string, Range>());
  const ranges = useRef(resolved);
  const [bar, setBar] = useState<Bar | null>(null);
  const [focus, setFocus] = useState<string>();

  useLayoutEffect(() => {
    const root = prose.current;
    if (!ready || !root) return;
    const next = resolve(root, annotations);
    ranges.current = next;
    setResolved(next);
    paint(annotations, next, focus);
  }, [ready, annotations, focus, prose]);
  useEffect(() => clearPaint, []);

  useEffect(() => {
    if (!reveal || !ready) return;
    const range = ranges.current.get(reveal.id);
    if (!range) {
      showToast("This passage is not in this copy of the article.");
      return;
    }
    const top = range.getBoundingClientRect().top;
    window.scrollTo({
      top: Math.max(0, window.scrollY + top - innerHeight * 0.3),
    });
    setFocus(reveal.id);
    const timer = setTimeout(() => setFocus(undefined), 1600);
    return () => clearTimeout(timer);
  }, [reveal, ready]);

  // A selection in the text shows the bar once the pointer lifts, or after
  // the selection rests (touch handles). A touch that scrolls, or a long
  // press the browser takes for selection, ends in pointercancel instead.
  useEffect(() => {
    if (!ready) return;
    let pressed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const selection = getSelection();
      const root = prose.current;
      if (
        !root ||
        !selection ||
        selection.isCollapsed ||
        !selection.rangeCount
      ) {
        setBar((current) => (current?.mode === "selection" ? null : current));
        return;
      }
      const range = selection.getRangeAt(0);
      if (
        !root.contains(range.commonAncestorContainer) ||
        !range.toString().trim()
      )
        return;
      setBar({ mode: "selection", range: range.cloneRange() });
    };
    const changed = () => {
      clearTimeout(timer);
      if (!pressed) timer = setTimeout(check, 160);
    };
    const down = (event: PointerEvent) => {
      if ((event.target as Element).closest?.(".passage-bar")) return;
      pressed = true;
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      clearTimeout(timer);
      timer = setTimeout(check, 10);
    };
    document.addEventListener("selectionchange", changed);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [ready, prose]);

  // A click on a highlight selects it; a click elsewhere closes its bar.
  useEffect(() => {
    const root = prose.current;
    if (!ready || !root) return;
    const click = (event: MouseEvent) => {
      if (!getSelection()?.isCollapsed) return;
      if ((event.target as Element).closest("a")) return;
      const id = passageAt(ranges.current, event.clientX, event.clientY);
      setBar(id ? { mode: "passage", id, note: false } : null);
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".passage-bar") && !root.contains(target))
        setBar((current) => (current?.mode === "passage" ? null : current));
    };
    root.addEventListener("click", click);
    document.addEventListener("pointerdown", outside);
    return () => {
      root.removeEventListener("click", click);
      document.removeEventListener("pointerdown", outside);
    };
  }, [ready, prose]);

  // Escape closes the bar before the reader sees it.
  const open = bar !== null;
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setBar(null);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open]);

  // H highlights the selection.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "h" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (
        (event.target as Element).closest("input, textarea, [contenteditable]")
      )
        return;
      if (bar?.mode !== "selection") return;
      event.preventDefault();
      void highlight("yellow");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const passage =
    bar?.mode === "passage"
      ? annotations.find((item) => item.id === bar.id)
      : undefined;

  async function highlight(colour: Colour, note = false) {
    const root = prose.current;
    if (bar?.mode !== "selection" || !root) return;
    const quote = quoteOf(root, bar.range);
    if (!quote) return;
    getSelection()?.removeAllRanges();
    // The same passage again changes its colour.
    const same = annotations.find(
      (item) =>
        item.quote?.exact === quote.exact && item.quote.start === quote.start,
    );
    if (same) {
      setBar(note ? { mode: "passage", id: same.id, note: true } : null);
      await editAnnotation(session, same, {
        colour,
        isHighlighted: true,
      }).catch(reportError);
      return;
    }
    const created = newAnnotation(article.url, { quote, colour });
    setBar(note ? { mode: "passage", id: created.id, note: true } : null);
    await saveAnnotation(session, created).catch(reportError);
  }

  async function remove(item: Annotation) {
    setBar(null);
    await editAnnotation(session, item, { deletedAt: Date.now() }).catch(
      reportError,
    );
    showToast(item.note ? "Note removed" : "Highlight removed", {
      label: "Undo",
      run: () =>
        void saveAnnotation(session, { ...item, updatedAt: Date.now() }).catch(
          reportError,
        ),
    });
  }

  const range =
    bar?.mode === "selection"
      ? bar.range
      : bar?.mode === "passage"
        ? resolved.get(bar.id)
        : undefined;
  if (!bar || !range || (bar.mode === "passage" && !passage)) return null;
  const text =
    bar.mode === "selection"
      ? bar.range.toString()
      : (passage!.quote?.exact ?? "");
  return createPortal(
    <FloatingBar range={range}>
      <div className="passage-row">
        <div className="colours" role="group" aria-label="Highlight colour">
          {COLOURS.map((colour) => (
            <button
              key={colour}
              type="button"
              className="colour"
              data-colour={colour}
              aria-label={`Highlight ${colour}`}
              aria-pressed={
                passage?.isHighlighted &&
                (passage.colour ?? "yellow") === colour
              }
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                passage
                  ? void editAnnotation(session, passage, {
                      colour,
                      isHighlighted: true,
                    }).catch(reportError)
                  : void highlight(colour)
              }
            />
          ))}
        </div>
        <span className="passage-rule" />
        <Tip label={passage?.note ? "Edit note" : "Add a note"}>
          <button
            type="button"
            className="icon-button"
            aria-label="Note"
            aria-expanded={bar.mode === "passage" && bar.note}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() =>
              passage
                ? setBar({
                    mode: "passage",
                    id: passage.id,
                    note: !(bar.mode === "passage" && bar.note),
                  })
                : void highlight("yellow", true)
            }
          >
            <StickyNote size={17} />
          </button>
        </Tip>
        <Tip label="Copy">
          <button
            type="button"
            className="icon-button"
            aria-label="Copy"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => showToast("Copied"),
                () => showToast("Arctic could not copy the text."),
              )
            }
          >
            <Copy size={16} />
          </button>
        </Tip>
        {passage && (
          <Tip label="Remove">
            <button
              type="button"
              className="icon-button"
              aria-label="Remove"
              onClick={() => void remove(passage)}
            >
              <Trash2 size={16} />
            </button>
          </Tip>
        )}
      </div>
      {passage && bar.mode === "passage" && (bar.note || passage.note) && (
        <NoteEditor
          key={passage.id}
          value={passage.note}
          autoFocus={bar.mode === "passage" && bar.note}
          onSave={(note) =>
            void editAnnotation(session, passage, { note }).catch(reportError)
          }
        />
      )}
    </FloatingBar>,
    document.body,
  );
}

/** A bar above the passage (below it on touch screens, where the system menu is above). */
function FloatingBar({
  range,
  children,
}: {
  range: Range;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const compact = useCompact();
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const bar = element.current;
      if (!bar) return;
      // A phone docks the bar at the bottom, in the toolbar's place, clear of
      // the system's own selection menu. It rides above the keyboard.
      if (compact) {
        const keyboard = keyboardHeight();
        bar.style.transform = keyboard
          ? `translateY(${-Math.round(keyboard)}px)`
          : "";
        bar.style.visibility = "";
        return;
      }
      const rects = [...range.getClientRects()];
      const first = rects[0];
      const last = rects.at(-1);
      if (!first || !last) return;
      const width = bar.offsetWidth;
      const height = bar.offsetHeight;
      const touch = matchMedia("(pointer: coarse)").matches;
      const above = first.top - height - 10;
      const top =
        !touch && above > 70
          ? above
          : Math.min(last.bottom + 12, innerHeight - height - 12);
      const centre = touch
        ? (last.left + last.right) / 2
        : (first.left + first.right) / 2;
      const left = Math.min(
        Math.max(12, centre - width / 2),
        innerWidth - width - 12,
      );
      bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      bar.style.visibility =
        first.bottom < 0 || last.top > innerHeight ? "hidden" : "";
    };
    place();
    const schedule = () => {
      frame ||= requestAnimationFrame(place);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    if (element.current) observer.observe(element.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [range, compact]);
  return (
    <div
      className="passage-bar"
      ref={element}
      role="dialog"
      aria-label="Passage"
      data-docked={compact || undefined}
    >
      {children}
    </div>
  );
}

/** A note saves as you type, and when you leave it. */
function NoteEditor({
  value,
  autoFocus,
  onSave,
  placeholder = "Add a note",
}: {
  value: string;
  autoFocus?: boolean;
  onSave: (note: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  const latest = useRef(draft);
  latest.current = draft;
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (draft === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = draft;
      save.current(draft);
    }, 600);
    return () => clearTimeout(timer);
  }, [draft]);
  // Leaving saves at once.
  useEffect(
    () => () => {
      if (latest.current !== saved.current) save.current(latest.current);
    },
    [],
  );
  return (
    <textarea
      className="note-editor"
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={3}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

/**
 * The article's passages in reading order, and a note on the whole article:
 * a sheet on phones, resting at half height so the page shows above it, and
 * a popover elsewhere.
 */
export function NotesPanel({
  article,
  onReveal,
}: {
  article: Article;
  onReveal: (id: string) => void;
}) {
  const compact = useCompact();
  const count = useAnnotations(article.url).filter((item) => item.quote).length;
  const [open, setOpen] = useState(false);
  const reveal = (id: string) => {
    setOpen(false);
    onReveal(id);
  };
  const trigger = (
    <button
      type="button"
      className="icon-button notes-button"
      aria-label="Notes"
      onClick={compact ? () => setOpen(true) : undefined}
    >
      <NotebookPen size={18} />
      {count > 0 && <span className="count">{count}</span>}
    </button>
  );
  if (compact)
    return (
      <>
        {trigger}
        <Sheet
          isOpen={open}
          onOpenChange={setOpen}
          title="Notes"
          heading
          snapPoints={["min(55dvh, 100%)"]}
          fit
        >
          <div className="notes-panel">
            <NotesContent article={article} onReveal={reveal} />
          </div>
        </Sheet>
      </>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="Notes">
        <Popover.Trigger render={trigger} />
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="menu notes-panel">
            <h2>Notes</h2>
            <NotesContent article={article} onReveal={reveal} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotesContent({
  article,
  onReveal,
}: {
  article: Article;
  onReveal: (id: string) => void;
}) {
  const session = useSession();
  const annotations = useAnnotations(article.url);
  const passages = annotations
    .filter((item) => item.quote)
    .sort((a, b) => a.quote!.start - b.quote!.start);
  const articleNote = annotations.find((item) => !item.quote);
  // The first save creates the note; later saves before it syncs edit it.
  const created = useRef<Annotation | undefined>(undefined);
  return (
    <>
      <NoteEditor
        value={articleNote?.note ?? ""}
        placeholder="A note on this article"
        onSave={(note) => {
          const existing = articleNote ?? created.current;
          const next = existing
            ? { ...existing, note, updatedAt: Date.now() }
            : newAnnotation(article.url, {
                note,
                isHighlighted: false,
                colour: undefined,
              });
          created.current = next;
          void saveAnnotation(session, next).catch(reportError);
        }}
      />
      {passages.length === 0 ? (
        <p className="notes-empty">
          Select text to highlight it or add a note. Highlights sync to your
          account.
        </p>
      ) : (
        <ol className="passages">
          {passages.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="passage"
                onClick={() => onReveal(item.id)}
              >
                <blockquote
                  data-colour={
                    item.isHighlighted ? (item.colour ?? "yellow") : undefined
                  }
                >
                  {item.quote!.exact}
                </blockquote>
                {item.note && <p>{item.note}</p>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
