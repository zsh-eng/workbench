import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder as cmPlaceholder,
  type DecorationSet,
} from "@codemirror/view";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { mentionKind, mentionParts, type Mention, type MentionKind } from "../data/mentions";
import { iconMarkup } from "./Icon";
import { QUOTE_ICON } from "./session/prompt-chips";
import { insertInlineQuote, matchInlineQuotes } from "./session/reply-quote";
import "./chips.css";
import "./RichPromptEditor.css";

export interface RichPromptEditorHandle {
  focus(): void;
  setSelection(pos: number): void;
  insertQuote?(quotedText: string): void;
  element(): HTMLElement | null;
}

export interface RichPromptEditorProps {
  value: string;
  onChange(value: string, caret: number): void;
  onSelect?(caret: number): void;
  mentions?: readonly Mention[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  inputRole?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaActiveDescendant?: string;
  ariaAutoComplete?: "list" | "none";
  minHeight?: number;
  maxHeight?: number;
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  onPaste?(event: ClipboardEvent<HTMLElement>): void;
  onDrop?(event: DragEvent<HTMLElement>): void;
  onDragOver?(event: DragEvent<HTMLElement>): void;
  editorRef?: RefObject<RichPromptEditorHandle | null>;
  className?: string;
}

/** A chip's frame (chips.css): its icon and its label. */
function chipElement(icon: string, label: string) {
  const chip = document.createElement("span");
  chip.className = "med-chip";
  const mark = document.createElement("span");
  mark.className = "med-chip-icon";
  mark.innerHTML = icon;
  const text = document.createElement("span");
  text.className = "med-chip-label";
  text.textContent = label;
  chip.append(mark, text);
  return chip;
}

const MENTION_ICONS = { file: "file", note: "note", thread: "sessions" } as const;

class MentionWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: MentionKind,
  ) {
    super();
  }
  override eq(other: MentionWidget) {
    return other.text === this.text && other.kind === this.kind;
  }
  override toDOM() {
    // The label without its @: the chip says that it is a mention.
    const chip = chipElement(iconMarkup(MENTION_ICONS[this.kind], 12), this.text.slice(1));
    chip.dataset.mentionChip = this.kind;
    chip.title = this.text.slice(1);
    return chip;
  }
  override ignoreEvent() {
    return false;
  }
}

class QuoteWidget extends WidgetType {
  constructor(
    readonly fullText: string,
    readonly preview: string,
  ) {
    super();
  }
  override eq(other: QuoteWidget) {
    return other.fullText === this.fullText && other.preview === this.preview;
  }
  override toDOM(view: EditorView) {
    const chip = chipElement(QUOTE_ICON, this.preview);
    chip.dataset.quoteChip = "";
    chip.dataset.removable = "";
    chip.title = this.fullText;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "med-chip-remove";
    remove.setAttribute("aria-label", "Remove quote");
    remove.innerHTML = iconMarkup("close", 10);
    remove.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(chip);
      const doc = view.state.doc.toString();
      for (const match of matchInlineQuotes(doc)) {
        if (pos >= match.from && pos < match.to) {
          // Eat one adjacent trailing space so removing a badge leaves tidy prose.
          const end = doc[match.to] === " " ? match.to + 1 : match.to;
          view.dispatch({
            changes: { from: match.from, to: end, insert: "" },
            selection: { anchor: match.from, head: match.from },
          });
          view.focus();
          return;
        }
      }
    });

    chip.append(remove);
    return chip;
  }
  override ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest(".med-chip-remove") !== null;
  }
}

const setMentionsEffect = StateEffect.define<readonly Mention[]>();
const externalSync = Annotation.define<boolean>();

const mentionsField = StateField.define<readonly Mention[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMentionsEffect)) return effect.value;
    return value;
  },
});

