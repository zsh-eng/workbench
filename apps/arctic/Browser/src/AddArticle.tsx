import { useRef, useState } from "react";
import { ArrowRight, ClipboardPaste, Link as LinkIcon, X } from "lucide-react";
import { type Article, sourceName, webURL } from "./model";
import { prepareDownload } from "./downloads";
import { changeLibrary } from "./store";

// Desktop counterpart of the native ClipboardBanner: Save and Open are separate.
export function AddArticle({
  articles,
  initialURL,
  onClose,
  onOpen,
  notify,
}: {
  articles: Article[];
  initialURL: string;
  onClose: () => void;
  onOpen: (url: string) => void;
  notify: (message: string) => void;
}) {
  const [input, setInput] = useState(initialURL);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const url = webURL(input.trim());
  const existing = articles.find((article) => article.url === url);
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      setError(webURL(text.trim()) ? "" : "Paste an http:// or https:// link.");
    } catch {
      setError("Paste the link into the URL field.");
    }
    field.current?.focus();
  };
  const submit = async (save: boolean) => {
    if (!url) {
      setError("Enter an http:// or https:// link.");
      field.current?.focus();
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      let target: Article | undefined;
      await changeLibrary((library) => {
        const found = library.articles.some((article) => article.url === url);
        const next = {
          ...library,
          articles: found
            ? library.articles.map((article) =>
                article.url === url && save
                  ? { ...article, saved: true, archived: false }
                  : article,
              )
            : [
                {
                  id: crypto.randomUUID(),
                  url,
                  title: sourceName(url),
                  description: "",
                  author: "",
                  tags: [],
                  savedAt: Date.now(),
                  saved: save,
                  archived: false,
                  favourite: false,
                },
                ...library.articles,
              ],
        };
        target = next.articles.find((article) => article.url === url);
        return next;
      });
      if (target) prepareDownload(target);
      onClose();
      if (save) notify("Article saved.");
      else onOpen(url);
    } catch {
      setError(
        save
          ? "Could not save this link. Please try again."
          : "Could not open this link. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="add-article-panel"
      aria-label="Add article"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(!existing?.saved);
        }}
      >
        <div className="add-url-row">
          <LinkIcon size={18} aria-hidden="true" />
          <input
            ref={field}
            autoFocus
            aria-label="Article URL"
            aria-describedby={error ? "add-article-error" : undefined}
            aria-invalid={!!error}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste an article link…"
            value={input}
            disabled={busy}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
          />
          <button
            type="button"
            className="tool"
            title="Paste link"
            aria-label="Paste link"
            disabled={busy}
            onClick={() => void paste()}
          >
            <ClipboardPaste size={17} />
          </button>
          <button
            type="button"
            className="tool"
            title="Dismiss"
            aria-label="Dismiss add article"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        {url && (
          <div className="add-link-preview">
            {existing?.image && (
              <img
                src={existing.image}
                alt=""
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
            <div className="add-link-details">
              <strong>{existing?.title || sourceName(url)}</strong>
              <span>{url}</span>
            </div>
            <div className="add-link-actions">
              {!existing?.saved && (
                <button className="primary" type="submit" disabled={busy}>
                  Save
                </button>
              )}
              <button
                className="add-open"
                type="button"
                disabled={busy}
                onClick={() => void submit(false)}
              >
                Open <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {error && (
          <p id="add-article-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
