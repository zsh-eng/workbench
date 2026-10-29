import {
  Archive,
  Bookmark,
  Clock,
  Highlighter,
  History,
  LayoutGrid,
  LayoutPanelTop,
  List,
  Search,
  Star,
} from "lucide-react";
import {
  memo,
  startTransition,
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
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
import { updateSettings, useSettings } from "./settings";
import { Choice } from "./SettingsPage";
import { AddLinkButton, isFresh, LinkDock, usePasteToSave } from "./AddLink";
import { useReservedPictures } from "./links";
import type { SyncSummary } from "@zsh-eng/local-sync";
import {
  useArticles,
  useRestoring,
  useSession,
  useStatusText,
  useSyncing,
} from "./state";
import { useCompact, useWide } from "./surface";
import { idlePrefetchable, isCover, prefetch } from "./text";
import { useProgress } from "./position";
import { AccountMenu, CardMenu, CardMenuButton } from "./ui";
import { RestoreIsland } from "./RestoreIsland";

export function Library({ folder }: { folder: Folder }) {
  const articles = useArticles();
  const syncing = useSyncing();
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
  // A save shows all of Saved, so the new card is in view (AddLink.tsx).
  const showAll = (location.state as { showAll?: boolean } | null)?.showAll
    ? location.key
    : undefined;
  const [shownAll, setShownAll] = useState(showAll);
  if (showAll && showAll !== shownAll) {
    setShownAll(showAll);
    setQuery("");
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
  const compact = useCompact();
  // Back and Forward render every card at once, so the scroll position returns.
  const returning = useNavigationType() === "POP" && location.key !== "default";
  // A phone shows a dozen cards at most, so it renders those first.
  const rendered = useSteps(
    visible.length,
    `${folder}\n${topic}\n${deferredQuery}`,
    returning,
    compact ? 12 : 36,
  );

  // A new device's first pull arrives in the phone's upload order, so the
  // list waits for its last page and then shows in order, all at once. A
  // pull that stopped shows what arrived (docs/FIRST_SYNC.md).
  const restoring = useRestoring();
  const waiting = restoring && (syncing || articles.length === 0);

  useLayoutEffect(() => {
    if (
      visible.length &&
      !waiting &&
      !performance.getEntriesByName("arctic:cards").length
    )
      performance.mark("arctic:cards");
  }, [visible.length, waiting]);
  // Every card links with this one object, so a new search or folder does not
  // render the cards again. A history entry keeps a copy made when it opens.
  const opened = useRef({ from: "/" }).current;
  useLayoutEffect(() => {
    opened.from = location.pathname + location.search;
  });
  const title = folders.find((item) => item.id === folder)!;
  const { layout } = useSettings();
  const grid = useRef<HTMLElement>(null);
  const [area, columns] = useColumns();
  // While the placeholder shows, the grid is not there to prefetch from.
  const intent = usePrefetch(grid, waiting ? NO_ARTICLES : visible);
  const search = useRef<HTMLInputElement>(null);
  usePasteToSave();
  useSearchKey(search);

  const wide = useWide();
  const counts = useMemo(() => {
    const result = { saved: 0, favourites: 0, archive: 0, history: 0 };
    for (const article of articles)
      for (const item of folders)
        if (inFolder(article, item.id)) result[item.id]++;
    return result;
  }, [articles]);

  // A new device's restore grows out of the count, and folds back into it
  // once the links are in. A phone's grows out of its account button.
  const count = (
    <RestoreIsland count={articles.length} align="start">
      <span className="shelf-count">
        {waiting
          ? "\u00a0"
          : `${visible.length.toLocaleString()} ${visible.length === 1 ? "article" : "articles"}`}
      </span>
    </RestoreIsland>
  );
  const layoutToggle = (
    <Choice
      label="Layout"
      className="layout-toggle"
      value={layout}
      options={[
        [
          "magazine",
          <>
            <LayoutPanelTop size={16} />
            <span className="visually-hidden">Magazine</span>
          </>,
        ],
        [
          "cards",
          <>
            <LayoutGrid size={16} />
            <span className="visually-hidden">Cards</span>
          </>,
        ],
        [
          "list",
          <>
            <List size={17} />
            <span className="visually-hidden">List</span>
          </>,
        ],
      ]}
      onChange={(next) => updateSettings({ layout: next })}
    />
  );
  const showTopics = topics.length > 1 && folder !== "history" && !waiting;
  const topicButton = (name: string | null, label: string, n: number) => (
    <button
      key={name ?? ""}
      type="button"
      className={wide ? "side-item" : "topic"}
      aria-pressed={topic === name}
      onClick={() => setTopic(name === null || topic === name ? null : name)}
    >
      {label}
      {(name !== null || compact || wide) && (
        <span className={wide ? "side-count" : undefined} aria-hidden>
          {n.toLocaleString()}
        </span>
      )}
    </button>
  );
  const reserved = useReservedPictures();
  const cells = useMemo(
    () =>
      layout === "magazine"
        ? magazineCells(
            visible.slice(0, rendered),
            columns,
            !deferredQuery,
            reserved,
          )
        : [],
    [layout, visible, rendered, columns, deferredQuery, reserved],
  );
  const list = waiting ? (
    <Waiting layout={layout} />
  ) : visible.length > 0 ? (
    <main className="grid" data-layout={layout} ref={grid} {...intent}>
      {layout === "magazine"
        ? cells.map((cell) =>
            cell.kind === "band" ? (
              <div key={cell.articles[0]!.id} className="band">
                {cell.articles.map((article) => (
                  <Card
                    key={article.id}
                    article={article}
                    state={opened}
                    eager={false}
                    kind="headline"
                    reserved={reserved.has(article.id)}
                  />
                ))}
              </div>
            ) : (
              <Card
                key={cell.article.id}
                article={cell.article}
                state={opened}
                eager={cell.eager}
                kind={cell.kind}
                reserved={reserved.has(cell.article.id)}
              />
            ),
          )
        : visible
            .slice(0, rendered)
            .map((article, index) => (
              <Card
                key={article.id}
                article={article}
                state={opened}
                eager={index < (compact ? 10 : 12)}
                reserved={reserved.has(article.id)}
              />
            ))}
    </main>
  ) : (
    <div className="empty">
      <h2>{query || topic ? "Nothing matches." : title.empty}</h2>
      <p>
        {query || topic
          ? "Try another word, or clear the search."
          : folder === "saved"
            ? "Save a link with + or ⌘V, or with Arctic on your iPhone."
            : "Articles appear here as you read and sort them."}
      </p>
    </div>
  );

  // A wide window: the folders, topics and places in a sidebar, so nothing
  // scrolls out of reach and the page has one left edge.
  if (wide)
    return (
      <div className="desk">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <img src="/icon-64.png" alt="" />
            Arctic
          </Link>
          <AddLinkButton row />
          <nav className="side-group" aria-label="Library">
            {folders.map((item) => (
              <Link
                key={item.id}
                to={
                  item.path + (query ? `?q=${encodeURIComponent(query)}` : "")
                }
                className="side-item"
                aria-current={item.id === folder ? "page" : undefined}
              >
                {FOLDER_ICONS[item.id]}
                {item.title}
                <span className="side-count" aria-hidden>
                  {counts[item.id].toLocaleString()}
                </span>
              </Link>
            ))}
          </nav>
          {showTopics && (
            <div className="side-group" role="group" aria-label="Topics">
              <h2 className="side-label">Topics</h2>
              {topicButton(null, "All", shelf.length)}
              {topics.map(([name, n]) => topicButton(name, name, n))}
            </div>
          )}
          <nav className="side-group side-end" aria-label="Places">
            <Link to="/highlights" className="side-item">
              <Highlighter size={16} />
              Highlights
            </Link>
            <Link to="/reading" className="side-item">
              <Clock size={16} />
              Reading time
            </Link>
            <AccountMenu row />
          </nav>
        </aside>
        <div className="desk-main">
          <DeskBar query={query} onQuery={setQuery} input={search}>
            {layoutToggle}
          </DeskBar>
          <header className="desk-head">
            <h1>{title.title}</h1>
            {count}
          </header>
          <div
            className="shelf-area"
            ref={area}
            data-columns={columns}
            style={{ "--columns": columns } as CSSProperties}
          >
            {list}
          </div>
        </div>
        <CardMenu />
      </div>
    );

  return (
    <>
      {compact ? (
        <PhoneStrip
          links={articles.length}
          folder={folder}
          query={query}
          onQuery={setQuery}
          input={search}
        />
      ) : (
        <LibraryBar query={query} onQuery={setQuery} input={search} />
      )}
      <header className="shelf">
        <nav className="tabs" aria-label="Library" hidden={compact}>
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
        <div className="shelf-meta" hidden={compact}>
          {!compact && count}
          {layoutToggle}
        </div>
        {showTopics && (
          <div className="topics" role="group" aria-label="Topics">
            {topicButton(null, "All", shelf.length)}
            {topics.map(([name, n]) => topicButton(name, name, n))}
          </div>
        )}
      </header>
      <div
        className="shelf-area"
        ref={area}
        data-columns={columns}
        style={{ "--columns": columns } as CSSProperties}
      >
        {list}
      </div>
      {compact && (
        <PhoneDock
          count={shelf.length}
          onSearch={() => {
            // Focus in the same tap, so the phone's keyboard opens.
            search.current?.focus();
            window.scrollTo({ top: 0 });
          }}
        />
      )}
      <CardMenu />
    </>
  );
}

const NO_ARTICLES: Article[] = [];

/**
 * A new device's library before its links arrive: quiet cards in the
 * layout's shape, so the page keeps its frame and nothing moves when the
 * real cards replace them. Nothing animates here; the restore island says
 * what happens (RestoreIsland.tsx).
 */
function Waiting({ layout }: { layout: string }) {
  return (
    <main className="grid waiting" data-layout={layout} aria-busy="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="card" data-image="" aria-hidden>
          <span className="cover" />
          <span className="card-line">
            <span
              className="bone"
              style={{ width: `${30 + ((index * 17) % 30)}%` }}
            />
          </span>
          <span className="card-title">
            <span className="bone" />
            <span
              className="bone"
              style={{ width: `${55 + ((index * 23) % 35)}%` }}
            />
          </span>
        </div>
      ))}
    </main>
  );
}

