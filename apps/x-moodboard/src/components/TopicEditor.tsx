import { useId, useState, type KeyboardEvent } from "react";
import { TOPICS, type Topic, type UserEdit } from "../../shared/schema";

interface TopicEditorProps {
  taxonomy: Record<Topic, string[]>;
  topics: Topic[];
  subtags: Partial<Record<Topic, string[]>>;
  edited: boolean;
  onSave: (edit: Omit<UserEdit, "editedAt">) => void;
  onReset: () => void;
  onCancel: () => void;
}

export function TopicEditor({ taxonomy, topics, subtags, edited, onSave, onReset, onCancel }: TopicEditorProps) {
  const [chosen, setChosen] = useState<Topic[]>(topics);
  const [tags, setTags] = useState<Partial<Record<Topic, string[]>>>(subtags);
  const [draft, setDraft] = useState<Partial<Record<Topic, string>>>({});
  const id = useId();

  const toggleTopic = (topic: Topic) =>
    setChosen((list) => (list.includes(topic) ? list.filter((t) => t !== topic) : TOPICS.filter((t) => t === topic || list.includes(t))));
  const toggleTag = (topic: Topic, tag: string) =>
    setTags((all) => {
      const list = all[topic] ?? [];
      return { ...all, [topic]: list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag] };
    });
  const addTag = (topic: Topic) => {
    const tag = (draft[topic] ?? "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    if (!tag) return;
    setTags((all) => ({ ...all, [topic]: [...new Set([...(all[topic] ?? []), tag])] }));
    setDraft((d) => ({ ...d, [topic]: "" }));
  };

  const save = () => {
    const clean: Partial<Record<Topic, string[]>> = {};
    for (const t of chosen) if (tags[t]?.length) clean[t] = tags[t];
    onSave({ topics: chosen, subtags: clean });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="topic-editor" onKeyDown={onKeyDown}>
      <fieldset>
        <legend className="eyebrow">Topics</legend>
        {TOPICS.map((topic) => {
          const on = chosen.includes(topic);
          const options = [...new Set([...(taxonomy[topic] ?? []), ...(tags[topic] ?? [])])];
          return (
            <div key={topic} className="topic-editor-row">
              <label className="check">
                <input type="checkbox" checked={on} onChange={() => toggleTopic(topic)} />
                <span className="check-box" aria-hidden="true" />
                <span>{topic}</span>
              </label>
              {on ? (
                <div className="topic-editor-tags" role="group" aria-label={`${topic} subtags`}>
                  {options.map((tag) => (
                    <label key={tag} className="tag-toggle">
                      <input type="checkbox" checked={tags[topic]?.includes(tag) ?? false} onChange={() => toggleTag(topic, tag)} />
                      <span>{tag}</span>
                    </label>
                  ))}
                  <input
                    className="tag-input"
                    aria-label={`Add a ${topic} subtag`}
                    placeholder="Add tag"
                    id={`${id}-${topic}`}
                    value={draft[topic] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [topic]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(topic);
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <div className="topic-editor-actions">
        <button type="button" className="button button--primary" onClick={save}>
          Save topics
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        {edited ? (
          <button type="button" className="button button--quiet" onClick={onReset}>
            Restore archive topics
          </button>
        ) : null}
      </div>
    </div>
  );
}
