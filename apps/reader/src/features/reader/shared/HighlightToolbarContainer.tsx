import { HighlightToolbar } from "./HighlightToolbar";
import { MobileHighlightBar } from "./MobileHighlightBar";
import {
  useDeleteHighlightMutation,
  useUpdateHighlightMutation,
} from "@/hooks/use-highlights-query";
import type { AnnotationColor } from "@/lib/highlight-constants";
import type { Highlight } from "@/types/highlight";
import { AnimatePresence } from "motion/react";

interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

interface HighlightToolbarContainerProps {
  /**
   * "island": colour swatches for the phone's Notes Island, which places
   * them. "floating": the toolbar beside the passage. The caller decides:
   * a width check made here would start as desktop on the first render.
   */
  placement: "island" | "floating";
  bookId: string | undefined;
  highlights: Highlight[];

  // For creating new highlights (text selection mode)
  isCreatingHighlight: boolean;
  creationPosition: { x: number; y: number; bottom?: number };
  /** The selection as Copy writes it, read at the tap. */
  creationCopyText: () => string;
  /** The selected highlight's text as Copy writes it. */
  activeHighlightCopyText?: string;
  onCreateColorSelect: (color: AnnotationColor) => void;
  onCreateClose: () => void;
  onHighlightChange?: (highlight: Highlight) => void;
  /** Called when user submits a note from the toolbar */
  onAddSelectionNote?: () => void;
  onAddHighlightNote?: (highlight: Highlight) => void;
  onCreateNoteSubmit?: (content: string) => void;

  // For editing existing highlights
  activeHighlight: ActiveHighlightState | null;
  onEditClose: () => void;
}

export function HighlightToolbarContainer({
  placement,
  bookId,
  highlights,
  isCreatingHighlight,
  creationPosition,
  creationCopyText,
  activeHighlightCopyText,
  onCreateColorSelect,
  onCreateClose,
  onHighlightChange,
  onCreateNoteSubmit,
  onAddHighlightNote,
  onAddSelectionNote,
  activeHighlight,
  onEditClose,
}: HighlightToolbarContainerProps) {
  // Get mutations for editing highlights
  const updateHighlightMutation = useUpdateHighlightMutation(bookId);
  const deleteHighlightMutation = useDeleteHighlightMutation(bookId);

  // Find the active highlight data
  const activeHighlightData = activeHighlight
    ? highlights.find((h) => h.id === activeHighlight.id)
    : null;
  const isEditingHighlight = !!activeHighlightData;

  // Handlers for editing mode
  const handleEditColorSelect = (color: AnnotationColor) => {
    if (!activeHighlightData) return;

    onHighlightChange?.({ ...activeHighlightData, color });
    updateHighlightMutation.mutate({
      id: activeHighlightData.id,
      changes: { color },
    });
  };

  const handleEditDelete = () => {
    if (!activeHighlightData) return;

    deleteHighlightMutation.mutate(activeHighlightData.id);
    onEditClose();
  };

  if (placement === "island") {
    return (
      <AnimatePresence>
        {isEditingHighlight && (
          <MobileHighlightBar
            currentColor={activeHighlightData.color}
            onColorSelect={handleEditColorSelect}
            onDelete={handleEditDelete}
          />
        )}
        {isCreatingHighlight && (
          <MobileHighlightBar onColorSelect={onCreateColorSelect} />
        )}
      </AnimatePresence>
    );
  }

  return (
    <>
      <AnimatePresence>
        {isCreatingHighlight && (
          <HighlightToolbar
            position={creationPosition}
            onClose={onCreateClose}
            onAddNote={onAddSelectionNote}
            onColorSelect={onCreateColorSelect}
            onNoteSubmit={onCreateNoteSubmit}
            textToCopy={creationCopyText}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditingHighlight && (
          <HighlightToolbar
            position={activeHighlight!.position}
            onClose={onEditClose}
            currentColor={activeHighlightData.color}
            onColorSelect={handleEditColorSelect}
            onAddNote={
              onAddHighlightNote
                ? () => onAddHighlightNote(activeHighlightData)
                : undefined
            }
            onDelete={handleEditDelete}
            textToCopy={() =>
              activeHighlightCopyText || activeHighlightData.selectedText
            }
          />
        )}
      </AnimatePresence>
    </>
  );
}
