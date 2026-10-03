import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  PanelRight,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  applyHighlight,
  createHighlightFromSelection,
  type TextHighlight,
} from "@zsh-eng/text-highlighter";
import type { Article, Annotation, AnnotationColor } from "./model";
import { sourceName } from "./model";
import { changeLibrary } from "./store";
import { cleanArticle } from "./content";
import { ArticleActions, Tool } from "./ui";
import { HighlightToolbar, type PassageRect } from "./HighlightToolbar";
type Passage = {
  quote: TextHighlight;
  rect: PassageRect;
  annotationId?: string;
  color?: AnnotationColor;
};
export function Reader({
  article,
  annotations,
  notify,
}: {
  article: Article;
  annotations: Annotation[];
  notify: (message: string) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [html, setHTML] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(!!article.bodyPath);
  const [selection, setSelection] = useState<Passage | null>(null);
  const [quote, setQuote] = useState<TextHighlight | undefined>();
  const [draftColor, setDraftColor] = useState<AnnotationColor>("yellow");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("arctic-notes-visible") === "true";
    } catch {
      return false;
    }
  });
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const changeSidebar = (open: boolean) => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setSidebarOpen(open);
    try {
      localStorage.setItem("arctic-notes-visible", String(open));
    } catch {
      /* Still works for this visit. */
    }
  };
  const focusComposer = () => {
    changeSidebar(true);
    requestAnimationFrame(() => composer.current?.focus());
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.altKey) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        changeSidebar(!sidebarOpen);
        if (sidebarOpen) sidebarToggle.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sidebarOpen]);
  useEffect(() => {
    window.scrollTo(0, 0);
    const old = document.title;
    document.title = `${article.title} — Arctic`;
    return () => {
      document.title = old;
    };
  }, [article.id, article.title]);
  useEffect(() => {
    if (!article.bodyPath) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void fetch(article.bodyPath, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The saved article could not be loaded.");
        const source = await response.text();
        if (source.includes("/src/main.tsx") || source.includes('id="root"'))
          throw new Error("The saved article is missing from this computer.");
        if (!controller.signal.aborted)
          setHTML(cleanArticle(source, article.url));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [article.bodyPath, article.url, retry]);
  useEffect(() => {
    if (!content.current) return;
    content.current.innerHTML = html;
    for (const note of annotations)
      if (note.quote)
        applyHighlight(content.current, note.quote, {
          attributes: {
            "data-note": note.id,
            "data-color": note.color ?? "yellow",
            tabindex: "0",
            role: "button",
            "aria-label": `Edit highlight: ${note.quote.selectedText}`,
          },
          className: "article-highlight",
        });
  }, [html, annotations]);
  useEffect(() => {
    const update = () => {
      const selected = window.getSelection();
      const root = content.current;
      if (
        !selected ||
        !root ||
        selected.isCollapsed ||
        !root.contains(selected.anchorNode) ||
        !root.contains(selected.focusNode)
      ) {
        setSelection((current) =>
          current?.annotationId ||
          document.activeElement?.closest("[data-highlight-toolbar]")
            ? current
            : null,
        );
        return;
      }
      const quote = createHighlightFromSelection(selected, root);
      if (quote)
        setSelection({
          quote,
          rect: selected.getRangeAt(0).getBoundingClientRect(),
        });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);
  const dismissSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const id = editing ?? crypto.randomUUID();
      await changeLibrary((l) => {
        const previous = l.annotations.find((n) => n.id === id);
        const note: Annotation = {
          id,
          articleId: article.id,
          text: draft.trim(),
          quote,
          color: draftColor,
          createdAt: previous?.createdAt ?? Date.now(),
        };
        return {
          ...l,
          articles: l.articles.map((a) =>
            a.id === article.id ? { ...a, saved: true } : a,
          ),
          annotations: previous
            ? l.annotations.map((n) => (n.id === id ? note : n))
            : [...l.annotations, note],
        };
      });
      setDraft("");
      setQuote(undefined);
      setEditing(null);
      dismissSelection();
      notify("Note saved.");
    } catch {
      notify("Your note could not be saved. Your draft is still here.");
    } finally {
      setSaving(false);
    }
  };
  const highlight = async (color: AnnotationColor) => {
    if (!selection) return;
    setSaving(true);
    try {
      await changeLibrary((l) => {
        const previous = l.annotations.find(
          (n) => n.id === selection.annotationId,
        );
        let annotations: Annotation[];
        if (previous) {
          const removing = (previous.color ?? "yellow") === color;
          annotations = l.annotations.flatMap((n) =>
            n.id !== previous.id
              ? [n]
              : removing
                ? n.text
                  ? [{ ...n, quote: undefined }]
                  : []
                : [{ ...n, color }],
          );
        } else {
          annotations = [
            ...l.annotations,
            {
              id: crypto.randomUUID(),
              articleId: article.id,
              text: "",
              quote: selection.quote,
              color,
              createdAt: Date.now(),
            },
          ];
        }
        return {
          ...l,
          annotations,
          articles: l.articles.map((a) =>
            a.id === article.id ? { ...a, saved: true } : a,
          ),
        };
      });
      if (editing && editing === selection.annotationId) {
        setDraftColor(color);
        if (selection.color === color) setQuote(undefined);
      }
      dismissSelection();
    } catch {
      notify("Could not save the highlight. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  const openHighlight = (target: EventTarget | null) => {
    const mark =
      target instanceof Element
        ? target.closest<HTMLElement>(".article-highlight")
        : null;
    const note = annotations.find((n) => n.id === mark?.dataset.note);
    if (!mark || !note?.quote) return;
    setSelection({
      quote: note.quote,
      rect: mark.getBoundingClientRect(),
      annotationId: note.id,
      color: note.color ?? "yellow",
    });
  };
  const remove = async (id: string) => {
    try {
      await changeLibrary((l) => ({
        ...l,
        annotations: l.annotations.filter((n) => n.id !== id),
      }));
      if (editing === id) {
        setEditing(null);
        setDraft("");
        setQuote(undefined);
      }
      notify("Annotation removed.");
    } catch {
      notify("Could not remove this annotation. Please try again.");
    }
  };
  const jump = (id: string) => {
    const mark = content.current?.querySelector(
      `[data-note="${CSS.escape(id)}"]`,
    );
    mark?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  };
  return (
    <main id="main" className="reader-layout" data-sidebar-open={sidebarOpen}>
      <Link
        to="/"
        className="reader-back tool"
        aria-label="Back to reading list"
        title="Back to reading list"
      >
        <ArrowLeft size={20} />
      </Link>
      <button
        ref={sidebarToggle}
        className="reader-sidebar-toggle tool"
        aria-label={sidebarOpen ? "Hide notes" : "Show notes"}
        aria-expanded={sidebarOpen}
        aria-controls="reader-notes"
        aria-keyshortcuts="Meta+Shift+B Control+Shift+B"
        title="Toggle notes (⌘⇧B / Ctrl⇧B)"
        onClick={() => changeSidebar(!sidebarOpen)}
      >
        <PanelRight size={20} />
      </button>
      <div
        className="reader-main"
        onLoadCapture={() => {
          // Publisher images can move the selected passage after loading.
          setSelection((current) => {
            if (!current) return null;
            const selected = window.getSelection();
            const mark = current.annotationId
              ? content.current?.querySelector(
                  `[data-note="${CSS.escape(current.annotationId)}"]`,
                )
              : null;
            const rect =
              mark?.getBoundingClientRect() ??
              (selected?.rangeCount
                ? selected.getRangeAt(0).getBoundingClientRect()
                : null);
            return rect && rect.bottom > 0 && rect.top < window.innerHeight
              ? { ...current, rect }
              : null;
          });
        }}
      >
        <header className="article-heading">
          <div className="eyebrow">
            {article.tags.join(" / ") || sourceName(article.url)}
          </div>
          <h1>{article.title}</h1>
          {article.description && (
            <p className="standfirst">{article.description}</p>
          )}
          <div className="reader-byline">
            <span>
              {article.author ? (
                <>
                  Words by <strong>{article.author}</strong>
                </>
              ) : (
                <>
                  From <strong>{sourceName(article.url)}</strong>
                </>
              )}
            </span>
            {article.minutes && <span>{article.minutes} MIN READ</span>}
          </div>
        </header>
        {article.image && /^https?:\/\//.test(article.image) && (
          <figure className="hero">
            <img
              src={article.image}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.parentElement!.hidden = true;
              }}
            />
          </figure>
        )}
        {loading ? (
          <p className="reader-status" role="status">
            Opening the article…
          </p>
        ) : loadError ? (
          <div className="reader-status" role="alert">
            <p>{loadError}</p>
            <button className="primary" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : !article.bodyPath ? (
          <div className="reader-status">
            <p>Full text not downloaded.</p>
            <a
              className="primary"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original <ArrowRight size={16} />
            </a>
          </div>
        ) : (
          <div
            ref={content}
            className="article-body"
            data-testid="article-body"
            onClick={(event) => {
              if (window.getSelection()?.isCollapsed)
                openHighlight(event.target);
            }}
            onKeyDown={(event) => {
              if (
                (event.key === "Enter" || event.key === " ") &&
                (event.target as Element).closest(".article-highlight")
              ) {
                event.preventDefault();
                openHighlight(event.target);
              }
            }}
          />
        )}
        <footer className="article-end">
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            Read at {sourceName(article.url)} <ArrowRight size={14} />
          </a>
          <Link to="/">Back to your reading list</Link>
        </footer>
      </div>
      <aside
        id="reader-notes"
        className="annotation-sidebar"
        aria-label="Article annotations"
        hidden={!sidebarOpen}
      >
        <div className="notes-sticky">
          <div className="notes-heading">
            <span className="eyebrow">NOTES</span>
            <span>{annotations.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="reader-sidebar-actions">
            <ArticleActions article={article} notify={notify} />
          </div>
          <form
            className="note-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {quote && (
              <div className="draft-quote">
                <blockquote>{quote.selectedText}</blockquote>
                <button
                  type="button"
                  className="tool"
                  aria-label="Remove selected quote"
                  onClick={() => setQuote(undefined)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <label className="sr-only" htmlFor="note-draft">
              {editing ? "Edit note" : "Write a note"}
            </label>
            <textarea
              ref={composer}
              id="note-draft"
              placeholder="Write a note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
            />
            <div className="composer-actions">
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setDraft("");
                    setQuote(undefined);
                  }}
                >
                  Cancel
                </button>
              )}
              <button type="submit" disabled={!draft.trim() || saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Save note"}
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
          {!annotations.length && (
            <p className="notes-help">Select text to highlight or annotate.</p>
          )}
          <div className="notes-list">
            {annotations.map((note) => (
              <article key={note.id} className="annotation">
                {note.quote && (
                  <button
                    className="quoted-passage"
                    onClick={() => jump(note.id)}
                    title="Go to passage"
                  >
                    <blockquote>{note.quote.selectedText}</blockquote>
                  </button>
                )}
                {note.text && <p>{note.text}</p>}
                <div className="annotation-meta">
                  <time dateTime={new Date(note.createdAt).toISOString()}>
                    {new Date(note.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  <div>
                    <Tool
                      label="Edit annotation"
                      onClick={() => {
                        setEditing(note.id);
                        setDraft(note.text);
                        setQuote(note.quote);
                        setDraftColor(note.color ?? "yellow");
                        focusComposer();
                      }}
                    >
                      <Pencil size={13} />
                    </Tool>
                    <Tool
                      label="Delete annotation"
                      onClick={() => void remove(note.id)}
                    >
                      <Trash2 size={13} />
                    </Tool>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </aside>
      {selection && (
        <HighlightToolbar
          rect={selection.rect}
          currentColor={selection.color}
          text={selection.quote.selectedText}
          busy={saving}
          notify={notify}
          onClose={dismissSelection}
          onColor={(color) => void highlight(color)}
          onNote={() => {
            const existing = annotations.find(
              (n) => n.id === selection.annotationId,
            );
            setQuote(selection.quote);
            setDraftColor(selection.color ?? "yellow");
            setEditing(existing?.id ?? null);
            setDraft(existing?.text ?? "");
            dismissSelection();
            focusComposer();
          }}
        />
      )}
    </main>
  );
}
