import { HighlightToolbar } from "./HighlightToolbar";
import { MobileHighlightBar } from "./MobileHighlightBar";
import {
  useDeleteHighlightMutation,
  useUpdateHighlightMutation,
} from "@/hooks/use-highlights-query";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AnnotationColor } from "@/lib/highlight-constants";
import type { Highlight } from "@/types/highlight";
import { AnimatePresence } from "motion/react";

interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

interface HighlightToolbarContainerProps {
  bookId: string | undefined;
  spineItemId: string | undefined;
  highlights: Highlight[];

  // For creating new highlights (text selection mode)
  isCreatingHighlight: boolean;
  creationPosition: { x: number; y: number };
  creationText: string;
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
  bookId,
  spineItemId,
  highlights,
  isCreatingHighlight,
  creationPosition,
  creationText,
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
  const isMobile = useIsMobile();

  // Get mutations for editing highlights
  const updateHighlightMutation = useUpdateHighlightMutation(
    bookId,
    spineItemId,
  );
  const deleteHighlightMutation = useDeleteHighlightMutation(
    bookId,
    spineItemId,
  );

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

  // Mobile rendering
  if (isMobile) {
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

  // Desktop rendering
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
            textToCopy={creationText}
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
            textToCopy={
              activeHighlightCopyText || activeHighlightData.selectedText
            }
          />
        )}
      </AnimatePresence>
    </>
  );
}
