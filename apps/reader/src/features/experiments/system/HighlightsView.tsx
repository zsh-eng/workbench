/**
 * Everything you kept, across books, in the same rows as the reader's Notes
 * panel. Choose a row to open the book at that passage.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeft } from "lucide-react";
import { useState } from "react";
import { initialLayout, type BookLayout } from "../data/walden-book";
import { TypographicCover } from "../primitives";
import { EntryRow } from "./EntryRow";
import { IconButton, MOTION, TextTabs } from "./ui";
import { entryPage, type Entry, type ShelfBook } from "./state";

export function HighlightsView({
  books,
  entries,
  layouts,
  narrow,
  sidebarHidden,
  onShowSidebar,
  onOpenEntry,
  onSaveNote,
  onDelete,
}: {
  books: ShelfBook[];
  entries: Entry[];
  layouts: Record<string, BookLayout>;
  narrow: boolean;
  sidebarHidden: boolean;
  onShowSidebar: () => void;
  onOpenEntry: (entry: Entry) => void;
  onSaveNote: (id: string, note: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const [kind, setKind] = useState<"all" | "highlight" | "note">("all");
  const groups = books
    .filter((book) => book.model)
    .map((book) => {
      const model = book.model!;
      const layout = layouts[book.id] ?? initialLayout(model);
      const items = entries
        .filter((entry) => entry.bookId === book.id && (kind === "all" || entry.kind === kind))
        .map((entry) => ({ entry, page: entryPage(entry, layout, model) }))
        .sort((a, b) => a.entry.daysAgo - b.entry.daysAgo || a.page - b.page);
      return { book, model, items };
    })
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.items[0].entry.daysAgo - b.items[0].entry.daysAgo);

  return (
    <div className="xp-scroll-quiet size-full overflow-y-auto overscroll-contain">
      <div className={cn("mx-auto max-w-[720px]", narrow ? "px-5 pt-5 pb-16" : "px-12 pt-12 pb-24")}>
        <header className="flex items-center gap-2">
          {sidebarHidden && (
            <IconButton label="Show sidebar ([)" onClick={onShowSidebar} className="-ml-2">
              <PanelLeft className="size-4" strokeWidth={1.6} />
            </IconButton>
          )}
          <h1 className="xp-serif text-[30px] leading-none tracking-[-0.01em]">Highlights</h1>
        </header>

        <TextTabs
          label="Show"
          value={kind}
          onChange={setKind}
          className={narrow ? "mt-7" : "mt-11"}
          options={[
            { value: "all", label: "All" },
            { value: "highlight", label: "Highlights" },
            { value: "note", label: "Your notes" },
          ]}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={kind}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: MOTION.enter }}
            exit={{ opacity: 0, transition: MOTION.exit }}
            className="mt-6"
          >
            {groups.length === 0 ? (
              <p className="py-20 text-center text-[13px] text-muted-foreground">Nothing here yet.</p>
            ) : (
              groups.map(({ book, model, items }) => (
                <section key={book.id} className="mb-10">
                  <div className="mb-1 flex items-center gap-3 px-3">
                    <TypographicCover book={book} compact className="h-[30px] w-5 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.14)]" />
                    <h2 className="xp-serif truncate text-[17px] leading-tight">{book.title}</h2>
                    <span className="ml-auto font-numeric text-[12px] text-muted-foreground tabular-nums">{items.length}</span>
                  </div>
                  {items.map(({ entry, page }) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      page={page}
                      meta={model.chapters[entry.chapter]?.title}
                      onOpen={() => onOpenEntry(entry)}
                      onSaveNote={(note) => onSaveNote(entry.id, note)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  ))}
                </section>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
