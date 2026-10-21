import { Popover } from "@base-ui/react/popover";
import {
  ALargeSmall,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronLeft,
  MoreHorizontal,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { cleanByline } from "./content";
import { edits, editLibrary, folders, minutes, type Article } from "./articles";
import { SIZES, getSettings, updateSettings } from "./settings";
import { AppearanceControls, ReadingControls } from "./SettingsPage";
import { useArticles, useRecords, useSession, useStatus } from "./state";
import { articleText, readyText, type Text } from "./text";
import { duration, readingSessions, useReadingClock } from "./reading";
import { NotesPanel, Passages } from "./Passages";
import { ArticleMenu, Tip, useActions } from "./ui";

export function Reader() {
  const { id = "" } = useParams();
  const article = useArticles().find((item) => item.id === id);
  const status = useStatus();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const back = () =>
    from && location.key !== "default" ? navigate(-1) : navigate(from ?? "/");

  // An open counts as a visit, as on the phone: read, and in History.
  const visited = useRef("");
  useEffect(() => {
    if (!article || visited.current === article.id) return;
    visited.current = article.id;
    editLibrary(session.arctic, article, edits.visit()).then(
      () => session.syncSoon(5000),
      () => {},
    );
  }, [article, session]);

  const title = article?.title;
  useEffect(() => {
    document.title = title ? `${title} – Arctic` : "Arctic";
    return () => {
      document.title = "Arctic";
    };
  }, [title]);

  if (!article)
    return (
      <>
        <ReaderBar onBack={back} from={from} />
        <div className="quiet-page">
          {status.phase === "loading" || status.phase === "syncing"
            ? "Opening the article…"
            : "This article is not in your library."}
        </div>
      </>
    );
  return <Page key={article.id} article={article} from={from} onBack={back} />;
}

function Page({
  article,
  from,
  onBack,
}: {
  article: Article;
  from?: string;
  onBack: () => void;
}) {
  const session = useSession();
  const actions = useActions();
  const location = useLocation();
  const file = article.copy?.file;
  const prose = useRef<HTMLDivElement>(null);
  // The Highlights page and the Notes panel open a passage.
  const [reveal, setReveal] = useState(() => {
    const passage = (location.state as { passage?: string } | null)?.passage;
    return passage ? { id: passage } : undefined;
  });
  // The route loader reads the text first, so it usually arrives with the page.
  const [body, setBody] = useState<Text | undefined>(() => readyText(article));
  // When the text starts with the cover image, the text's own copy (with its
  // caption) is the cover. A text that arrives late drops its copy instead, so
  // nothing moves.
  const [textCover] = useState(
    () => !!body && "html" in body && body.withoutLead !== undefined,
  );

  useEffect(() => {
    if (!file) return;
    let current = true;
    void articleText(session, article).then(
      (text) => current && text && setBody(text),
    );
    return () => {
      current = false;
    };
  }, [file, session, article]);

  const text = body?.file === file ? body : undefined;
  const leads = !!text && "html" in text && text.withoutLead !== undefined;
  const cover = !!article.image && !(textCover && leads);

  const readable = !!text && "html" in text;
  useReadingPosition(article.id, readable);
  useReadingClock(session, article.url, readable);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, [contenteditable], [role=menu], [role=dialog]",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "escape") onBack();
      else if (key === "f" && article.saved) void actions.favourite(article);
      else if (key === "e" && article.saved) {
        void actions.archive(article);
        if (!article.archived) onBack();
      } else if (key === "o")
        window.open(article.url, "_blank", "noopener,noreferrer");
      else if (key === "=" || key === "+" || key === "-") {
        const size = getSettings().size + (key === "-" ? -1 : 1);
        if (size < SIZES.min || size > SIZES.max) return;
        updateSettings({ size });
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const meta = [
    cleanByline(article.copy?.byline),
    article.copy && `${minutes(article.copy.words)} min read`,
    article.savedAt &&
      `Saved ${new Date(article.savedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year:
          new Date(article.savedAt).getFullYear() === new Date().getFullYear()
            ? undefined
            : "numeric",
      })}`,
  ].filter(Boolean);

  return (
    <>
      <ReaderBar
        onBack={onBack}
        from={from}
        article={article}
        onReveal={(id) => setReveal({ id })}
      />
      <article className="article">
        <a
          className="article-source"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {article.favicon && (
            <img src={article.favicon} alt="" referrerPolicy="no-referrer" />
          )}
          {article.host}
        </a>
        <h1 className="article-title" style={{ viewTransitionName: "title" }}>
          {article.title}
        </h1>
        {article.subtitle && <p className="dek">{article.subtitle}</p>}
        {meta.length > 0 && (
          <div className="byline">
            {meta.map((item, index) => (
              <span key={index}>
                {index > 0 && <span className="dot">· </span>}
                {item}
              </span>
            ))}
            <ReadFor url={article.url} />
          </div>
        )}
        {cover && (
          <figure className="hero" style={{ viewTransitionName: "cover" }}>
            <img
              src={article.image}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
            />
          </figure>
        )}
        {!file ? (
          <Missing article={article} />
        ) : !text ? null : "error" in text ? (
          <div className="missing">
            <p>{text.error}</p>
          </div>
        ) : (
          <div
            className="prose"
            ref={prose}
            dangerouslySetInnerHTML={{
              __html: cover ? (text.withoutLead ?? text.html) : text.html,
            }}
          />
        )}
        {(!file || (text && "html" in text)) && (
          <footer className="end">
            {article.saved ? (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  void actions.archive(article);
                  if (!article.archived) onBack();
                }}
              >
                {article.archived ? (
                  <ArchiveRestore size={17} />
                ) : (
                  <Archive size={17} />
                )}
                {article.archived ? "Move to Saved" : "Archive"}
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                onClick={() => void actions.save(article)}
              >
                Save to library
              </button>
            )}
            {article.saved && (
              <button
                type="button"
                className="button"
                aria-pressed={article.favourite}
                onClick={() => void actions.favourite(article)}
              >
                <Star
                  size={17}
                  fill={article.favourite ? "currentColor" : "none"}
                />
                Favourite
              </button>
            )}
            <a
              className="button quiet"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Original <ArrowUpRight size={16} />
            </a>
          </footer>
        )}
      </article>
      <Passages
        article={article}
        prose={prose}
        ready={readable}
        reveal={reveal}
      />
    </>
  );
}

