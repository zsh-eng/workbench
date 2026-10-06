import { TOPICS } from "../../shared/schema";
import { count } from "../lib/format";
import { NO_TOPIC, type Query, type Sort } from "../lib/model";
import { CloseIcon } from "./Icons";
import { FORMAT_LABEL, STATE_LABEL } from "./Rail";

interface ResultBarProps {
  query: Query;
  shown: number;
  total: number;
  onQuery: (change: Partial<Query>) => void;
  onClear: () => void;
}

export interface Token {
  key: string;
  label: string;
  remove: Partial<Query>;
}

export function activeTokens(query: Query): Token[] {
  const tokens: Token[] = [];
  if (query.q.trim()) tokens.push({ key: "q", label: `“${query.q.trim()}”`, remove: { q: "" } });
  if (query.view === "favourites") tokens.push({ key: "fav", label: "Favourites", remove: { view: "all" } });
  for (const t of query.topics) {
    tokens.push({
      key: `t:${t}`,
      label: t === NO_TOPIC ? "No topic" : t,
      remove: { topics: query.topics.filter((x) => x !== t), subtags: query.subtags.filter((s) => !s.startsWith(`${t}:`)) },
    });
  }
  for (const s of query.subtags) {
    tokens.push({ key: `s:${s}`, label: s.split(":")[1].replace(/-/g, " "), remove: { subtags: query.subtags.filter((x) => x !== s) } });
  }
  for (const f of query.formats) tokens.push({ key: `f:${f}`, label: FORMAT_LABEL[f], remove: { formats: query.formats.filter((x) => x !== f) } });
  for (const s of query.states) tokens.push({ key: `st:${s}`, label: STATE_LABEL[s], remove: { states: query.states.filter((x) => x !== s) } });
  return tokens;
}

const SORT_LABEL: Record<Sort, string> = { saved: "Bookmark order", newest: "Newest posts", oldest: "Oldest posts" };

export function ResultBar({ query, shown, total, onQuery, onClear }: ResultBarProps) {
  const tokens = activeTokens(query);
  return (
    <div className="resultbar">
      <p className="result-count">
        <strong>{count(shown)}</strong>
        <span>{shown === total && !tokens.length ? " saved posts" : ` of ${count(total)}`}</span>
      </p>
      {tokens.length ? (
        <ul className="tokens" aria-label="Active filters">
          {tokens.map((t) => (
            <li key={t.key}>
              <button type="button" className="token" onClick={() => onQuery(t.remove)} aria-label={`Remove filter ${t.label}`}>
                <span>{t.label}</span>
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="text-button" onClick={onClear}>
              Clear all
            </button>
          </li>
        </ul>
      ) : null}
      <label className="sort">
        <span className="sr-only">Sort by</span>
        <select value={query.sort} onChange={(e) => onQuery({ sort: e.target.value as Sort })}>
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export const TOPIC_COUNT = TOPICS.length;