const FOLDER_ICONS: Record<Folder, ReactNode> = {
  saved: <Bookmark size={16} />,
  favourites: <Star size={16} />,
  archive: <Archive size={16} />,
  history: <History size={16} />,
};

/** The wide library's search, above the cards, with the layout beside it. */
function DeskBar({
  query,
  onQuery,
  input,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  input: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  const status = useStatusText();
  const scrolled = useScrolled();
  return (
    <div className="desk-bar" data-scrolled={scrolled || undefined}>
      <SearchField query={query} onQuery={onQuery} input={input} />
      <StatusNote status={status} />
      {children}
    </div>
  );
}

function SearchField({
  query,
  onQuery,
  input,
}: {
  query: string;
  onQuery: (value: string) => void;
  input: RefObject<HTMLInputElement | null>;
}) {
  return (
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
  );
}

/** "/" searches, from anywhere outside a field. */
function useSearchKey(input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog]"))
        return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);
}

/**
 * A phone's library header: the folders on one line, the current one on a
 * capsule that slides to the next, and the account. Searching turns the
 * line into the field, with Cancel.
 */
function PhoneStrip({
  links,
  folder,
  query,
  onQuery,
  input,
}: {
  /** The links on this device, for the restore island's count. */
  links: number;
  folder: Folder;
  query: string;
  onQuery: (value: string) => void;
  input: RefObject<HTMLInputElement | null>;
}) {
  const scrolled = useScrolled();
  const [focused, setFocused] = useState(false);
  const searching = focused || query !== "";
  const nav = useRef<HTMLElement>(null);
  const capsule = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>(
      "[aria-current=page]",
    );
    const pill = capsule.current;
    if (!current || !pill) return;
    pill.style.width = `${current.offsetWidth}px`;
    pill.style.transform = `translateX(${current.offsetLeft}px)`;
  }, [folder]);
  return (
    <div
      className="strip"
      data-scrolled={scrolled || undefined}
      data-searching={searching || undefined}
    >
      <nav className="folders" aria-label="Library" ref={nav}>
        <span className="capsule" ref={capsule} aria-hidden />
        {folders.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            replace
            className="folder"
            aria-current={item.id === folder ? "page" : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      <RestoreIsland count={links} align="end">
        <AccountMenu />
      </RestoreIsland>
      <label className="strip-search">
        <Search size={16} />
        <span className="visually-hidden">Search</span>
        <input
          ref={input}
          type="search"
          placeholder="Search"
          enterKeyHint="search"
          value={query}
          tabIndex={searching ? 0 : -1}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQuery("");
              event.currentTarget.blur();
            } else if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="cancel"
          tabIndex={searching ? 0 : -1}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            onQuery("");
            input.current?.blur();
          }}
        >
          Cancel
        </button>
      </label>
    </div>
  );
}