/** Time spent on this article so far, on every device. */
function ReadFor({ url }: { url: string }) {
  const session = useSession();
  const revision = useRecords(session.reading);
  const seconds = useMemo(
    () =>
      readingSessions(session.reading)
        .filter((visit) => visit.articleURL === url)
        .reduce((sum, visit) => sum + visit.seconds, 0),
    // The revision changes with the records.
    [session, url, revision],
  );
  if (seconds < 30) return null;
  return (
    <span>
      <span className="dot">· </span>
      <Link to="/reading" className="read-for">
        Read for {duration(seconds)}
      </Link>
    </span>
  );
}

function Missing({ article }: { article: Article }) {
  return (
    <div className="missing">
      <p>
        <strong>The text of this article is not in your account yet.</strong>
        Read it at {article.host}. Arctic can keep a copy of a page you open in
        this browser, so the text is here next time.
      </p>
      <div className="actions">
        <a
          className="button"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read at {article.host} <ArrowUpRight size={16} />
        </a>
        <Link className="button quiet" to={`/copies?article=${article.id}`}>
          Keep a copy
        </Link>
      </div>
    </div>
  );
}

function ReaderBar({
  onBack,
  from,
  article,
  onReveal,
}: {
  onBack: () => void;
  from?: string;
  article?: Article;
  onReveal?: (id: string) => void;
}) {
  const actions = useActions();
  const bar = useRef<HTMLDivElement>(null);
  const label = useMemo(() => {
    const path = (from ?? "/").split("?")[0];
    if (path === "/reading") return "Reading";
    if (path === "/highlights") return "Highlights";
    return folders.find((folder) => folder.path === path)?.title ?? "Library";
  }, [from]);

  // The bar steps aside while reading down and returns on any upward scroll.
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = bar.current;
      if (!element) return;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      element.style.setProperty(
        "--progress",
        String(max > 0 ? Math.min(1, y / max) : 0),
      );
      element.toggleAttribute("data-scrolled", y > 4);
      if (Math.abs(y - last) > 6) {
        element.toggleAttribute("data-hidden", y > last && y > 160);
        last = y;
      }
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="bar reader-bar" ref={bar}>
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft size={20} />
        {label}
      </button>
      {article && (
        <div className="actions">
          {article.copy && onReveal && (
            <NotesPanel article={article} onReveal={onReveal} />
          )}
          <TypePanel />
          {article.saved && (
            <>
              <Tip
                label={
                  article.favourite ? "Remove from Favourites" : "Favourite"
                }
                keys="F"
              >
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Favourite"
                  aria-pressed={article.favourite}
                  onClick={() => void actions.favourite(article)}
                >
                  <Star size={19} />
                </button>
              </Tip>
              <Tip
                label={article.archived ? "Move to Saved" : "Archive"}
                keys="E"
              >
                <button
                  type="button"
                  className="icon-button"
                  aria-label={article.archived ? "Move to Saved" : "Archive"}
                  onClick={() => {
                    void actions.archive(article);
                    if (!article.archived) onBack();
                  }}
                >
                  {article.archived ? (
                    <ArchiveRestore size={19} />
                  ) : (
                    <Archive size={19} />
                  )}
                </button>
              </Tip>
            </>
          )}
          <Tip label="Open original" keys="O">
            <a
              className="icon-button"
              aria-label="Open original"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ArrowUpRight size={19} />
            </a>
          </Tip>
          <ArticleMenu
            article={article}
            onRemoved={onBack}
            trigger={
              <button type="button" className="icon-button" aria-label="More">
                <MoreHorizontal size={19} />
              </button>
            }
          />
        </div>
      )}
      <div className="progress" />
    </div>
  );
}

/** Font, size, spacing, width and theme, as in the Settings page. */
function TypePanel() {
  return (
    <Popover.Root>
      <Tip label="Text and theme" keys="− +">
        <Popover.Trigger
          render={
            <button
              type="button"
              className="icon-button"
              aria-label="Text and theme"
            >
              <ALargeSmall size={20} />
            </button>
          }
        />
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="menu type-panel">
            <ReadingControls />
            <AppearanceControls />
            <Link className="panel-link" to="/settings">
              All settings
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Reopening an article returns to the same place, in this browser. */
function useReadingPosition(id: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const key = `arctic:position:${id}`;
    const saved = Number(localStorage.getItem(key));
    const height = () =>
      document.documentElement.scrollHeight - window.innerHeight;
    if (saved > 0.02 && saved < 0.98)
      window.scrollTo({ top: saved * height() });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const max = height();
      if (max <= 0) return;
      try {
        localStorage.setItem(
          key,
          String(Math.round((window.scrollY / max) * 1000) / 1000),
        );
      } catch {
        /* Storage is full or blocked; position is a convenience. */
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [id, ready]);
}
