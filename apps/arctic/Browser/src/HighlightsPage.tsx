import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Annotation } from "./annotations";
import { useAnnotations } from "./Passages";
import { useArticles } from "./state";
import { PageBar, usePageTitle } from "./ui";

/** Every highlight and note, by article, most recent first. */
export function HighlightsPage() {
  const annotations = useAnnotations();
  const articles = useArticles();
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const byURL = useMemo(
    () => new Map(articles.map((article) => [article.url, article])),
    [articles],
  );
  const groups = useMemo(() => {
    const groups = new Map<string, Annotation[]>();
    for (const item of annotations) {
      const article = byURL.get(item.articleURL);
      const text = `${item.quote?.exact ?? ""}\n${item.note}\n${article?.title ?? item.articleURL}`;
      if (search && !text.toLowerCase().includes(search)) continue;
      groups.set(item.articleURL, [
        ...(groups.get(item.articleURL) ?? []),
        item,
      ]);
    }
    return [...groups]
      .map(([url, items]) => ({
        url,
        article: byURL.get(url),
        items: items.sort(
          (a, b) => (a.quote?.start ?? -1) - (b.quote?.start ?? -1),
        ),
        latest: Math.max(...items.map((item) => item.updatedAt)),
      }))
      .sort((a, b) => b.latest - a.latest);
  }, [annotations, byURL, search]);
  usePageTitle("Highlights");

  return (
    <>
      <PageBar />
      <main className="page highlights">
        <h1>Highlights</h1>
        <p>
          {annotations.length === 0
            ? "Select text in an article to highlight it or add a note."
            : `${count(annotations.length, "passage or note", "passages and notes")} in ${count(new Set(annotations.map((item) => item.articleURL)).size, "article", "articles")}.`}
        </p>
        {annotations.length > 0 && (
          <label className="search page-search">
            <Search size={16} />
            <span className="visually-hidden">Search highlights</span>
            <input
              type="search"
              placeholder="Search highlights and notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {groups.map(({ url, article, items }) => (
          <section key={url} className="section highlight-list">
            <h2>
              {article ? (
                <Link
                  to={`/read/${article.id}`}
                  state={{ from: "/highlights" }}
                >
                  {article.title}
                </Link>
              ) : (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              )}
            </h2>
            {article && <div className="highlight-host">{article.host}</div>}
            <ol>
              {items.map((item) => (
                <li key={item.id}>
                  {item.quote && article ? (
                    <Link
                      to={`/read/${article.id}`}
                      state={{ from: "/highlights", passage: item.id }}
                    >
                      <Quote item={item} />
                    </Link>
                  ) : item.quote ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <Quote item={item} />
                    </a>
                  ) : (
                    <div className="article-note-label">
                      Note on the article
                    </div>
                  )}
                  {item.note && <p className="note">{item.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
    </>
  );
}

const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString()} ${value === 1 ? one : many}`;

function Quote({ item }: { item: Annotation }) {
  return (
    <blockquote
      data-colour={item.isHighlighted ? (item.colour ?? "yellow") : undefined}
    >
      {item.quote!.exact}
    </blockquote>
  );
}