/** A phone's search and save, at the bottom, where a thumb rests. */
function PhoneDock({
  count,
  onSearch,
}: {
  count: number;
  onSearch: () => void;
}) {
  return (
    <LinkDock>
      <button type="button" className="search-capsule" onClick={onSearch}>
        <Search size={17} />
        Search{" "}
        {count > 0
          ? `${count.toLocaleString()} ${count === 1 ? "article" : "articles"}`
          : ""}
      </button>
    </LinkDock>
  );
}

/**
 * Prefetches an article's text and cover before it opens: when a pointer
 * rests on its card for a moment, when a touch or a click starts, when the
 * card takes focus, and, while the browser is idle, for the cards on screen.
 * One set of listeners on the list serves every card.
 */
function usePrefetch(grid: RefObject<HTMLElement | null>, visible: Article[]) {
  const session = useSession();
  const byId = useMemo(
    () => new Map(visible.map((article) => [article.id, article])),
    [visible],
  );
  const find = (target: EventTarget | null) => {
    const id = (target as Element | null)?.closest?.<HTMLElement>(".card")
      ?.dataset.id;
    return id ? byId.get(id) : undefined;
  };
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    let cancelled = false;
    let handle = 0;
    // Safari has no idle callbacks; a short timeout stands in. The two kinds
    // of handle share numbers, so each is cancelled only by its own kind.
    const hasIdle = typeof requestIdleCallback === "function";
    const idle = (work: () => void): number =>
      hasIdle
        ? requestIdleCallback(work, { timeout: 2000 })
        : Number(setTimeout(work, 200));
    const onScreen = () => {
      const articles: Article[] = [];
      for (const card of element.querySelectorAll<HTMLElement>(".card")) {
        const box = card.getBoundingClientRect();
        if (box.top > innerHeight) break;
        if (box.bottom < 0) continue;
        const article = byId.get(card.dataset.id ?? "");
        if (article) articles.push(article);
      }
      return articles;
    };
    // One article per idle period, so scrolling and typing never wait.
    const run = (queue: Article[]) => {
      const next = queue.shift();
      if (cancelled || !next) return;
      prefetch(session, next);
      handle = idle(() => run(queue));
    };
    const start = () => {
      handle = idle(() => {
        void idlePrefetchable(session, onScreen().slice(0, 12)).then(
          (articles) => !cancelled && run(articles),
        );
      });
    };
    start();
    window.addEventListener("scrollend", start);
    return () => {
      cancelled = true;
      window.removeEventListener("scrollend", start);
      if (hasIdle) cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [grid, byId, session]);

  return {
    onPointerOver: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(resting.current);
      const article = find(event.target);
      if (article)
        resting.current = setTimeout(() => prefetch(session, article), 60);
    },
    onPointerLeave: () => clearTimeout(resting.current),
    onPointerDown: (event: PointerEvent) => {
      const article = find(event.target);
      if (article) prefetch(session, article);
    },
    onFocus: (event: FocusEvent) => {
      const article = find(event.target);
      if (article) prefetch(session, article);
    },
  };
}

