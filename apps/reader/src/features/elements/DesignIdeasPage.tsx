import { useState } from "react";
import { useParams } from "react-router-dom";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import {
  DEVICES,
  DeviceFrame,
  useRowScale,
  type DeviceId,
} from "./DeviceFrame";
import { Choice, ElementsLayout, ElementsSection } from "./ElementsLayout";
import { isIdeaTopic, type IdeaTopic } from "./idea-topics";

interface Idea {
  id: string;
  title: string;
  description: string;
  /** A route, or one built from the book you read last. */
  src: string | ((bookId: string) => string);
}

interface TopicIdeas {
  /** What ships today. */
  current: Idea;
  ideas: Idea[];
}

/**
 * Each part of the app as it ships, then its ideas. Add an idea with a
 * route that renders it full-window, and it joins the comparison.
 */
const TOPICS: Record<IdeaTopic, TopicIdeas> = {
  library: {
    current: {
      id: "current",
      title: "Current Library",
      description:
        "What ships today: the Reading shelf, then every other book.",
      src: "/",
    },
    ideas: [
      {
        id: "system-header",
        title: "The System, no sidebar",
        description:
          "The prototype the Library came from. The page titles are the navigation; search, /, or typing narrows the page in place.",
        src: "/debug/experiments/system?nav=header",
      },
      {
        id: "system",
        title: "The System, sidebar",
        description:
          "The same page with a sidebar that stays in the library and floats while reading.",
        src: "/debug/experiments/system?nav=sidebar",
      },
    ],
  },
  reader: {
    current: {
      id: "reader-current",
      title: "Current Reader header",
      description:
        "What ships today: Library, the title in small capitals, and one button for every tool.",
      src: (bookId) => `/reader/${bookId}`,
    },
    ideas: [
      {
        id: "reader-split",
        title: "Aa and Contents",
        description:
          "Appearance and Contents get their own controls, as in the System prototype. The chapter follows the title. On a phone, Aa sits beside the menu.",
        src: (bookId) => `/reader/${bookId}?header=split`,
      },
    ],
  },
  sessions: {
    current: {
      id: "sessions-current",
      title: "Current Sessions",
      description:
        "What ships today: a dashboard of cards, a teal chart, and a row of month chips.",
      src: "/reading-sessions",
    },
    ideas: [
      {
        id: "sessions-quiet",
        title: "In the Library's frame",
        description:
          "The period as text with a stepper, the totals set large, a chart in the text colour, then your books and recent visits. No cards.",
        src: "/debug/ideas/sessions",
      },
    ],
  },
};

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
 * Ideas next to what ships, at the same size and theme. The frames run the
 * real app, so with dev:local-data both sides show your books.
 */
export function DesignIdeasPage() {
  const { topic: topicParam } = useParams();
  const topic: IdeaTopic = isIdeaTopic(topicParam) ? topicParam : "library";
  return <TopicPage key={topic} topic={topic} />;
}

function TopicPage({ topic }: { topic: IdeaTopic }) {
  const { current: CURRENT, ideas: IDEAS } = TOPICS[topic];
  // Reader ideas open the book you read last, or any book.
  const { data } = useBooksWithStatuses();
  const bookId =
    data?.categorized.continueReading[0]?.id ?? data?.books[0]?.id ?? null;
  const needsBook = [CURRENT, ...IDEAS].some(
    (item) => typeof item.src === "function",
  );
  const [ideaId, setIdeaId] = useState(IDEAS[0].id);
  const [view, setView] = useState<View>("desktop");
  const [notes, setNotes] = useState(readNotes);
  const idea = IDEAS.find((item) => item.id === ideaId) ?? IDEAS[0];
  const rows: DeviceId[] = view === "both" ? ["desktop", "phone"] : [view];

  return (
    <ElementsLayout page={topic} sections={SECTIONS}>
      <ElementsSection
        id="compare"
        title="Compare"
        description="What ships on the left, an idea on the right. Both are live: scroll, search and open books in either."
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
        {needsBook && !bookId ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {data ? "Add a book to compare the Reader." : "Loading your books…"}
          </p>
        ) : (
          <div className="space-y-8">
            {rows.map((device) => (
              <ComparisonRow
                key={device}
                device={device}
                left={CURRENT}
                right={idea}
                bookId={bookId ?? ""}
              />
            ))}
          </div>
        )}
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
  bookId,
}: {
  device: DeviceId;
  left: Idea;
  right: Idea;
  bookId: string;
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
            src={typeof item.src === "function" ? item.src(bookId) : item.src}
            title={`${item.title}, ${DEVICES[device].label.toLowerCase()}`}
            scale={scale}
          />
        </div>
      ))}
    </div>
  );
}
