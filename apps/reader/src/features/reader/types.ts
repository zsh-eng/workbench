export type ReaderSheetId =
  | "tools"
  | "contents"
  | "book-actions"
  | "search"
  | "settings"
  | "notes";

/**
 * Reader-facing chapter metadata derived from the EPUB spine.
 *
 * This is similar to a coarse table of contents entry, but it is guaranteed to
 * align 1:1 with the chapter sources we load and feed into pagination.
 */
export interface ChapterEntry {
  index: number;
  spineItemId: string;
  href: string;
  title: string;
}

export interface ReaderHandoffPrompt {
  sourceLabel: string;
  targetPage: number;
  onJump: () => void;
  onDismiss: () => void;
}