const STEP = 72;

/**
 * How many cards to render. A long list renders in steps, one per frame, so
 * the first cards paint at once and no frame waits for the rest. A new list
 * starts again; a change to the same list keeps what is on screen.
 */
function useSteps(length: number, list: string, all: boolean, first: number) {
  const [limit, setLimit] = useState(first);
  const [current, setCurrent] = useState(list);
  if (current !== list) {
    setCurrent(list);
    setLimit(first);
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
  input,
}: {
  query: string;
  onQuery: (value: string) => void;
  input: RefObject<HTMLInputElement | null>;
}) {
  const status = useStatusText();
  const scrolled = useScrolled();
  return (
    <div className="bar" data-scrolled={scrolled || undefined}>
      <Link to="/" className="brand">
        <img src="/icon-64.png" alt="" />
        Arctic
      </Link>
      <StatusNote status={status} />
      <SearchField query={query} onQuery={onQuery} input={input} />
      <AddLinkButton />
      <AccountMenu />
    </div>
  );
}

function useScrolled() {
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
  // A site's cover has no picture in the reader to move into.
  const cover = card?.matches("[data-image]")
    ? card.querySelector<HTMLElement>(".cover")
    : null;
  const title = card?.querySelector<HTMLElement>(".card-title");
  cover?.style.setProperty("view-transition-name", "cover");
  title?.style.setProperty("view-transition-name", "title");
  marked = [cover, title].filter((element) => element != null);
}