const slashDeco = Decoration.mark({ class: "med-rich-slash" });
const syntaxDeco = Decoration.mark({ class: "med-rich-syntax" });
const boldDeco = Decoration.mark({ class: "med-rich-bold" });
const italicDeco = Decoration.mark({ class: "med-rich-italic" });
const strikeDeco = Decoration.mark({ class: "med-rich-strike" });
const headingDeco = Decoration.mark({ class: "med-rich-heading" });
const codeDeco = Decoration.mark({ class: "med-rich-code" });
const codeLineDeco = Decoration.line({ class: "med-rich-code-line" });
const quoteLineDeco = Decoration.line({ class: "med-rich-quote-line" });

interface Span {
  from: number;
  to: number;
}

const overlaps = (from: number, to: number, spans: readonly Span[]) =>
  spans.some((span) => from < span.to && to > span.from);

function buildDecorations(state: EditorState): {
  decorations: DecorationSet;
  atomic: DecorationSet;
} {
  const doc = state.doc;
  const text = doc.toString();
  const mentions = state.field(mentionsField);
  const ranges: { from: number; to: number; value: Decoration }[] = [];
  const atomicRanges: { from: number; to: number; value: Decoration }[] = [];
  const atomicSpans: Span[] = [];

  for (const match of matchInlineQuotes(text)) {
    const deco = Decoration.replace({
      widget: new QuoteWidget(match.fullText, match.preview),
    });
    ranges.push({ from: match.from, to: match.to, value: deco });
    atomicRanges.push({ from: match.from, to: match.to, value: deco });
    atomicSpans.push({ from: match.from, to: match.to });
  }

  if (mentions.length && text.includes("@")) {
    let offset = 0;
    for (const part of mentionParts(text, mentions)) {
      const next = offset + part.text.length;
      if (part.mention && !overlaps(offset, next, atomicSpans)) {
        const deco = Decoration.replace({
          widget: new MentionWidget(part.text, mentionKind(part.mention)),
        });
        ranges.push({ from: offset, to: next, value: deco });
        atomicRanges.push({ from: offset, to: next, value: deco });
        atomicSpans.push({ from: offset, to: next });
      }
      offset = next;
    }
  }

  atomicRanges.sort((a, b) => a.from - b.from || a.to - b.to);
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  for (const range of atomicRanges) atomicBuilder.add(range.from, range.to, range.value);
  const mentionSpans = atomicSpans;

  // Leading /command badge on line 1.
  const slashMatch = /^\/[^\s/]+/.exec(text);
  if (slashMatch && !overlaps(0, slashMatch[0].length, mentionSpans)) {
    ranges.push({ from: 0, to: slashMatch[0].length, value: slashDeco });
  }

  // Lightweight live Markdown decorations per line.
  let fence: string | undefined;
  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const content = line.text;

    if (fence) {
      ranges.push({ from: line.from, to: line.from, value: codeLineDeco });
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(content)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        ranges.push({ from: line.from, to: line.to, value: syntaxDeco });
        fence = undefined;
      }
      continue;
    }

    const openFence = /^\s*(`{3,}|~{3,})/.exec(content)?.[1];
    if (openFence && !overlaps(line.from, line.to, mentionSpans)) {
      fence = openFence;
      ranges.push({ from: line.from, to: line.from, value: codeLineDeco });
      if (line.to > line.from) ranges.push({ from: line.from, to: line.to, value: syntaxDeco });
      continue;
    }

    const heading = /^(#{1,6})(\s+)(.+)$/.exec(content);
    if (heading) {
      const markerEnd = line.from + heading[1]!.length + heading[2]!.length;
      if (!overlaps(line.from, line.to, mentionSpans)) {
        ranges.push({ from: line.from, to: markerEnd, value: syntaxDeco });
        ranges.push({ from: markerEnd, to: line.to, value: headingDeco });
      }
    }

    const quote = /^(>+)(\s?)/.exec(content);
    if (quote && !overlaps(line.from, line.to, mentionSpans)) {
      ranges.push({ from: line.from, to: line.from, value: quoteLineDeco });
      const markerEnd = line.from + quote[0].length;
      if (markerEnd > line.from) ranges.push({ from: line.from, to: markerEnd, value: syntaxDeco });
    }

    const bullet = /^(\s*(?:[-*+]|\d+\.))(\s+)/.exec(content);
    if (bullet) {
      const markerEnd = line.from + bullet[1]!.length;
      if (!overlaps(line.from, markerEnd, mentionSpans))
        ranges.push({ from: line.from, to: markerEnd, value: syntaxDeco });
    }

    // Inline code (`code`) — collect spans so bold/italic don't style inside code.
    const codeSpans: Span[] = [];
    for (const match of content.matchAll(/`([^`\n]+)`/g)) {
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      if (overlaps(from, to, mentionSpans)) continue;
      codeSpans.push({ from, to });
      ranges.push({ from, to: from + 1, value: syntaxDeco });
      ranges.push({ from: from + 1, to: to - 1, value: codeDeco });
      ranges.push({ from: to - 1, to, value: syntaxDeco });
    }

    const blocked = codeSpans.length ? [...mentionSpans, ...codeSpans] : mentionSpans;
    const decoratePairs = (pattern: RegExp, deco: Decoration, markerLen: number) => {
      for (const match of content.matchAll(pattern)) {
        const from = line.from + (match.index ?? 0);
        const to = from + match[0].length;
        if (overlaps(from, to, blocked)) continue;
        ranges.push({ from, to: from + markerLen, value: syntaxDeco });
        ranges.push({ from: from + markerLen, to: to - markerLen, value: deco });
        ranges.push({ from: to - markerLen, to, value: syntaxDeco });
      }
    };

    decoratePairs(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, boldDeco, 2);
    decoratePairs(/__(?=\S)(.+?)(?<=\S)__/g, boldDeco, 2);
    decoratePairs(/(?<!\*)\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)/g, italicDeco, 1);
    decoratePairs(/~~(?=\S)(.+?)(?<=\S)~~/g, strikeDeco, 2);
  }

  return {
    decorations: Decoration.set(
      ranges.map((r) => r.value.range(r.from, r.to)),
      true,
    ),
    atomic: atomicBuilder.finish(),
  };
}

