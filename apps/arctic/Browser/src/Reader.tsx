import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Highlighter,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  applyHighlight,
  createHighlightFromSelection,
  type TextHighlight,
} from "@zsh-eng/text-highlighter";
import type { Article, Annotation } from "./model";
import { sourceName } from "./model";
import { changeLibrary } from "./store";
import { cleanArticle } from "./content";
import { ArticleActions, Tool } from "./ui";
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
  const [selection, setSelection] = useState<TextHighlight | null>(null);
  const [quote, setQuote] = useState<TextHighlight | undefined>();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
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
          attributes: { "data-note": note.id },
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
        setSelection(null);
        return;
      }
      setSelection(createHighlightFromSelection(selected, root));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);
  const save = async (onlyHighlight = false) => {
    const passage = onlyHighlight ? (selection ?? undefined) : quote;
    if ((!onlyHighlight && !draft.trim()) || (onlyHighlight && !passage))
      return;
    setSaving(true);
    try {
      const note: Annotation = {
        id: editing ?? crypto.randomUUID(),
        articleId: article.id,
        text: onlyHighlight ? "" : draft.trim(),
        quote: passage,
        createdAt: Date.now(),
      };
      await changeLibrary((l) => ({
        ...l,
        articles: l.articles.map((a) =>
          a.id === article.id ? { ...a, saved: true } : a,
        ),
        annotations: editing
          ? l.annotations.map((n) => (n.id === editing ? note : n))
          : [...l.annotations, note],
      }));
      setDraft("");
      setQuote(undefined);
      setEditing(null);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      notify(onlyHighlight ? "Passage highlighted." : "Note saved.");
    } catch {
      notify("Your note could not be saved. Your draft is still here.");
    } finally {
      setSaving(false);
    }
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
    <main id="main" className="reader-layout">
      <div className="reader-main">
        <div className="reader-toolbar">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} />
            Reading list
          </Link>
          <ArticleActions article={article} notify={notify} />
        </div>
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
          />
        )}
        <footer className="article-end">
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            Read at {sourceName(article.url)} <ArrowRight size={14} />
          </a>
          <Link to="/">Back to your reading list</Link>
        </footer>
      </div>
      <aside className="annotation-sidebar" aria-label="Article annotations">
        <div className="notes-sticky">
          <div className="notes-heading">
            <span className="eyebrow">NOTES</span>
            <span>{annotations.length.toString().padStart(2, "0")}</span>
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
                        composer.current?.focus();
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
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="Selected passage actions"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button disabled={saving} onClick={() => void save(true)}>
            <Highlighter size={16} />
            Highlight
          </button>
          <button
            onClick={() => {
              setQuote(selection);
              setEditing(null);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
              composer.current?.focus();
            }}
          >
            <MessageSquarePlus size={16} />
            Add note
          </button>
        </div>
      )}
    </main>
  );
}
