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
import { IDEA_TOPICS, isIdeaTopic, type IdeaTopic } from "./idea-topics";

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
        id: "paper-leaf",
        title: "A leaf you can hold",
        description:
          "Take the page anywhere and the paper under your finger stays under it: pull a corner and it folds on the diagonal, the middle of the edge and it rolls straight. Hold it part way, let go short of half way and it falls back; past it, or with a flick, it falls over. Draw the last page back from anywhere and it comes by its edge, the fold across your pull. The leaf shows its cut edge, the unread pages' edges narrow at the right as you read, and highlights are ink in the fine tooth.",
        src: (bookId) =>
          `/reader/${bookId}?turn=curl&paper=fine&ink=in&grip=anywhere&marks=marker&block=on`,
      },
      {
        id: "paper-edge-grip",
        title: "Held at the edge",
        description:
          "The same leaf held as before: the fore-edge runs ahead of your finger round a roll that tilts only near a corner. Compare a corner pull with the leaf held anywhere.",
        src: (bookId) =>
          `/reader/${bookId}?turn=curl&paper=fine&ink=in&grip=edge&marks=marker&block=on`,
      },
      {
        id: "paper-flat-marks",
        title: "Today's highlights on paper",
        description:
          "The leaf with the app's own highlight fill, a box of colour behind the words, to judge what the pigment adds.",
        src: (bookId) =>
          `/reader/${bookId}?turn=curl&paper=fine&ink=in&grip=anywhere&marks=flat&block=on`,
      },
      {
        id: "paper-curl-v1",
        title: "The first curl",
        description:
          "The curl before: a cylinder drawn along your finger, with a glossy roll and the grain under the text. Keep it beside the leaf to compare.",
        src: (bookId) => `/reader/${bookId}?turn=curl-v1&paper=fine&ink=on`,
      },
      {
        id: "paper-ink",
        title: "Ink drawn into the paper",
        description:
          "The leaf, with the text drawn by WebGL into the grain: ink wicks a little along the fibres and thins on the tooth. The live text stays underneath, clear, so selection works.",
        src: (bookId) => `/reader/${bookId}?turn=curl&paper=fine&ink=gl`,
      },
      {
        id: "paper-laid",
        title: "Laid paper",
        description:
          "The leaf on a fuller sheet: tooth, a faint cloudy formation, a few wisps of fibre and a soft vignette. Warmest on Flexoki light, quietest at Night.",
        src: (bookId) => `/reader/${bookId}?turn=curl&paper=rich&ink=in`,
      },
      {
        id: "paper-plain-curl",
        title: "Leaf alone",
        description:
          "The leaf with no grain, no book around it and an opaque back, to judge what the paper, the book and the show-through add.",
        src: (bookId) =>
          `/reader/${bookId}?turn=curl&paper=off&showThrough=off&block=off`,
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
  arriving: {
    current: {
      id: "arriving-today",
      title: "Today",
      description:
        "What ships: nothing shows while a file is read. One book then gets a toast with Open book; several appear one by one as each is done. The buttons at the top run one book, one already added, five, or a slow, a failed and a duplicate one; tap the chosen one again to replay.",
      src: "/debug/ideas/arriving-books?look=today&state=one",
    },
    ideas: [
      {
        id: "arriving-sheet",
        title: "One book: arrival sheet",
        description:
          "The recommendation for one book. A sheet at the medium detent shows it large: the cover spreads in as ink, in step with the import, then the title, the author, its chapters and Read now. Close the sheet and the cover comes down into its place in the grid; closed early, the book goes on arriving there in raking light. One already added shows the copy you have, with Read now.",
        src: "/debug/ideas/arriving-books?look=light&state=one",
      },
      {
        id: "arriving-light",
        title: "Several books: raking light",
        description:
          "The recommendation for a batch, with no sheet. Every book holds its place at once, as paper. A low lamp crosses each cover from the spine as the book is prepared, and the colour returns where it has been. On a printed cover the light finds the board's tooth and a passing sheen; on a living cover, its hand-made relief. In the real Library: Settings → Debug tools → Try on this device → Arriving books.",
        src: "/debug/ideas/arriving-books?look=light&state=five",
      },
      {
        id: "arriving-develop",
        title: "Develop",
        description:
          "Each cover develops like a print, shadows first through a fine grain, and the colour comes in over the black and white as the book is written. It follows the real steps and never runs ahead of them.",
        src: "/debug/ideas/arriving-books?look=develop&state=five",
      },
      {
        id: "arriving-ink",
        title: "Ink in the grid",
        description:
          "The sheet's ink on every cover of a batch: three drops near the top bloom down in soft lobes along the fibres, deep while wet, with a faint tide line, and dry to the cover's own colour.",
        src: "/debug/ideas/arriving-books?look=ink&state=five",
      },
      {
        id: "arriving-calm",
        title: "Calm (CSS)",
        description:
          "No shader: the black and white cover fades up when it is found, its colour when it is ready. What weak devices and an over-budget frame fall back to.",
        src: "/debug/ideas/arriving-books?look=calm&state=five",
      },
      {
        id: "arriving-still",
        title: "Reduced motion",
        description:
          "With Reduce Motion on: places held as paper, and each cover appears in one short cross-fade when its book is ready. The sheet's cover does the same, and closing it moves nothing.",
        src: "/debug/ideas/arriving-books?look=still&state=five",
      },
    ],
  },
  installing: {
    current: {
      id: "install-today",
      title: "Today",
      description:
        "What shipped before: nothing. Installing was up to you, through Safari's menus, and launch showed a blank screen in the background colour.",
      src: "/",
    },
    ideas: [
      {
        id: "install-list",
        title: "Steps",
        description:
          "The recommendation, wired in the real app. One row per tap, each beside the control as Safari draws it: Page Menu, Share, View More, Add to Home Screen, Add. The sheet stays open while you tap through Safari's toolbar. It opens by itself once, in the Library at a calm moment after your first book or on a second visit, and always from Account → Install Reader or Settings.",
        src: "/debug/ideas/installing?variant=list",
      },
      {
        id: "install-walkthrough",
        title: "Walkthrough",
        description:
          "Safari's own screens, one step at a time: the menu grows out of the Page Menu, the share sheet rises, View More unfolds, Add to Home Screen rises over it. Tap Next and Back.",
        src: "/debug/ideas/installing?variant=walkthrough",
      },
      {
        id: "install-sentence",
        title: "One sentence",
        description:
          "The taps as one sentence, each control inline beside its name: the smallest sheet.",
        src: "/debug/ideas/installing?variant=sentence",
      },
      {
        id: "install-ios26",
        title: "Steps on iOS 26",
        description:
          "The same steps where iOS 26 Safari puts Share behind ⋯ beside the address bar, not in the Page Menu.",
        src: "/debug/ideas/installing?variant=list&ios=26",
      },
      {
        id: "install-books",
        title: "Books added in Safari",
        description:
          "An installed app keeps its own library on iPhone. When you have books and no account, the sheet says how to bring them.",
        src: "/debug/ideas/installing?variant=list&books=1",
      },
      {
        id: "install-chrome",
        title: "Chrome and Edge",
        description:
          "Chromium installs with its own dialog, so the sheet is one Install button. Once installed, the button says so in place and the sheet closes. Here Install answers after a moment, where Chrome shows its dialog.",
        src: "/debug/ideas/installing?platform=chromium",
      },
      {
        id: "install-other-browser",
        title: "Another iPhone browser",
        description:
          "Chrome, Firefox or an app's own browser on iPhone: open the page in Safari to install, with Copy link. Chrome and Edge can also add it from their Share menu.",
        src: "/debug/ideas/installing?platform=ios-other",
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
  background: {
    current: {
      id: "background-current",
      title: "Covers with a glyph",
      description:
        "The choice, in the real Library. A glyph opens the activity sheet (before Search, or beside Sort and layout on a phone), for everyone. Covers that fill as their books download are behind Settings → Debug tools → Try on this device → Offline downloads: turn the switch on, then Sort and layout → Download all for offline.",
      src: "/",
    },
    ideas: [
      {
        id: "background-together",
        title: "Covers and a sheet",
        description:
          "The choice on simulated downloads. Tap Download 5, then the glyph: each row has its book's cover, finishes where it is, and nothing moves while the sheet is open. Open it again and the finished books are under Done.",
        src: "/debug/ideas/background?idea=together",
      },
      {
        id: "background-covers",
        title: "On the covers",
        description:
          "Progress lives on each book's cover; one and two ticks for changes made offline; offline, books not on this device fade; the update is a chip in the header. A download scrolled off screen has no place to show, which is why the choice adds the glyph. Use the Try row.",
        src: "/debug/ideas/background?idea=covers",
      },
      {
        id: "background-glyph",
        title: "A glyph and a sheet",
        description:
          "Nothing on the covers. A glyph beside the account shows only while work you asked for runs or something needs you, the update included; tap for the activity sheet.",
        src: "/debug/ideas/background?idea=glyph",
      },
    ],
  },
  sync: {
    current: {
      id: "sync-sections",
      title: "Now, then Recent",
      description:
        "The choice, shipped as Account → Activity. Now lists the background jobs as the glyph's sheet does; Recent puts lost edits and what still waits first, then what came from each device and what this device sent, newest first, by day. Three seconds in, the iPhone sends one more highlight: its row says so in place, and nothing moves.",
      src: "/debug/ideas/sync-history?variant=sections",
    },
    ideas: [
      {
        id: "sync-timeline",
        title: "One timeline",
        description:
          "Everything by time: a lost edit sits where it happened, among the groups, so the list reads as a log. Easier to follow, easier to miss a lost edit from this morning under the afternoon's syncs.",
        src: "/debug/ideas/sync-history?variant=timeline",
      },
      {
        id: "sync-devices",
        title: "By device",
        description:
          "One row per device with the last changes this device has from it, and what this device last sent. Answers \"did my iPad's notes arrive?\" at a glance, and loses the older groups. Devices shows the same list behind Debug.",
        src: "/debug/ideas/sync-history?variant=devices",
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
  // A link without a topic opens the newest.
  const topic: IdeaTopic = isIdeaTopic(topicParam)
    ? topicParam
    : IDEA_TOPICS[0].id;
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
