import { useBooks } from "@/hooks/use-book-loader";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DevicePair, type FrameMessage } from "./DeviceFrame";
import { Choice, ElementsLayout, ElementsSection } from "./ElementsLayout";
import { Foundations } from "./Foundations";
import { SPECIMENS, specimenSrc, type Specimen } from "./specimens";

const SECTIONS = [
  { id: "foundations", label: "Foundations" },
  ...SPECIMENS.map(({ id, label }) => ({ id, label })),
  { id: "reader", label: "Reader" },
  { id: "library", label: "Library" },
] as const;

const LIVE_APP_NOTE =
  "These frames run the whole app with this origin’s data. Run bun run dev:local-data to see your own library without touching production.";

/**
 * Elements: Reader parts in desktop and phone frames, side by side and live.
 * Specimens use sample data and a state picker; the Reader and Library rows
 * run the real app.
 */
export function ElementsPage() {
  return (
    <ElementsLayout page="elements" sections={SECTIONS}>
      <ElementsSection
        id="foundations"
        title="Foundations"
        description="Theme tokens and the type scale. Every colour comes from these variables."
      >
        <Foundations />
      </ElementsSection>
      {SPECIMENS.map((specimen) => (
        <SpecimenSection key={specimen.id} specimen={specimen} />
      ))}
      <ReaderSection />
      <ElementsSection
        id="library"
        title="Library"
        description={
          <>
            The Library as it ships. Compare it with new ideas on{" "}
            <Link
              to="/debug/elements/library"
              className="underline underline-offset-4"
            >
              Library ideas
            </Link>
            . {LIVE_APP_NOTE}
          </>
        }
      >
        <DevicePair src="/" title="Library" />
      </ElementsSection>
    </ElementsLayout>
  );
}

function SpecimenSection({ specimen }: { specimen: Specimen }) {
  const initial = specimen.states[0].id;
  const [message, setMessage] = useState<FrameMessage>({
    type: "elements:state",
    state: initial,
    nonce: 0,
  });
  return (
    <ElementsSection
      id={specimen.id}
      title={specimen.title}
      description={specimen.description}
      actions={
        <Choice
          label={`${specimen.title} state`}
          value={message.state}
          options={specimen.states}
          // Choosing the current state again replays it.
          onChange={(state) =>
            setMessage((value) => ({
              type: "elements:state",
              state,
              nonce: value.nonce + 1,
            }))
          }
        />
      }
    >
      <DevicePair
        src={specimenSrc(specimen.id, initial)}
        title={specimen.title}
        message={message}
      />
    </ElementsSection>
  );
}

function ReaderSection() {
  const books = useBooks().data ?? [];
  const [chosen, setChosen] = useState<string>();
  const bookId = chosen ?? books[0]?.id;
  return (
    <ElementsSection
      id="reader"
      title="Reader"
      description={`The real Reader for one book, with its notebook, highlights and prompts. ${LIVE_APP_NOTE}`}
      actions={
        books.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Book
            <select
              value={bookId}
              onChange={(event) => setChosen(event.target.value)}
              className="h-8 max-w-64 rounded-full border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      {bookId ? (
        <DevicePair
          key={bookId}
          src={`/reader/${bookId}`}
          title={`Reader, ${books.find((book) => book.id === bookId)?.title ?? "book"}`}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This origin has no books. Import one in the Library, or run bun run
          dev:local-data.
        </p>
      )}
    </ElementsSection>
  );
}
