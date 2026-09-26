export interface PreviewPosition {
  line: number;
  reason: "cursor" | "scroll";
}
/** A small bridge: cursor movement does not rerender the editor or reparse Markdown. */
export function createMarkdownModel(text: string) {
  let value = text;
  let position: PreviewPosition = { line: 1, reason: "cursor" };
  const texts = new Set<() => void>();
  const positions = new Set<(position: PreviewPosition) => void>();
  return {
    getText: () => value,
    getPosition: () => position,
    subscribe(listener: () => void) {
      texts.add(listener);
      return () => {
        texts.delete(listener);
      };
    },
    subscribePosition(listener: (position: PreviewPosition) => void) {
      positions.add(listener);
      return () => {
        positions.delete(listener);
      };
    },
    setText(text: string) {
      if (value !== text) {
        value = text;
        texts.forEach((listener) => listener());
      }
    },
    follow(line: number, reason: PreviewPosition["reason"]) {
      position = { line, reason };
      positions.forEach((listener) => listener(position));
    },
  };
}
export type MarkdownModel = ReturnType<typeof createMarkdownModel>;
export interface MarkdownBlock {
  diagram?: string;
  html: string;
  start: number;
  end: number;
}
export interface MarkdownHeading {
  id: string;
  text: string;
  level: number;
  line: number;
}
export interface MarkdownResult {
  blocks: MarkdownBlock[];
  headings: MarkdownHeading[];
  milliseconds: number;
}
