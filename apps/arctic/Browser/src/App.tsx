import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ArrowDown, ArrowRight, Check, Plus, Search, X } from "lucide-react";
import { articlePath, sourceName, webURL, type Article } from "./model";
import { changeLibrary, useLibrary } from "./store";
import { ArticleActions, Modal, SortSelect } from "./ui";
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
  const [notice, setNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [urlInput, setURLInput] = useState("");
  const [addError, setAddError] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const query = params.get("q") ?? "";
  const folder = params.get("folder") ?? "saved";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "reading";
  const reader = location.pathname.startsWith("/read/");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        if (reader) navigate("/");
        requestAnimationFrame(() => search.current?.focus());
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [reader, navigate]);
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
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = webURL(urlInput.trim());
    if (!url) {
      setAddError("Enter a complete http:// or https:// article URL.");
      return;
    }
    try {
      await changeLibrary((l) => {
        const found = l.articles.some((a) => a.url === url);
        return {
          ...l,
          articles: found
            ? l.articles.map((a) =>
                a.url === url ? { ...a, saved: true, archived: false } : a,
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
                  saved: true,
                  archived: false,
                  favourite: false,
                },
                ...l.articles,
              ],
        };
      });
      setAddOpen(false);
      setURLInput("");
      navigate(articlePath(url));
    } catch {
      setAddError("Could not save this link. Please try again.");
    }
  };
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
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Arctic home">
          <img
            className="brand-icon"
            src="/arctic.png"
            width="36"
            height="36"
            alt=""
          />
          <span>arctic</span>
        </Link>
        <div className="header-middle">
          {!reader && (
            <div className="search">
              <Search size={18} />
              <input
                ref={search}
                aria-label="Search articles"
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
                <kbd>⌘ K</kbd>
              )}
            </div>
          )}
        </div>
        <button
          className="add-button"
          onClick={() => {
            setAddError("");
            setAddOpen(true);
          }}
        >
          <Plus size={17} />
          <span>Add article</span>
        </button>
      </header>
      {!library ? (
        <main id="main" className="empty">
          <h1>
            {error
              ? "Your library could not open."
              : "Opening your reading list…"}
          </h1>
          {error && (
            <>
              <p>{error}</p>
              <button
                className="primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </>
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
            notify={setNotice}
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
                  notify={setNotice}
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
      <Modal title="Add article" open={addOpen} onOpenChange={setAddOpen}>
        <form onSubmit={add}>
          <label htmlFor="article-url">Article URL</label>
          <input
            id="article-url"
            type="url"
            placeholder="https://…"
            value={urlInput}
            onChange={(e) => setURLInput(e.target.value)}
            autoFocus
            required
          />
          {addError && <p role="alert">{addError}</p>}
          <button className="primary" type="submit">
            Save article <ArrowRight size={16} />
          </button>
        </form>
      </Modal>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="tool"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
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
}: {
  article: Article;
  notify: (message: string) => void;
  onTag: (tag: string) => void;
}) {
  return (
    <article className="article-card">
      <div className="card-actions">
        <ArticleActions article={article} notify={notify} />
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