const richDecorationsField = StateField.define<{
  decorations: DecorationSet;
  atomic: DecorationSet;
}>({
  create: buildDecorations,
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setMentionsEffect))) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/**
 * Rich text prompt input built on CodeMirror 6: atomic `@mention` chips,
 * leading `/command` highlight, and live inline Markdown styling with plain
 * Markdown storage underneath.
 */
export function RichPromptEditor({
  value,
  onChange,
  onSelect,
  mentions = [],
  placeholder = "",
  disabled = false,
  ariaLabel,
  inputRole,
  ariaExpanded,
  ariaControls,
  ariaActiveDescendant,
  ariaAutoComplete,
  minHeight = 40,
  maxHeight = 200,
  onKeyDown,
  onPaste,
  onDrop,
  onDragOver,
  editorRef,
  className,
}: RichPromptEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSelect });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onSelect };
  });

  const compartments = useRef<{
    placeholder: Compartment;
    attrs: Compartment;
    editable: Compartment;
    sizing: Compartment;
  } | null>(null);
  if (!compartments.current) {
    compartments.current = {
      placeholder: new Compartment(),
      attrs: new Compartment(),
      editable: new Compartment(),
      sizing: new Compartment(),
    };
  }

  const buildAttrs = () => {
    const attrs: Record<string, string> = {
      "aria-label": ariaLabel,
      "aria-multiline": "true",
      "data-composer-input": "",
      "data-pane-autofocus": "",
      spellcheck: "true",
    };
    if (inputRole) attrs.role = inputRole;
    if (ariaExpanded !== undefined) attrs["aria-expanded"] = String(ariaExpanded);
    if (ariaControls) attrs["aria-controls"] = ariaControls;
    if (ariaActiveDescendant) attrs["aria-activedescendant"] = ariaActiveDescendant;
    if (ariaAutoComplete) attrs["aria-autocomplete"] = ariaAutoComplete;
    return EditorView.contentAttributes.of(attrs);
  };

  const buildSizing = () =>
    EditorView.theme({
      "&": { minHeight: `${minHeight}px` },
      ".cm-scroller": { minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` },
      ".cm-content": { minHeight: `${minHeight}px` },
    });

  useImperativeHandle(
    editorRef,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      setSelection(pos: number) {
        const view = viewRef.current;
        if (!view) return;
        const clamped = Math.max(0, Math.min(pos, view.state.doc.length));
        view.dispatch({ selection: { anchor: clamped, head: clamped } });
        view.focus();
      },
      insertQuote(quotedText: string) {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
        const current = view.state.doc.toString();
        const { from, to } = view.state.selection.main;
        const base = current.slice(0, from) + current.slice(to);
        const inserted = insertInlineQuote(base, from, quotedText);
        view.dispatch({
          changes: { from: 0, to: current.length, insert: inserted.value },
          selection: { anchor: inserted.caret, head: inserted.caret },
        });
        view.focus();
      },
      element() {
        return viewRef.current?.contentDOM ?? null;
      },
    }),
    [],
  );

  // Mount CodeMirror once.
  useLayoutEffect(() => {
    const parent = host.current;
    const parts = compartments.current;
    if (!parent || !parts) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        EditorView.lineWrapping,
        // Use standardKeymap (not defaultKeymap) so ⌘↵ starts/sends instead of
        // inserting a blank line, and ⌘[ / ⌘] stay free for history navigation.
        keymap.of([...standardKeymap, ...historyKeymap]),
        mentionsField,
        richDecorationsField,
        parts.placeholder.of(cmPlaceholder(placeholder)),
        parts.attrs.of(buildAttrs()),
        parts.editable.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
        parts.sizing.of(buildSizing()),
        EditorView.domEventHandlers({
          keydown: (event) => event.defaultPrevented,
          paste: (event) => event.defaultPrevented,
          drop: (event) => event.defaultPrevented,
          dragover: (event) => event.defaultPrevented,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            update.view.contentDOM.dataset.value = next;
            if (!update.transactions.every((tr) => tr.annotation(externalSync)))
              callbacks.current.onChange(next, update.state.selection.main.head);
          } else if (update.selectionSet) {
            callbacks.current.onSelect?.(update.state.selection.main.head);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent });
    view.contentDOM.dataset.value = value;
    if (mentions.length) view.dispatch({ effects: setMentionsEffect.of(mentions) });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; subsequent prop updates synchronize via effects below.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronize external value updates (draft restore, completion, clear).
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    view.contentDOM.dataset.value = value;
    if (current === value) return;
    const oldHead = view.state.selection.main.head;
    const head = oldHead === current.length ? value.length : Math.min(oldHead, value.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: head, head },
      annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  // Synchronize mention chips.
  const mentionKey = mentions.map((m) => m.label).join("\0");
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setMentionsEffect.of(mentions) });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionKey]);

  // Synchronize placeholder, ARIA attributes, disabled state, and height limits.
  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!view || !parts) return;
    view.dispatch({
      effects: [
        parts.placeholder.reconfigure(cmPlaceholder(placeholder)),
        parts.attrs.reconfigure(buildAttrs()),
        parts.editable.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        parts.sizing.reconfigure(buildSizing()),
      ],
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    placeholder,
    disabled,
    ariaLabel,
    inputRole,
    ariaExpanded,
    ariaControls,
    ariaActiveDescendant,
    ariaAutoComplete,
    minHeight,
    maxHeight,
  ]);

  return (
    <div
      ref={host}
      className={className ? `med-rich-editor ${className}` : "med-rich-editor"}
      onKeyDownCapture={onKeyDown}
      onPasteCapture={onPaste}
      onDropCapture={onDrop}
      onDragOverCapture={onDragOver}
    />
  );
}