const Card = memo(function Card({
  article,
  state,
  eager,
  kind = "card",
  reserved = false,
}: {
  article: Article;
  state: { from: string };
  /** One of the first cards on screen: its cover loads first. */
  eager: boolean;
  /**
   * A card of Cards and List, or of a magazine (docs/MAGAZINE.md): its lead,
   * a tile (a picture, or its site's cover), or a headline in a band.
   */
  kind?: "card" | "lead" | "tile" | "headline";
  /** A link saved here whose preview is on its way: it keeps a picture's place. */
  reserved?: boolean;
}) {
  const path = `/read/${article.id}`;
  // An article without a working image is a text card: its title and the
  // start of its description, with no stand-in cover. A magazine's tile
  // shows its site's cover instead, with the title set large.
  const [failed, setFailed] = useState(false);
  const image = failed ? undefined : article.image;
  // The picture's place, empty, while its preview loads (src/links.ts).
  const pictured = !!image || (reserved && !failed);
  const [fresh] = useState(() => isFresh(article.id));
  const magazine = kind !== "card";
  const siteCover = !pictured && (kind === "lead" || kind === "tile");
  return (
    <article
      className="card"
      data-id={article.id}
      data-read={article.read || undefined}
      data-copy={article.copy ? "" : undefined}
      data-image={pictured ? "" : undefined}
      data-fresh={fresh || undefined}
      data-kind={magazine ? kind : undefined}
      style={
        magazine
          ? ({ "--site-hue": siteHue(article.host) } as CSSProperties)
          : undefined
      }
    >
      {pictured && kind !== "headline" && (
        <Link
          to={path}
          state={state}
          viewTransition
          className="cover"
          tabIndex={-1}
          aria-hidden
          onClick={mark}
        >
          {image && (
            <Cover src={image} eager={eager} onFail={() => setFailed(true)} />
          )}
          {magazine && <Progress id={article.id} />}
        </Link>
      )}
      {siteCover && (
        <Link
          to={path}
          state={state}
          viewTransition
          className="cover site-cover"
          onClick={mark}
        >
          <span className="card-title">{article.title}</span>
          {article.subtitle && (
            <span className="site-quote">{article.subtitle}</span>
          )}
          <Progress id={article.id} />
        </Link>
      )}
      <div className="card-line">
        <Source article={article} />
        <CardMenuButton article={article} />
      </div>
      {!siteCover && (
        <Link
          to={path}
          state={state}
          viewTransition
          className="card-title"
          onClick={mark}
        >
          {article.title}
        </Link>
      )}
      {(kind === "lead" || (!pictured && kind === "card")) &&
        article.subtitle && (
        <p className="card-excerpt">{article.subtitle}</p>
      )}
    </article>
  );
});

type Cell =
  | { kind: "lead" | "tile"; article: Article; eager: boolean }
  | { kind: "band"; articles: Article[] };

/**
 * A magazine's cells, in the list's order (docs/MAGAZINE.md). A link with a
 * picture is a tile; the first one leads when `lead`. A run of links without
 * one first fills the row it starts in with site covers, then becomes a band
 * of headlines in whole rows when it fills two or more; the rest are site
 * covers. So every row of the grid is full, and a band's lines align.
 * Pictures in the first two rows, above any band, load first.
 */
