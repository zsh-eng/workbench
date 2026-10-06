import type { ReactNode } from "react";
import { FORMATS, STATES, TOPICS, type ContentState, type Format, type Topic } from "../../shared/schema";
import { count } from "../lib/format";
import { NO_TOPIC, type Counts, type Query } from "../lib/model";
import { Keyboard } from "./Icons";

export const FORMAT_LABEL: Record<Format, string> = {
  photo: "Photos",
  carousel: "Several media",
  video: "Videos",
  "video-preview": "Video previews",
  link: "Link previews",
  text: "Text only",
};

export const STATE_LABEL: Record<ContentState, string> = {
  truncated: "Text cut short",
  unverified: "Possibly incomplete",
  article: "X article previews",
  "missing-media": "Missing media",
  "topic-review": "Topics to review",
};

interface RailProps {
  query: Query;
  counts: Counts;
  taxonomy: Record<Topic, string[]>;
  onQuery: (change: Partial<Query>) => void;
  onInfo: () => void;
  onShortcuts: () => void;
  footer?: ReactNode;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Facet(props: { label: string; checked: boolean; count: number; onToggle: () => void; nested?: boolean }) {
  const { label, checked, onToggle, nested } = props;
  const empty = props.count === 0 && !checked;
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className={`facet${nested ? " facet--nested" : ""}`}
        onClick={onToggle}
        disabled={empty}
      >
        <span className="facet-box" aria-hidden="true" />
        <span className="facet-label">{label}</span>
        <span className="facet-count">{count(props.count)}</span>
      </button>
    </li>
  );
}

export function Rail({ query, counts, taxonomy, onQuery, onInfo, onShortcuts, footer }: RailProps) {
  const selectTopic = (topic: string) => {
    const topics = toggle(query.topics, topic);
    // Subtags only refine their own selected topic.
    const subtags = query.subtags.filter((s) => topics.includes(s.split(":")[0]));
    onQuery({ topics, subtags });
  };

  return (
    <nav className="rail" aria-label="Browse and filter">
      <ul className="rail-list" aria-label="Library">
        <li>
          <button
            type="button"
            className="view"
            aria-pressed={query.view === "all"}
            onClick={() => onQuery({ view: "all" })}
          >
            <span>All saved posts</span>
            <span className="facet-count">{count(counts.all)}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="view"
            aria-pressed={query.view === "favourites"}
            onClick={() => onQuery({ view: query.view === "favourites" ? "all" : "favourites" })}
          >
            <span>Favourites</span>
            <span className="facet-count">{count(counts.favourites)}</span>
          </button>
        </li>
      </ul>

      <div className="rail-group" role="group" aria-labelledby="rail-topics">
        <h2 className="eyebrow" id="rail-topics">
          Topics
        </h2>
        <ul className="rail-list">
          {TOPICS.map((topic, i) => {
            const on = query.topics.includes(topic);
            const subs = taxonomy[topic] ?? [];
            return (
              <FacetWithSubs key={topic} on={on}>
                <Facet label={topic} checked={on} count={counts.topics[i]} onToggle={() => selectTopic(topic)} />
                {on
                  ? [...new Set([...subs, ...extraSubtags(counts, topic, subs)])].map((sub) => {
                      const key = `${topic}:${sub}`;
                      return (
                        <Facet
                          key={key}
                          nested
                          label={sub.replace(/-/g, " ")}
                          checked={query.subtags.includes(key)}
                          count={counts.subtags.get(key) ?? 0}
                          onToggle={() => onQuery({ subtags: toggle(query.subtags, key) })}
                        />
                      );
                    })
                  : null}
              </FacetWithSubs>
            );
          })}
          <Facet
            label="No topic"
            checked={query.topics.includes(NO_TOPIC)}
            count={counts.topics[TOPICS.length]}
            onToggle={() => selectTopic(NO_TOPIC)}
          />
        </ul>
      </div>

      <div className="rail-group" role="group" aria-labelledby="rail-format">
        <h2 className="eyebrow" id="rail-format">
          Format
        </h2>
        <ul className="rail-list">
          {FORMATS.map((format, i) => (
            <Facet
              key={format}
              label={FORMAT_LABEL[format]}
              checked={query.formats.includes(format)}
              count={counts.formats[i]}
              onToggle={() => onQuery({ formats: toggle(query.formats, format) })}
            />
          ))}
        </ul>
      </div>

      <div className="rail-group" role="group" aria-labelledby="rail-state">
        <h2 className="eyebrow" id="rail-state">
          Archive status
        </h2>
        <ul className="rail-list">
          {STATES.map((state, i) => (
            <Facet
              key={state}
              label={STATE_LABEL[state]}
              checked={query.states.includes(state)}
              count={counts.states[i]}
              onToggle={() => onQuery({ states: toggle(query.states, state) })}
            />
          ))}
        </ul>
      </div>

      {footer}

      <div className="rail-foot">
        <button type="button" className="text-button" onClick={onInfo}>
          About this library
        </button>
        <button type="button" className="text-button" onClick={onShortcuts} aria-keyshortcuts="?">
          <Keyboard size={16} /> Shortcuts
        </button>
      </div>
    </nav>
  );
}

function FacetWithSubs({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? (
    <li className="facet-tree">
      <ul className="rail-list">{children}</ul>
    </li>
  ) : (
    <>{children}</>
  );
}

/** User-added subtags that are not in the taxonomy. */
function extraSubtags(counts: Counts, topic: string, known: string[]): string[] {
  const out: string[] = [];
  for (const key of counts.subtags.keys()) {
    const [t, sub] = key.split(":");
    if (t === topic && !known.includes(sub)) out.push(sub);
  }
  return out.sort();
}
