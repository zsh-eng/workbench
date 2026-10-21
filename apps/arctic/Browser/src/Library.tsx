import { Search, Star } from "lucide-react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  Link,
  useLocation,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import {
  folders,
  inFolder,
  matches,
  minutes,
  sortFolder,
  type Article,
  type Folder,
} from "./articles";
import { useArticles, useSession, useStatus } from "./state";
import {
  AccountMenu,
  CardMenu,
  CardMenuButton,
  describeStatus,
} from "./ui";

export function Library({ folder }: { folder: Folder }) {
  const articles = useArticles();
  const status = useStatus();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // The page owns its filters and the URL follows them, so quick changes never race navigation.
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [topic, setTopic] = useState(() => params.get("topic"));
  const deferredQuery = useDeferredValue(query.trim());
  // Topics belong to a folder: a new folder starts with all of them.
  const [shown, setShown] = useState(folder);
  if (shown !== folder) {
    setShown(folder);
    setTopic(null);
  }
  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (topic) next.set("topic", topic);
    if (next.toString() !== new URLSearchParams(location.search).toString())
      setParams(next, { replace: true, preventScrollReset: true });
  }, [query, topic, location.search, setParams]);

  const shelf = useMemo(
    () =>
      sortFolder(
        articles.filter((article) => inFolder(article, folder)),
        folder,
      ),
    [articles, folder],
  );
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const article of shelf)
      for (const tag of article.tags)
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [shelf]);
  const visible = useMemo(
    () =>
      shelf.filter(
        (article) =>
          (!topic || article.tags.includes(topic)) &&
          (!deferredQuery || matches(article, deferredQuery)),
      ),
    [shelf, topic, deferredQuery],
  );
  // Back and Forward render every card at once, so the scroll position returns.
  const returning =
    useNavigationType() === "POP" && location.key !== "default";
  const rendered = useSteps(
    visible.length,
    `${folder}\n${topic}\n${deferredQuery}`,
    returning,
  );

  useLayoutEffect(() => {
    if (visible.length && !performance.getEntriesByName("arctic:cards").length)
      performance.mark("arctic:cards");
  }, [visible.length]);

  const first =
    articles.length === 0 &&
    (status.phase === "loading" || status.phase === "syncing");
  // Every card links with this one object, so a new search or folder does not
  // render the cards again. A history entry keeps a copy made when it opens.
  const opened = useRef({ from: "/" }).current;
  useLayoutEffect(() => {
    opened.from = location.pathname + location.search;
  });
  const title = folders.find((item) => item.id === folder)!;

  return (
    <>
      <LibraryBar query={query} onQuery={setQuery} />
      <header className="shelf">
        <nav className="tabs" aria-label="Library">
          {folders.map((item) => (
            <Link
              key={item.id}
              to={item.path + (query ? `?q=${encodeURIComponent(query)}` : "")}
              className="tab"
              aria-current={item.id === folder ? "page" : undefined}
            >
              {item.title}
            </Link>
          ))}
        </nav>
        <div className="shelf-meta">
          {first
            ? "Getting your library…"
            : `${visible.length.toLocaleString()} ${visible.length === 1 ? "article" : "articles"}`}
        </div>
        {topics.length > 1 && folder !== "history" && (
          <div className="topics" role="group" aria-label="Topics">
            <button
              type="button"
              className="topic"
              aria-pressed={!topic}
              onClick={() => setTopic(null)}
            >
              All
            </button>
            {topics.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className="topic"
                aria-pressed={topic === name}
                onClick={() => setTopic(topic === name ? null : name)}
              >
                {name}
                <span>{count}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {visible.length > 0 ? (
        <main className="grid">
          {visible.slice(0, rendered).map((article) => (
            <Card key={article.id} article={article} state={opened} />
          ))}
        </main>
      ) : first ? null : (
        <div className="empty">
          <h2>{query || topic ? "Nothing matches." : title.empty}</h2>
          <p>
            {query || topic
              ? "Try another word, or clear the search."
              : folder === "saved"
                ? "Save an article with Arctic on your iPhone. It appears here after the next sync."
                : "Articles appear here as you read and sort them."}
          </p>
        </div>
      )}
      <CardMenu />
    </>
  );
}

const FIRST_STEP = 36;
const STEP = 72;

/**
 * How many cards to render. A long list renders in steps, one per frame, so
 * the first cards paint at once and no frame waits for the rest. A new list
 * starts again; a change to the same list keeps what is on screen.
 */
function useSteps(length: number, list: string, all: boolean) {
  const [limit, setLimit] = useState(FIRST_STEP);
  const [current, setCurrent] = useState(list);
  if (current !== list) {
    setCurrent(list);
    setLimit(FIRST_STEP);
  }
  useEffect(() => {
    if (all || limit >= length) return;
    const frame = requestAnimationFrame(() =>
      startTransition(() => setLimit((value) => value + STEP)),
    );
    return () => cancelAnimationFrame(frame);
  }, [all, limit, length]);
  return all ? length : limit;
}

function LibraryBar({
  query,
  onQuery,
}: {
  query: string;
  onQuery: (value: string) => void;
}) {
  const session = useSession();
  const status = useStatus();
  const input = useRef<HTMLInputElement>(null);
  const scrolled = useScrolled();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const note =
    status.phase === "offline" || status.phase === "error"
      ? describeStatus(status, session.pendingCount)
      : "";
  return (
    <div className="bar" data-scrolled={scrolled || undefined}>
      <Link to="/" className="brand">
        <img src="/icon-64.png" alt="" />
        Arctic
      </Link>
      {note && <span className="status-note">{note}</span>}
      <label className="search">
        <Search size={16} />
        <span className="visually-hidden">Search</span>
        <input
          ref={input}
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        <kbd>/</kbd>
      </label>
      <AccountMenu />
    </div>
  );
}

export function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

/**
 * The opened card shares its cover and title with the reader page. The library
 * stays mounted under the reader, so the last card gives up its names first.
 */
let marked: HTMLElement[] = [];
function mark(event: MouseEvent<HTMLElement>) {
  for (const element of marked)
    element.style.removeProperty("view-transition-name");
  const card = event.currentTarget.closest(".card");
  const cover = card?.querySelector<HTMLElement>(".cover");
  const title = card?.querySelector<HTMLElement>(".card-title");
  cover?.style.setProperty("view-transition-name", "cover");
  title?.style.setProperty("view-transition-name", "title");
  marked = [cover, title].filter((element) => element != null);
}

const Card = memo(function Card({
  article,
  state,
}: {
  article: Article;
  state: { from: string };
}) {
  const path = `/read/${article.id}`;
  return (
    <article
      className="card"
      data-read={article.read || undefined}
      data-copy={article.copy ? "" : undefined}
    >
      <Link
        to={path}
        state={state}
        viewTransition
        className="cover"
        tabIndex={-1}
        aria-hidden
        onClick={mark}
      >
        {article.image ? (
          <Cover src={article.image} />
        ) : article.subtitle ? (
          <div className="cover-text">{article.subtitle}</div>
        ) : (
          <div className="cover-site">{article.host}</div>
        )}
      </Link>
      <div className="card-line">
        <Source article={article} />
        <CardMenuButton article={article} />
      </div>
      <Link
        to={path}
        state={state}
        viewTransition
        className="card-title"
        onClick={mark}
      >
        {article.title}
      </Link>
    </article>
  );
});

export function Source({ article }: { article: Article }) {
  return (
    <span className="source">
      {article.favicon && <Favicon src={article.favicon} />}
      <span className="host">{article.host}</span>
      {article.copy && (
        <>
          <span className="dot">·</span>
          {minutes(article.copy.words)} min
        </>
      )}
      {article.favourite && (
        <Star size={12} className="star" aria-label="Favourite" />
      )}
    </span>
  );
}

function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      ref={(image) => {
        if (image?.complete && image.naturalWidth) image.dataset.loaded = "";
      }}
      onLoad={(event) => (event.currentTarget.dataset.loaded = "")}
      onError={() => setFailed(true)}
    />
  );
}

function Favicon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
