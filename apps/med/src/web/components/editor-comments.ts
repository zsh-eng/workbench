import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// Room under a line of the editor where React draws a comment on the file,
// or the box to write one (FileComments.tsx). CodeMirror owns the element;
// React draws into it through a portal while it is in the view.

/** What sits under a line: a comment's ID, or "box". */
export interface CommentSlot {
  key: string;
  line: number;
}

/** The slots' elements in the view, for React to draw into. */
export class CommentSlots {
  private elements = new Map<string, HTMLElement>();
  private shown: ReadonlyMap<string, HTMLElement> = new Map();
  private listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly get = () => this.shown;
  attach(key: string, element: HTMLElement) {
    this.elements.set(key, element);
    this.publish();
  }
  detach(key: string, element: HTMLElement) {
    if (this.elements.get(key) !== element) return;
    this.elements.delete(key);
    this.publish();
  }
  private publish() {
    this.shown = new Map(this.elements);
    for (const listener of this.listeners) listener();
  }
}

const observers = new WeakMap<HTMLElement, ResizeObserver>();

class SlotWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly slots: CommentSlots,
  ) {
    super();
  }
  eq(other: SlotWidget) {
    return other.key === this.key && other.slots === this.slots;
  }
  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "med-editor-comment";
    element.dataset.commentSlot = this.key;
    // A comment grows as it is written or answered; the lines below move.
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(element);
    observers.set(element, observer);
    this.slots.attach(this.key, element);
    return element;
  }
  destroy(element: HTMLElement) {
    observers.get(element)?.disconnect();
    this.slots.detach(this.key, element);
  }
  get estimatedHeight() {
    return 96;
  }
  /** Typing, clicks and keys in a comment are the comment's, not Vim's. */
  ignoreEvent() {
    return true;
  }
}

const setCommentSlots = StateEffect.define<DecorationSet>();
const commentSlots = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setCommentSlots)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const editorComments = () => commentSlots;

const marked = Decoration.line({ class: "med-cited-line" });

/** Puts each slot under its line; a line past the end goes to the last. The
 * lines of the comment being written show selected. */
export function placeCommentSlots(
  view: EditorView,
  slots: CommentSlots,
  wanted: readonly CommentSlot[],
  writing?: { line: number; endLine: number },
) {
  const { doc } = view.state;
  const line = (at: number) => doc.line(Math.max(1, Math.min(at, doc.lines)));
  const ranges = wanted.map((slot) =>
    Decoration.widget({
      widget: new SlotWidget(slot.key, slots),
      block: true,
      side: 1,
    }).range(line(slot.line).to),
  );
  if (writing)
    for (let at = writing.line; at <= Math.min(writing.endLine, doc.lines); at++)
      ranges.push(marked.range(line(at).from));
  view.dispatch({ effects: setCommentSlots.of(Decoration.set(ranges, true)) });
}

/** The lines that a selection covers. A selection that ends at the start of a
 * line, as Visual Line mode's does, leaves that line out. */
export function selectedLines(view: EditorView) {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const line = doc.lineAt(from).number;
  let endLine = doc.lineAt(to).number;
  if (endLine > line && doc.line(endLine).from === to) endLine--;
  return { line, endLine };
}
