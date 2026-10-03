import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ArrowDown, ArrowRight, Check, Plus, Search, X } from "lucide-react";
import {
  articlePath,
  sourceName,
  webURL,
  type Article,
  type Annotation,
} from "./model";
import { changeLibrary, readDownloadedBody, useLibrary } from "./store";
import { ArticleActions, SortSelect } from "./ui";
import { LoadingStatus } from "./LoadingStatus";
import { AddArticle } from "./AddArticle";
import { Reader } from "./Reader";
const folders = [
  ["saved", "Reading list"],
  ["favourites", "Favourites"],
  ["archive", "Archive"],
  ["all", "All articles"],
] as const;
export function App() {
  const { library, error } = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<{
    text: string;
    undo?: () => Promise<void>;
  } | null>(null);
  const notify = useCallback((text: string) => setNotice({ text }), []);
  const deleteArticle = async (id: string) => {
    let removed: Article | undefined;
    let annotations: Annotation[] = [];
    try {
      const downloadedBody = await readDownloadedBody(id);
      await changeLibrary((library) => {
        removed = library.articles.find((article) => article.id === id);
        annotations = library.annotations.filter(
          (note) => note.articleId === id,
        );
        return {
          ...library,
          articles: library.articles.filter((article) => article.id !== id),
          annotations: library.annotations.filter(
            (note) => note.articleId !== id,
          ),
        };
      });
      if (!removed) return;
      const article = removed;
      let restoring = false;
      const undo = async () => {
        if (restoring) return;
        restoring = true;
        try {
          await changeLibrary(
            (library) => {
              const existing = library.articles.find(
                (item) => item.id === id || item.url === article.url,
              );
              return {
                ...library,
                articles: existing
                  ? library.articles
                  : [article, ...library.articles],
                annotations: [
                  ...library.annotations,
                  ...annotations
                    .filter(
                      (note) =>
                        !library.annotations.some(
                          (item) => item.id === note.id,
                        ),
                    )
                    .map((note) => ({
                      ...note,
                      articleId: existing?.id ?? id,
                    })),
                ],
              };
            },
            downloadedBody ? { id, body: downloadedBody } : undefined,
          );
          notify("Article restored.");
        } catch {
          restoring = false;
          setNotice({ text: "Could not restore. Try again.", undo });
        }
      };
      setNotice({ text: "Article deleted.", undo });
    } catch {
      notify("Could not delete this article. Please try again.");
    }
  };
  const [addOpen, setAddOpen] = useState(false);
  const [pendingURL, setPendingURL] = useState("");
  const addTrigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusSearchAfterNavigation = useRef(false);
  const query = params.get("q") ?? "";
  const folder = params.get("folder") ?? "saved";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "reading";
  const reader = location.pathname.startsWith("/read/");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.undo ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false])",
        ) ||
        document.querySelector('[role="dialog"], [role="listbox"]')
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        if (reader) {
          focusSearchAfterNavigation.current = true;
          navigate("/");
        } else search.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [reader, navigate]);
  useEffect(() => {
    if (!reader && focusSearchAfterNavigation.current) {
      focusSearchAfterNavigation.current = false;
      search.current?.focus();
    }
  }, [reader]);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key === "q" });
  };
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    library?.articles
      .filter((a) => a.saved && !a.archived)
      .forEach((a) =>
        a.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)),
      );
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [library]);
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const result =
      library?.articles.filter(
        (a) =>
          (folder === "all" ||
            (folder === "favourites"
              ? a.favourite
              : folder === "archive"
                ? a.archived
                : a.saved && !a.archived)) &&
          (!tag || a.tags.includes(tag)) &&
          terms.every((term) =>
            `${a.title} ${a.description} ${a.author} ${a.url} ${a.tags.join(" ")}`
              .toLocaleLowerCase()
              .includes(term),
          ),
      ) ?? [];
    if (sort === "newest") result.sort((a, b) => b.savedAt - a.savedAt);
    if (sort === "title") result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [library, query, folder, tag, sort]);
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    setLimit(30);
  }, [query, folder, tag, sort]);
  const closeAdd = () => {
    setAddOpen(false);
    addTrigger.current?.focus();
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        reader ||
        target?.closest(
          "input, textarea, [contenteditable]:not([contenteditable=false])",
        ) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const url = webURL(
        event.clipboardData?.getData("text/plain").trim() ?? "",
      );
      if (!url) return;
      event.preventDefault();
      setPendingURL(url);
      setAddOpen(true);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [reader]);
  let selectedURL = "";
  try {
    selectedURL = decodeURIComponent(location.pathname.slice("/read/".length));
  } catch {
    /* Show missing article state. */
  }
  const selected = library?.articles.find((a) => a.url === selectedURL);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {!reader && (
        <header className="site-header">
          <Link to="/" className="brand" aria-label="Arctic home">
            <img
              className="brand-icon"
              src="/arctic.png"
              width="36"
              height="36"
              alt=""
            />
            <span className="brand-wordmark">arctic</span>
          </Link>
          <div className="header-middle">
            {!reader && (
              <div className="search">
                <Search size={18} />
                <input
                  ref={search}
                  aria-label="Search articles"
                  aria-keyshortcuts="/"
                  placeholder="Search articles…"
                  value={query}
                  onChange={(e) => setFilter("q", e.target.value)}
                />
                {query ? (
                  <button
                    className="tool"
                    aria-label="Clear search"
                    onClick={() => setFilter("q", "")}
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </div>
            )}
          </div>
          <button
            ref={addTrigger}
            className="add-button"
            aria-expanded={addOpen}
            aria-controls="add-article-inline"
            onClick={() => {
              setPendingURL("");
              setAddOpen((open) => !open);
            }}
          >
            <Plus size={17} />
            <span>Add article</span>
          </button>
        </header>
      )}
      {!library ? (
        <main
          id="main"
          className={error ? "empty" : "library-layout"}
          aria-busy={!error}
        >
          {error ? (
            <div role="alert">
              <h1>Your library could not open.</h1>
              <p>{error}</p>
              <button
                className="primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          ) : (
            <LoadingStatus className="library-loading">
              Opening your reading list…
            </LoadingStatus>
          )}
        </main>
      ) : reader ? (
        selected ? (
          <Reader
            key={selected.id}
            article={selected}
            annotations={library.annotations.filter(
              (n) => n.articleId === selected.id,
            )}
            notify={notify}
          />
        ) : (
          <main id="main" className="empty">
            <Link to="/">← Back to library</Link>
            <h1>Article not in this library.</h1>
            <p>This link may belong to another local library.</p>
            {webURL(selectedURL) && (
              <a href={selectedURL} target="_blank" rel="noopener noreferrer">
                Open original <ArrowRight size={16} />
              </a>
            )}
          </main>
        )
      ) : (
        <main id="main" className="library-layout">
          <section className="library-main">
            {addOpen && (
              <div id="add-article-inline">
                <AddArticle
                  key={pendingURL}
                  articles={library.articles}
                  initialURL={pendingURL}
                  onClose={closeAdd}
                  onOpen={(url) => navigate(articlePath(url))}
                  notify={notify}
                />
              </div>
            )}
            <h1 className="sr-only">
              {tag ||
                (query
                  ? "Search results"
                  : folders.find(([id]) => id === folder)?.[1] ||
                    "Reading list")}
            </h1>
            <div className="library-controls">
              <nav aria-label="Library folders">
                {folders.map(([id, label]) => (
                  <button
                    key={id}
                    className={folder === id ? "selected" : ""}
                    aria-current={folder === id ? "page" : undefined}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set("folder", id);
                      setParams(next);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <SortSelect
                value={sort}
                onChange={(value) => setFilter("sort", value)}
              />
            </div>
            <div className="result-line">
              <span>
                {filtered.length}{" "}
                {filtered.length === 1 ? "article" : "articles"}
              </span>
              {tag && (
                <button onClick={() => setFilter("tag", "")}>
                  Clear “{tag}” <X size={12} />
                </button>
              )}
            </div>
            <div className="article-grid">
              {filtered.slice(0, limit).map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  notify={notify}
                  onDelete={() => void deleteArticle(article.id)}
                  onTag={(value) => setFilter("tag", value)}
                />
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="empty">
                <Search size={26} />
                <h2>No articles here yet.</h2>
                <p>Try a different search, tag, or folder.</p>
                <button className="text-button" onClick={() => setParams({})}>
                  Back to reading list <ArrowRight size={15} />
                </button>
              </div>
            )}
            {filtered.length > limit && (
              <button
                className="load-more"
                onClick={() => setLimit((n) => n + 30)}
              >
                Load more <ArrowDown size={16} />
              </button>
            )}
          </section>
          <aside className="tag-sidebar">
            <div className="sidebar-sticky">
              <p className="eyebrow">TAGS</p>
              <button
                className={`tag-row ${!tag ? "chosen" : ""}`}
                onClick={() => setFilter("tag", "")}
              >
                <span>All topics</span>
                <span>
                  {
                    library.articles.filter((a) => a.saved && !a.archived)
                      .length
                  }
                </span>
              </button>
              {tags.map(([name, count]) => (
                <button
                  key={name}
                  className={`tag-row ${tag === name ? "chosen" : ""}`}
                  aria-pressed={tag === name}
                  onClick={() => setFilter("tag", tag === name ? "" : name)}
                >
                  <span>
                    <span className="hash">#</span>
                    {name}
                  </span>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </aside>
        </main>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice.text}
          {notice.undo && (
            <button className="toast-undo" onClick={() => void notice.undo?.()}>
              Undo
            </button>
          )}
          <button
            className="tool"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
function ArticleCard({
  article,
  notify,
  onTag,
  onDelete,
}: {
  article: Article;
  notify: (message: string) => void;
  onTag: (tag: string) => void;
  onDelete: () => void;
}) {
  return (
    <article className="article-card">
      <div className="card-actions">
        <ArticleActions article={article} notify={notify} onDelete={onDelete} />
      </div>
      <Link className="card-top" to={articlePath(article.url)}>
        <span className="card-source">
          {sourceName(article.url)}
          {article.minutes && <span>{article.minutes} MIN READ</span>}
        </span>
        <h2>{article.title}</h2>
        {article.author && (
          <p className="byline">
            Words by <strong>{article.author}</strong>
          </p>
        )}
      </Link>
      <Link className="card-description" to={articlePath(article.url)}>
        {article.description && <p>{article.description}</p>}
        <span className="read-more">
          Read more <ArrowRight size={17} />
        </span>
      </Link>
      <div className="card-tags">
        {article.tags.length
          ? article.tags.map((tag) => (
              <button key={tag} onClick={() => onTag(tag)}>
                {tag}
              </button>
            ))
          : null}
        {article.favourite && (
          <span className="card-favourite" aria-label="Favourite">
            ★
          </span>
        )}
      </div>
    </article>
  );
}
