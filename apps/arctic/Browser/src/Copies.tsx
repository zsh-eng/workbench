import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readCopyFile } from "./content";
import { MIN_WORDS, articleFinder, better, saveCopy } from "./copy";
import { extractPage } from "./extract";
import type { Article } from "./articles";
import { localID } from "./links";
import { useArticles, useSession } from "./state";
import { PageBar } from "./ui";

type PageMessage = { type: "arctic:page"; url: string; html: string };
const isPage = (data: unknown): data is PageMessage =>
  !!data &&
  typeof data === "object" &&
  (data as PageMessage).type === "arctic:page" &&
  typeof (data as PageMessage).html === "string" &&
  (data as PageMessage).html.length < 16 * 1024 * 1024 &&
  typeof (data as PageMessage).url === "string";

/** The bookmarklet sends the page it runs on to Arctic, as the reader sees it. */
const bookmarklet = (origin: string) =>
  `javascript:(()=>{const o=${JSON.stringify(origin)},m={type:"arctic:page",url:location.href,html:document.documentElement.outerHTML};if(window.opener){opener.postMessage(m,o);return}const w=open(o+"/copies?receive","arctic-receive","popup,width=520,height=380");if(!w){alert("Allow pop-ups to send this page to Arctic.");return}addEventListener("message",e=>{if(e.source===w&&e.data==="arctic:ready")w.postMessage(m,o)})})()`;

export function Copies() {
  const articles = useArticles();
  const [params] = useSearchParams();
  const saved = articles.filter((article) => article.saved);
  const withCopy = saved.filter((article) => article.copy).length;
  if (params.has("receive")) return <Receive articles={articles} />;
  return (
    <>
      <PageBar />
      <main className="page">
        <h1>Article text</h1>
        <p>
          Arctic keeps the text of an article in your account, so it reads here
          and offline. {withCopy.toLocaleString()} of{" "}
          {saved.length.toLocaleString()} saved articles have it.
        </p>
        <FromFiles articles={articles} />
        <FromBrowser articles={articles} only={params.get("article")} />
      </main>
    </>
  );
}

type Parsed = {
  name: string;
  copy: ReturnType<typeof readCopyFile>;
  native?: { body: string; byline?: string };
};
type Candidate = {
  name: string;
  article?: Article;
  body?: string;
  byline?: string;
  extracted?: boolean;
  status: "ready" | "unmatched" | "kept" | "saved" | "failed";
  note?: string;
};

