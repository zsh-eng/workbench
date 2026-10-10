import { useState } from "react";
import {
  DEVICES,
  DeviceFrame,
  useRowScale,
  type DeviceId,
} from "./DeviceFrame";
import { Choice, ElementsLayout, ElementsSection } from "./ElementsLayout";

interface LibraryIdea {
  id: string;
  title: string;
  description: string;
  src: string;
}

/** The Library as it ships, then each idea. Add an idea with a route that
 * renders it full-window, and it joins the comparison. */
const CURRENT: LibraryIdea = {
  id: "current",
  title: "Current Library",
  description: "What ships today: Continue reading, then all books.",
  src: "/",
};

const IDEAS: LibraryIdea[] = [
  {
    id: "system",
    title: "The System",
    description:
      "Library, app sidebar and reader panel designed as one product. Books in progress come first as covers with a line of progress; the rest is a quiet grid.",
    src: "/debug/experiments/system",
  },
];

const SECTIONS = [
  { id: "compare", label: "Compare" },
  { id: "notes", label: "Notes" },
] as const;

const NOTES_KEY = "reader-library-idea-notes";

function readNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

type View = "desktop" | "phone" | "both";

/**
 * Library ideas next to the current Library, at the same size and theme. The
 * frames run the real app, so with dev:local-data both sides show your books.
 */
export function LibraryIdeasPage() {
  const [ideaId, setIdeaId] = useState(IDEAS[0].id);
  const [view, setView] = useState<View>("desktop");
  const [notes, setNotes] = useState(readNotes);
  const idea = IDEAS.find((item) => item.id === ideaId) ?? IDEAS[0];
  const rows: DeviceId[] = view === "both" ? ["desktop", "phone"] : [view];

  return (
    <ElementsLayout page="library" sections={SECTIONS}>
      <ElementsSection
        id="compare"
        title="Compare"
        description="The current Library on the left, an idea on the right. Both are live; scroll, open books and change sorting in either."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {IDEAS.length > 1 && (
              <Choice
                label="Idea"
                value={ideaId}
                options={IDEAS.map(({ id, title }) => ({ id, label: title }))}
                onChange={setIdeaId}
              />
            )}
            <Choice
              label="Devices"
              value={view}
              options={[
                { id: "desktop", label: "Desktop" },
                { id: "phone", label: "Phone" },
                { id: "both", label: "Both" },
              ]}
              onChange={setView}
            />
          </div>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-6">
          {[CURRENT, idea].map((item) => (
            <div key={item.id}>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-8">
          {rows.map((device) => (
            <ComparisonRow
              key={device}
              device={device}
              left={CURRENT}
              right={idea}
            />
          ))}
        </div>
      </ElementsSection>
      <ElementsSection
        id="notes"
        title="Notes"
        description="What works and what does not, kept in this browser only."
      >
        <div className="grid grid-cols-2 gap-6">
          {[CURRENT, ...IDEAS].map((item) => (
            <label key={item.id} className="block">
              <span className="text-sm font-medium">{item.title}</span>
              <textarea
                value={notes[item.id] ?? ""}
                onChange={(event) => {
                  const next = { ...notes, [item.id]: event.target.value };
                  setNotes(next);
                  try {
                    localStorage.setItem(NOTES_KEY, JSON.stringify(next));
                  } catch {
                    // A blocked store keeps the note for this visit only.
                  }
                }}
                rows={5}
                placeholder="Keep, change, or drop…"
                className="mt-2 block w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
          ))}
        </div>
      </ElementsSection>
    </ElementsLayout>
  );
}

/** The same device for both sides, at one scale, so sizes compare fairly. */
function ComparisonRow({
  device,
  left,
  right,
}: {
  device: DeviceId;
  left: LibraryIdea;
  right: LibraryIdea;
}) {
  const { row, scale } = useRowScale([device, device]);
  return (
    <div
      ref={row}
      className="grid grid-cols-2 items-start gap-6"
      style={{ minWidth: 0 }}
    >
      {[left, right].map((item) => (
        <div
          key={item.id}
          className={device === "phone" ? "flex justify-center" : undefined}
        >
          <DeviceFrame
            device={device}
            src={item.src}
            title={`${item.title}, ${DEVICES[device].label.toLowerCase()}`}
            scale={scale}
          />
        </div>
      ))}
    </div>
  );
}
