import { useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router-dom";
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
  search: {
    current: {
      id: "search-tint",
      title: "Tint and underline",
      description:
        "What ships: every match on the page tinted with the text colour, the one you are on darker and underlined. Searching “the” in the book you read last shows the busiest page.",
      src: (bookId) => `/reader/${bookId}?search=the&searchMarks=tint`,
    },
    ideas: [
      {
        id: "search-underline",
        title: "Underlines only",
        description:
          "Other matches get a thin underline instead of a tint, so they never look like your highlights. The one you are on stays tinted.",
        src: (bookId) => `/reader/${bookId}?search=the&searchMarks=underline`,
      },
      {
        id: "search-current",
        title: "Only the current match",
        description:
          "Nothing marks the other matches; the page stays quiet and the stepper says where the next one is.",
        src: (bookId) => `/reader/${bookId}?search=the&searchMarks=current`,
      },
    ],
  },
  fonts: {
    current: {
      id: "font-current",
      title: "Your font",
      description:
        "The book you read last, in the font you chose in Appearance → Type.",
      src: (bookId) => `/reader/${bookId}`,
    },
    ideas: [
      {
        id: "font-system",
        title: "System",
        description:
          "San Francisco, the face of Apple's own apps: optical sizes and tracking tuned for the screen, nothing to download. Off Apple devices it shows Source Sans.",
        src: (bookId) => `/reader/${bookId}?font=system`,
      },
      {
        id: "font-seravek",
        title: "Seravek",
        description:
          "The humanist sans of Apple Books, built into iOS and macOS: warm, open and a little narrow, so lines hold more words.",
        src: (bookId) => `/reader/${bookId}?font=seravek`,
      },
      {
        id: "font-source-sans",
        title: "Source Sans",
        description:
          "Adobe's open-source humanist sans, bundled so it looks the same everywhere and offline. Its small x-height reads best a size up.",
        src: (bookId) => `/reader/${bookId}?font=source-sans`,
      },
      {
        id: "font-atkinson",
        title: "Atkinson",
        description:
          "Atkinson Hyperlegible Next, from the Braille Institute: letters that never look alike, for small sizes and tired eyes.",
        src: (bookId) => `/reader/${bookId}?font=atkinson`,
      },
    ],
  },
  paper: {
    current: {
      id: "paper-slide",
      title: "Today's slide",
      description:
        "What ships: a swipe slides the next page in over this one, on a plain screen.",
      src: (bookId) => `/reader/${bookId}?turn=slide&paper=off`,
    },
    ideas: [
      {
        id: "paper-curl",
        title: "Curl on fine paper",
        description:
          "Drag from the right, or tap it: the page curls from where you hold it, low or high, and follows your finger. Its back shows the words faintly through the sheet, and the next page waits in its shadow. A fine tooth sits under the text.",
        src: (bookId) => `/reader/${bookId}?turn=curl&paper=fine`,
      },
      {
        id: "paper-laid",
        title: "Laid paper",
        description:
          "The same curl on a fuller sheet: tooth, a faint cloudy formation, a few wisps of fibre and a soft vignette. Warmest on Flexoki light, quietest at Night.",
        src: (bookId) => `/reader/${bookId}?turn=curl&paper=rich`,
      },
      {
        id: "paper-plain-curl",
        title: "Curl alone",
        description:
          "The curl with no grain and an opaque back, to judge what the paper and the show-through add.",
        src: (bookId) =>
          `/reader/${bookId}?turn=curl&paper=off&showThrough=off`,
      },
    ],
  },
  dark: {
    current: {
      id: "dark-current",
      title: "Today's dark colours",
      description:
        "What ships: the highlight fills on Dark, Night (true black) and Flexoki dark. Light comes first for the hues.",
      src: "/debug/ideas/dark-colours",
    },
    ideas: [
      {
        id: "dark-mixed",
        title: "Light hues on the dark page",
        description:
          "Each fill is the light theme's colour mixed into the page, so a yellow stays that yellow on every theme and darkens on true black.",
        src: "/debug/ideas/dark-colours?palette=mixed",
      },
      {
        id: "dark-quiet",
        title: "Quieter fills",
        description:
          "Today's fills pulled toward the page, so highlights recede when reading at night.",
        src: "/debug/ideas/dark-colours?palette=quiet",
      },
      {
        id: "night-bright",
        title: "Night with brighter text",
        description:
          "True black with text at 88% lightness instead of 78%, for when Night reads too dim. The fills stay as they are.",
        src: "/debug/ideas/dark-colours?night=bright",
      },
    ],
  },
  covers: {
    current: {
      id: "covers-current",
      title: "Today's covers",
      description: "What ships: each cover as a flat image with a soft shadow.",
      src: "/",
    },
    ideas: [
      {
        id: "covers-hero",
        title: "A book to hold",
        description:
          "One book as an object, lit from above. Tilt the phone or drag the book to turn it; foil catches the light and deep art moves behind the surface. Depth and Foil and life show the hand-made maps.",
        src: "/debug/ideas/living-covers?variant=hero",
      },
      {
        id: "covers-grid",
        title: "Library with tilt",
        description:
          "Your Library's covers, lit by one lamp in the room. Scroll and each cover catches the light as it passes; tilt for more. Books without a scene get the automatic sheen.",
        src: "/debug/ideas/living-covers?variant=grid",
      },
      {
        id: "covers-detail",
        title: "Book page",
        description:
          "A book's own page with its cover as the hero, above the title and a Read button.",
        src: "/debug/ideas/living-covers?variant=detail",
      },
    ],
  },
  sheets: {
    current: {
      id: "sheet-scroll",
      title: "Smooth scroll",
      description:
        "What shipped before: the browser's smooth scroll opens, closes and changes the detent, from a screen below. Tap Menu, then List, then Full height and Medium.",
      src: "/debug/ideas/sheet-motion?motion=scroll",
    },
    ideas: [
      {
        id: "sheet-uikit",
        title: "UIKit's spring",
        description:
          "What ships now: the spring measured from iOS sheets (response 0.344 s, no overshoot), from the bottom edge of the screen. A drag still uses the browser's own scrolling.",
        src: "/debug/ideas/sheet-motion?motion=uikit",
      },
      {
        id: "sheet-telegram",
        title: "Telegram's spring",
        description:
          "Telegram's iOS 26 curve: the same shape, a quarter quicker (response 0.267 s).",
        src: "/debug/ideas/sheet-motion?motion=telegram",
      },
    ],
  },
  feedback: {
    current: {
      id: "feedback-island",
      title: "The island takes it in",
      description:
        "What ships: a saved note's words fly into the island's mark and its check draws itself; Copy draws its check; a deleted note dissolves into Undo, and Undo turns into a check. Tap the green passage.",
      src: "/debug/ideas/feedback?idea=island",
    },
    ideas: [
      {
        id: "feedback-bubble",
        title: "Into the notes bubble",
        description:
          "No notice at all: the words fly into the notes bubble, which swells as its count rolls on.",
        src: "/debug/ideas/feedback?idea=bubble",
      },
      {
        id: "feedback-pill",
        title: "Out of the button",
        description:
          "A pill grows out of the button you tapped, says Copied or Saved, and folds back into it, as the Dynamic Island does.",
        src: "/debug/ideas/feedback?idea=pill",
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

const PHONE_QUERY = "(max-width: 767px)";

/**
 * True on a phone, from the first render. The desktop frames are wider than
 * a phone, and once they overflow, a phone browser widens the page to fit
 * them, so a width read after they render says desktop.
 */
function usePhoneWidth(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
  );
}

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
  const isMobile = usePhoneWidth();
  const [ideaId, setIdeaId] = useState(IDEAS[0].id);
  const [view, setView] = useState<View>("desktop");
  const [notes, setNotes] = useState(readNotes);
  const idea = IDEAS.find((item) => item.id === ideaId) ?? IDEAS[0];
  const rows: DeviceId[] = view === "both" ? ["desktop", "phone"] : [view];

  return (
    <ElementsLayout page={topic} sections={SECTIONS}>
      {isMobile ? (
        <ElementsSection
          id="compare"
          title="Compare"
          description="What ships, then each idea, at phone size. Each is live, or open it full screen."
        >
          {needsBook && !bookId ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {data
                ? "Add a book to compare the Reader."
                : "Loading your books…"}
            </p>
          ) : (
            <PhoneComparison
              items={[CURRENT, ...IDEAS]}
              bookId={bookId ?? ""}
            />
          )}
        </ElementsSection>
      ) : (
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
              {data
                ? "Add a book to compare the Reader."
                : "Loading your books…"}
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
      )}
      <ElementsSection
        id="notes"
        title="Notes"
        description="What works and what does not, kept in this browser only."
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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

function resolveSrc(item: Idea, bookId: string): string {
  return typeof item.src === "function" ? item.src(bookId) : item.src;
}

/**
 * On a phone, two frames side by side are too small to judge, so one shows
 * at a time at nearly full width. Open leaves for the page itself.
 */
function PhoneComparison({
  items,
  bookId,
}: {
  items: readonly Idea[];
  bookId: string;
}) {
  const [shownId, setShownId] = useState(items[0]!.id);
  const shown = items.find((item) => item.id === shownId) ?? items[0]!;
  const src = resolveSrc(shown, bookId);
  const { row, scale } = useRowScale(["phone"]);
  return (
    <div className="space-y-4">
      <Choice
        label="Show"
        value={shown.id}
        options={items.map(({ id, title }) => ({ id, label: title }))}
        onChange={setShownId}
      />
      <div>
        <h3 className="text-sm font-medium">{shown.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {shown.description}
        </p>
        <Link
          to={src}
          className="mt-2 inline-flex h-8 items-center rounded-full bg-secondary px-3 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open full screen
        </Link>
      </div>
      <div ref={row} className="flex justify-center">
        <DeviceFrame
          key={shown.id}
          device="phone"
          src={src}
          title={`${shown.title}, phone`}
          scale={scale}
        />
      </div>
    </div>
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
            src={resolveSrc(item, bookId)}
            title={`${item.title}, ${DEVICES[device].label.toLowerCase()}`}
            scale={scale}
          />
        </div>
      ))}
    </div>
  );
}