function FromFiles({ articles }: { articles: Article[] }) {
  const session = useSession();
  const [files, setFiles] = useState<Parsed[]>([]);
  const [done, setDone] = useState(
    new Map<string, Pick<Candidate, "status" | "note">>(),
  );
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  // Matching follows the library, so files chosen before the first sync match after it.
  const items = useMemo(() => {
    const find = articleFinder(articles);
    const byNative = new Map(
      articles.map((article) => [localID(article.id), article]),
    );
    return files.map((file): Candidate => {
      // The phone's offline copies are named by article ID and hold #reader-content.
      const article =
        (file.copy && find(file.copy.url)) ||
        (file.native
          ? byNative.get(file.name.replace(/\.html?$/i, "").toUpperCase())
          : undefined);
      const source =
        file.copy && article && find(file.copy.url) === article
          ? file.copy
          : undefined;
      return {
        name: file.name,
        article,
        body: source?.body ?? file.native?.body,
        byline: source?.byline ?? file.native?.byline,
        extracted: source ? source.extracted : true,
        status: article ? "ready" : "unmatched",
        ...done.get(file.name),
      };
    });
  }, [articles, files, done]);

  async function choose(list: FileList | File[]) {
    const next: Parsed[] = [];
    for (const file of list) {
      if (!/\.html?$/i.test(file.name)) continue;
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, "text/html");
      const content = doc.querySelector("#reader-content");
      next.push({
        name: file.name,
        copy: readCopyFile(text),
        native: content
          ? {
              body: content.innerHTML,
              byline:
                doc.querySelector(".byline")?.textContent?.trim() || undefined,
            }
          : undefined,
      });
    }
    setDone(new Map());
    setFiles(next);
  }

  async function upload() {
    setBusy(true);
    for (const item of items) {
      if (item.status !== "ready" || !item.article || !item.body) continue;
      let result: Pick<Candidate, "status" | "note">;
      try {
        const page = item.extracted
          ? { body: item.body, byline: item.byline }
          : await extractPage(item.body, item.article.url);
        const words = await saveIfBetter(
          session,
          item.article,
          page.body,
          page.byline ?? item.byline,
          "file",
        );
        result = {
          status: words ? "saved" : "kept",
          note: words ? `${words.toLocaleString()} words` : "Has a longer copy",
        };
      } catch (error) {
        result = {
          status: "failed",
          note: error instanceof Error ? error.message : String(error),
        };
      }
      setDone((previous) => new Map(previous).set(item.name, result));
    }
    setBusy(false);
  }

  const ready = items.filter((item) => item.status === "ready").length;
  const unmatched = items.filter((item) => item.status === "unmatched").length;
  return (
    <section className="section">
      <h2>From files</h2>
      <p>
        Offline copies from Arctic on iPhone or Mac, pages saved with “Save Page
        As”, or files from the copies script. Each file must belong to an
        article in your library.
      </p>
      <div
        className="drop"
        data-over={over || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void choose(event.dataTransfer.files);
        }}
      >
        <div>
          <strong>Drop HTML files here</strong>
          <br />
          or{" "}
          <label>
            choose files
            <input
              type="file"
              accept=".html,.htm,text/html"
              multiple
              hidden
              onChange={(event) =>
                event.target.files && void choose(event.target.files)
              }
            />
          </label>
        </div>
      </div>
      {items.length > 0 && (
        <>
          <div className="row-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || ready === 0}
              onClick={() => void upload()}
            >
              {busy
                ? "Saving…"
                : `Save ${ready} ${ready === 1 ? "copy" : "copies"}`}
            </button>
            <span className="status-note">
              {unmatched > 0 &&
                `${unmatched} ${unmatched === 1 ? "file matches" : "files match"} no article.`}
            </span>
          </div>
          <ul className="rows">
            {items.map((item, index) => (
              <li key={index}>
                <span>{item.article?.title ?? item.name}</span>
                <span>{item.note ?? label(item.status)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const label = (status: Candidate["status"]) =>
  ({
    ready: "Ready",
    unmatched: "No article",
    kept: "Kept",
    saved: "Saved",
    failed: "Failed",
  })[status];

/** Returns the word count when saved, or 0 when the account has a longer copy. */
async function saveIfBetter(
  session: ReturnType<typeof useSession>,
  article: Article,
  body: string,
  byline: string | undefined,
  source: "file" | "browser",
) {
  const words =
    new DOMParser()
      .parseFromString(body, "text/html")
      .body.textContent?.split(/\s+/)
      .filter(Boolean).length ?? 0;
  if (!better(article, words)) return 0;
  return saveCopy(session, article, body, { byline, source });
}

type Result = { article: Article; note: string };

/**
 * Opens articles in a tab of this browser, one at a time. The bookmarklet,
 * run in that tab, sends the page back. A page that this browser can read,
 * such as one behind a login, is saved as this browser sees it.
 */
function FromBrowser({
  articles,
  only,
}: {
  articles: Article[];
  only: string | null;
}) {
  const session = useSession();
  const queue = useMemo(() => {
    const missing = articles
      .filter((article) => article.saved && !article.copy)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    const first = only
      ? articles.find((article) => article.id === only)
      : undefined;
    return first
      ? [first, ...missing.filter((article) => article.id !== first.id)]
      : missing;
  }, [articles, only]);
  const [current, setCurrent] = useState<Article>();
  const [results, setResults] = useState<Result[]>([]);
  const tab = useRef<Window | null>(null);
  const done = useRef(new Set<string>());
  const state = useRef({ current, queue });
  state.current = { current, queue };
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    link.current?.setAttribute("href", bookmarklet(location.origin));
  }, []);

  const advance = () => {
    const next = state.current.queue.find(
      (article) =>
        !done.current.has(article.id) &&
        article.id !== state.current.current?.id,
    );
    if (!next || !tab.current || tab.current.closed) {
      setCurrent(undefined);
      return;
    }
    setCurrent(next);
    tab.current.location.href = next.url;
  };

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const article = state.current.current;
      if (!article || event.source !== tab.current || !isPage(event.data))
        return;
      done.current.add(article.id);
      let note: string;
      try {
        const page = await extractPage(
          event.data.html,
          event.data.url || article.url,
        );
        const words = await saveIfBetter(
          session,
          article,
          page.body,
          page.byline,
          "browser",
        );
        note = words
          ? `Saved, ${words.toLocaleString()} words`
          : "Kept the longer copy";
      } catch (error) {
        note = error instanceof Error ? error.message : String(error);
      }
      setResults((previous) => [{ article, note }, ...previous].slice(0, 50));
      advance();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  const start = () => {
    const first = queue.find((article) => !done.current.has(article.id));
    if (!first) return;
    tab.current = window.open(first.url, "arctic-page");
    setCurrent(first);
  };
  const skip = () => {
    if (current) done.current.add(current.id);
    advance();
  };
  const stop = () => {
    tab.current?.close();
    tab.current = null;
    setCurrent(undefined);
  };

  return (
    <section className="section">
      <h2>From this browser</h2>
      <p>
        Arctic opens articles without text in a new tab, newest first. When a
        page shows the whole article, click <strong>Send to Arctic</strong> in
        your bookmarks bar. Arctic keeps the text and opens the next article.
      </p>
      <div className="row-actions">
        {current ? (
          <>
            <button type="button" className="button" onClick={skip}>
              Skip
            </button>
            <button type="button" className="button quiet" onClick={stop}>
              Stop
            </button>
            <span className="status-note">
              Waiting for {current.host}: {current.title}
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button primary"
              disabled={queue.length === 0}
              onClick={start}
            >
              {queue.length
                ? `Open ${queue.length.toLocaleString()} ${queue.length === 1 ? "article" : "articles"}`
                : "Every saved article has text"}
            </button>
            <a
              ref={link}
              className="bookmarklet"
              onClick={(event) => event.preventDefault()}
            >
              Send to Arctic
            </a>
            <span className="status-note">
              Drag this to your bookmarks bar.
            </span>
          </>
        )}
      </div>
      {results.length > 0 && (
        <ul className="rows">
          {results.map((result, index) => (
            <li key={index}>
              <span>{result.article.title}</span>
              <span>{result.note}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="status-note" style={{ marginTop: 18 }}>
        Pages shorter than {MIN_WORDS} words are not saved: they are usually
        previews or sign-in pages.
      </p>
    </section>
  );
}

/** A small window that the bookmarklet opens on any page; it saves that page's text. */
function Receive({ articles }: { articles: Article[] }) {
  const session = useSession();
  const [note, setNote] = useState("Waiting for the page…");
  const find = useMemo(() => articleFinder(articles), [articles]);
  const lookup = useRef(find);
  lookup.current = find;
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setNote("Open this from the Send to Arctic bookmark.");
      return;
    }
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== opener || !isPage(event.data)) return;
      window.removeEventListener("message", onMessage);
      const { html, url } = event.data;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const candidates = [
        url,
        doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      ].filter((value): value is string => !!value);
      const article = candidates
        .map((value) => lookup.current(value))
        .find(Boolean);
      if (!article) {
        setNote("This page is not in your library. Save it with Arctic first.");
        return;
      }
      try {
        const page = await extractPage(html, url);
        const words = await saveIfBetter(
          session,
          article,
          page.body,
          page.byline,
          "browser",
        );
        setNote(
          words
            ? `Saved “${article.title}”, ${words.toLocaleString()} words.`
            : "Your library has a longer copy.",
        );
        if (words) setTimeout(() => window.close(), 1800);
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener("message", onMessage);
    opener.postMessage("arctic:ready", "*");
    return () => window.removeEventListener("message", onMessage);
  }, [session]);
  return (
    <div className="quiet-page" style={{ animation: "none" }}>
      {note}
    </div>
  );
}
