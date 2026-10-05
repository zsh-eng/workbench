/**
 * One annotation, the same everywhere it appears: in the reader's Notes
 * panel, on the Highlights page and in search. The passage is in the book's
 * serif; your words are in the app's sans. Actions appear on hover.
 */
import { cn } from "@/lib/utils";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inkWash } from "../primitives";
import type { Entry } from "./state";

export function EntryRow({
  entry,
  page,
  meta,
  active = false,
  onOpen,
  onHover,
  onSaveNote,
  onDelete,
}: {
  entry: Entry;
  page: number;
  /** Shown after the page number, for example a chapter on the Highlights page. */
  meta?: string;
  active?: boolean;
  onOpen: () => void;
  onHover?: (id: string | null) => void;
  onSaveNote: (note: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    const text = [entry.text ? `“${entry.text}”` : null, entry.note].filter(Boolean).join("\n\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg px-3 py-2.5 transition-colors duration-150",
        active ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.025]",
      )}
      onPointerEnter={() => onHover?.(entry.id)}
      onPointerLeave={() => onHover?.(null)}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Go to page ${page}`}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative flex gap-3">
        <span
          aria-hidden="true"
          className="mt-[5px] w-[2px] shrink-0 self-stretch rounded-full"
          style={{ background: entry.color ? inkWash(entry.color) : "color-mix(in oklab, var(--foreground) 18%, transparent)" }}
        />
        <div className="min-w-0 flex-1">
          {entry.text && <p className="xp-serif line-clamp-6 text-[15px] leading-[1.45] text-foreground/90">{entry.text}</p>}
          {editing ? (
            <NoteField
              initial={entry.note ?? ""}
              onDone={(value) => {
                setEditing(false);
                onSaveNote(value.trim() ? value.trim() : entry.text ? null : entry.note);
              }}
            />
          ) : (
            entry.note && (
              <p className={cn("text-[13px] leading-[1.5]", entry.text ? "mt-1 text-foreground/65" : "text-foreground/85")}>
                {entry.note}
              </p>
            )
          )}
          <p className="mt-1 font-numeric text-[11px] text-muted-foreground tabular-nums">
            p. {page}
            {meta && <span> · {meta}</span>}
          </p>
        </div>
      </div>
      {!editing && (
        <div className="absolute top-1.5 right-1.5 flex opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <RowAction label={copied ? "Copied" : "Copy"} onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </RowAction>
          <RowAction label={entry.note ? "Edit note" : "Add a note"} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </RowAction>
          <RowAction label="Delete" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </RowAction>
        </div>
      )}
    </div>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative grid size-6 cursor-pointer place-items-center rounded-md bg-background/80 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function NoteField({ initial, onDone }: { initial: string; onDone: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder="Write a note…"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
          event.preventDefault();
          onDone(event.key === "Escape" ? initial : value);
        }
      }}
      className="pointer-events-auto relative mt-1 block w-full resize-none bg-transparent text-[13px] leading-[1.5] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
    />
  );
}
