import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import { useIsPresent } from "motion/react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/** Copies an entry's text; notes and highlights share the same menu item. */
export async function copyEntryText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error("Could not copy the text.");
  }
}

const menuItemClassName =
  "rounded-[calc(var(--radius-2xl)-5px)] hover:bg-secondary data-[highlighted]:bg-secondary focus:bg-secondary";

/** Desktop notebook entries use direct editing and a context menu, without
 * swipe gestures. A highlight has the same card and menu, without Edit. */
export function DesktopNotebookNote({
  kind = "note",
  children,
  onEdit,
  onDelete,
  canEdit,
  disabled,
  editing,
  dimmed,
  text,
}: {
  kind?: "note" | "highlight";
  children: ReactNode;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  canEdit: boolean;
  disabled: boolean;
  editing: boolean;
  dimmed: boolean;
  text: string;
}) {
  const present = useIsPresent();
  const menuDisabled = disabled || !present || editing || dimmed;
  return (
    <ContextMenu disabled={menuDisabled}>
      <ContextMenuTrigger
        tabIndex={present ? 0 : -1}
        inert={!present}
        aria-hidden={!present}
        aria-label={
          kind === "note"
            ? "Note; double-click or use the context menu to edit"
            : "Highlight; use the context menu to copy or delete"
        }
        data-note-editing={editing || undefined}
        onContextMenu={(event) => {
          if (editing || dimmed) event.preventDefault();
        }}
        className={`group relative mb-2 block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${dimmed ? "opacity-45" : ""}`}
        onDoubleClick={(event) => {
          if (disabled || editing || !canEdit) return;
          if ((event.target as HTMLElement).closest("button,a,textarea,input"))
            return;
          onEdit();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            disabled ||
            editing ||
            !canEdit
          )
            return;
          if (event.key !== "Enter" && event.key !== "F2") return;
          event.preventDefault();
          onEdit();
        }}
      >
        <article
          className={`relative rounded-2xl px-4 py-3 transition-colors duration-150 hover:bg-secondary/70 group-data-[popup-open]:bg-secondary/70 group-focus-visible:bg-secondary/70 ${editing ? "bg-secondary/70 ring-2 ring-inset ring-ring" : "bg-secondary/40"}`}
        >
          {children}
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52 rounded-2xl p-1">
        {kind === "note" && (
          <ContextMenuItem
            disabled={disabled || !canEdit || editing}
            onClick={onEdit}
            className={menuItemClassName}
          >
            <Pencil size={14} />
            Edit
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={disabled}
          onClick={() => void copyEntryText(text)}
          className={menuItemClassName}
        >
          <Copy size={14} />
          Copy text
        </ContextMenuItem>
        <ContextMenuItem
          disabled={disabled}
          variant="destructive"
          className={`${menuItemClassName} hover:bg-destructive/10 data-[highlighted]:bg-destructive/10 focus:bg-destructive/10`}
          onClick={() => void onDelete()}
        >
          <Trash2 size={14} />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface InlineEdit {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => Promise<boolean>;
  onCancel: () => void;
}

/** The saved text and metadata retain the row's size while an editor overlays
 * them. Long edits scroll within the existing text area, so nearby notes stay put. */
export function NotebookNoteBody({
  content,
  children,
  edit,
}: {
  content: string;
  children: ReactNode;
  edit?: InlineEdit;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const restoreFocus = useRef(true);
  const editing = Boolean(edit);
  useLayoutEffect(() => {
    if (editing) {
      restoreFocus.current = true;
      input.current?.focus({ preventScroll: true });
      const end = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(end, end);
    } else if (wasEditing.current && restoreFocus.current) {
      body.current
        ?.closest<HTMLElement>('[data-slot="context-menu-trigger"]')
        ?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => {
    if (!edit) return;
    // Save before an outside control closes or switches the panel. Let that
    // control receive the click and keep focus when the write completes.
    const saveOutside = (event: PointerEvent) => {
      if (event.button !== 0 || event.ctrlKey || edit.saving) return;
      if (body.current?.closest("article")?.contains(event.target as Node))
        return;
      restoreFocus.current = false;
      void edit.onSave();
    };
    document.addEventListener("pointerdown", saveOutside, true);
    return () => document.removeEventListener("pointerdown", saveOutside, true);
  }, [edit]);
  return (
    <div ref={body}>
      <div className="relative">
        <p
          aria-hidden={editing || undefined}
          className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${editing ? "invisible" : ""}`}
        >
          {content}
        </p>
        {edit && (
          <textarea
            ref={input}
            aria-label="Edit note"
            value={edit.value}
            readOnly={edit.saving}
            onChange={(event) => edit.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                edit.onCancel();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void edit.onSave();
              }
            }}
            className="absolute inset-0 m-0 size-full resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        )}
      </div>
      <div className="relative mt-3">
        <div
          aria-hidden={editing || undefined}
          inert={editing}
          className={editing ? "invisible" : undefined}
        >
          {children}
        </div>
        {edit && (
          <div className="absolute inset-0 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span role="status">
              {edit.saving ? "Saving…" : "Editing note"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Cancel editing"
                title="Cancel (Escape)"
                disabled={edit.saving}
                onClick={edit.onCancel}
                className="flex size-6 items-center justify-center rounded-lg hover:bg-background/80 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              >
                <X size={15} />
              </button>
              <button
                type="button"
                aria-label="Save changes"
                title="Save (Command or Control + Enter)"
                disabled={edit.saving || !edit.value.trim()}
                onClick={() => void edit.onSave()}
                className="flex size-6 items-center justify-center rounded-lg text-foreground hover:bg-background/80 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              >
                <Check size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
