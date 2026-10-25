import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { duration, readingSessions, readingStats } from "./reading";
import { useArticles, useDerived, useSession } from "./state";
import { PageBar, usePageTitle } from "./ui";

/** Reading time from every device, as the phone's Reading stats show it. */
export function ReadingPage() {
  const sessions = useDerived(useSession().reading, readingSessions);
  const articles = useArticles();
  const stats = useMemo(() => readingStats(sessions), [sessions]);
  const [selected, setSelected] = useState(6);
  const day = stats.days[selected]!;
  const most = Math.max(...stats.days.map((item) => item.seconds));
  const byURL = useMemo(
    () => new Map(articles.map((article) => [article.url, article])),
    [articles],
  );
  usePageTitle("Reading");

  return (
    <>
      <PageBar />
      <main className="page reading">
        <h1>Reading</h1>
        <p>Time spent reading articles, from each device that counts it.</p>

        <section className="week" aria-label="Last 7 days">
          <div className="week-label">Last 7 days</div>
          <div className="week-total">{duration(stats.week)}</div>
          <div className="days">
            {stats.days.map((item, index) => (
              <button
                key={item.date.getTime()}
                type="button"
                className="day"
                aria-pressed={index === selected}
                aria-label={`${item.date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}: ${duration(item.seconds)}`}
                onClick={() => setSelected(index)}
              >
                <span
                  className="day-bar"
                  data-empty={item.seconds === 0 || undefined}
                  style={{
                    height:
                      item.seconds > 0 && most > 0
                        ? `${24 + (72 * item.seconds) / most}px`
                        : undefined,
                  }}
                />
                <span className="day-name">
                  {item.date.toLocaleDateString(undefined, {
                    weekday: "narrow",
                  })}
                </span>
              </button>
            ))}
          </div>
          <div className="day-detail">
            {day.date.toLocaleDateString(undefined, { weekday: "long" })} ·{" "}
            <strong>{duration(day.seconds)}</strong>
          </div>
        </section>

        <dl className="metrics">
          <div>
            <dt>Today</dt>
            <dd>{duration(stats.days[6]!.seconds)}</dd>
          </div>
          <div>
            <dt>Articles</dt>
            <dd>{stats.articles}</dd>
          </div>
          <div>
            <dt>All time</dt>
            <dd>{duration(stats.total)}</dd>
          </div>
        </dl>

        {stats.byArticle.length > 0 ? (
          <section className="section">
            <h2>This week</h2>
            <ul className="rows read-rows">
              {stats.byArticle.slice(0, 20).map(([url, seconds]) => {
                const article = byURL.get(url);
                return (
                  <li key={url}>
                    {article ? (
                      <Link
                        to={`/read/${article.id}`}
                        state={{ from: "/reading" }}
                      >
                        {article.title}
                      </Link>
                    ) : (
                      <span>{url}</span>
                    )}
                    <span>{duration(seconds)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="quiet-note">Make time for a good read.</p>
        )}
        <p className="footnote">
          Arctic counts time while an article with text is open and you scroll,
          type or move the pointer. A pause over two minutes counts for nothing.
          A visit belongs to the day it started; an article counts after a
          minute of reading in the last seven days.
        </p>
      </main>
    </>
  );
}