function magazineCells(
  articles: Article[],
  columns: number,
  lead: boolean,
  /** Links whose picture is on its way count as pictures (src/links.ts). */
  reserved: ReadonlySet<string>,
) {
  const pictured = (article: Article | undefined) =>
    !!article && (!!article.image || reserved.has(article.id));
  const cells: Cell[] = [];
  let at = 0; // Cells already in the current row.
  let eager = 2 * columns;
  const tile = (article: Article) => {
    cells.push({ kind: "tile", article, eager: eager-- > 0 });
    at = (at + 1) % columns;
  };
  let index = 0;
  if (lead && pictured(articles[0])) {
    cells.push({ kind: "lead", article: articles[0], eager: true });
    index = 1;
  }
  while (index < articles.length) {
    if (pictured(articles[index])) {
      tile(articles[index++]!);
      continue;
    }
    let end = index;
    while (end < articles.length && !pictured(articles[end])) end++;
    while (index < end && at !== 0) tile(articles[index++]!);
    const rows = Math.floor((end - index) / columns);
    if (rows >= 2) {
      eager = 0;
      cells.push({
        kind: "band",
        articles: articles.slice(index, (index += rows * columns)),
      });
    }
    while (index < end) tile(articles[index++]!);
  }
  return cells;
}

/**
 * The magazine's columns, from the list's width (docs/MAGAZINE.md): one,
 * two from 600 px, so every iPad full screen has two, and three from
 * 1,240 px, a wide desktop window. Measured before the first paint, so the
 * grid never reflows into place.
 */
function useColumns() {
  const [columns, setColumns] = useState(1);
  const ref = useCallback((area: HTMLElement | null) => {
    if (!area) return;
    const measure = (width: number) =>
      setColumns(width >= 1240 ? 3 : width >= 600 ? 2 : 1);
    measure(area.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) =>
      measure(entry!.contentRect.width),
    );
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  return [ref, columns] as const;
}

/**
 * A hue for the site, from its name: the same on every visit and in every
 * theme. Publishers' icons cannot be read for their colour (no CORS).
 */
function siteHue(host: string) {
  let hash = 2166136261;
  for (let index = 0; index < host.length; index++)
    hash = Math.imul(hash ^ host.charCodeAt(index), 16777619);
  return (hash >>> 0) % 360;
}

/** How far this browser has read the article, along the picture's foot. */
function Progress({ id }: { id: string }) {
  const progress = useProgress(id);
  if (!progress) return null;
  return (
    <span
      className="progress-line"
      style={{ "--progress": progress } as CSSProperties}
    />
  );
}

function Source({ article }: { article: Article }) {
  return (
    <span className="source">
      <Favicon src={article.favicon} host={article.host} />
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

function Cover({
  src,
  eager,
  onFail,
}: {
  src: string;
  eager: boolean;
  onFail: () => void;
}) {
  return (
    <img
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
      // A cover already in memory shows at once; one from the network fades in.
      ref={(image) => {
        // A picture already in memory shows, or gives way, before paint.
        if (!image?.complete || !image.naturalWidth) return;
        if (isCover(image)) loaded(image);
        else onFail();
      }}
      onLoad={(event) => {
        if (isCover(event.currentTarget)) loaded(event.currentTarget);
        else onFail();
      }}
      onError={onFail}
    />
  );
}

/** A picture that arrived; a square or tall one shows whole in a magazine. */
function loaded(image: HTMLImageElement) {
  if (image.naturalWidth / image.naturalHeight < 1.6)
    image.dataset.shape = "upright";
  image.dataset.loaded = "";
}

/** The site's icon, or its initial in the same square, so lines align. */
function Favicon({ src, host }: { src?: string; host: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="favicon" aria-hidden>
        {host.charAt(0).toUpperCase()}
      </span>
    );
  return (
    <img
      className="favicon"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** Sync state that needs the reader's attention: offline, signed out, failing. */
function StatusNote({ status }: { status: SyncSummary }) {
  if (!status.attention) return null;
  return (
    <span className="status-note" title={status.detail}>
      {status.label}
    </span>
  );
}
