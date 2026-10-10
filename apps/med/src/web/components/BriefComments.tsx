import * as stylex from "@stylexjs/stylex";
import type { Note, NoteMutation } from "../../shared/protocol";
import type { BriefComment } from "../../shared/saved-review";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { NoteCard, PassageComposer } from "./NoteCard";

// Comments on passages of the Notes. A comment keeps its quote and the text
// just before it; the passage is found again in the rendered prose, and the
// browser's highlight registry marks it without a change to the Markdown HTML.

/** A passage of one note: its quote and where it is. */
export interface Passage {
  section: string;
  quote: string;
  prefix: string;
  range: Range;
}
const PREFIX = 64;
/** Text inside these is not prose: diff excerpts and comment cards. */
const SKIP = "[data-brief-slot], [data-comment-card], [data-passage-ui]";
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, dt, dd, figcaption";

/** The prose text of a note, with a line break between blocks, and where
 * each text node starts in it. */
function proseText(section: Element) {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  let block: Element | null = null;
  const walker = section.ownerDocument.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(".med-md-block") && !node.parentElement.closest(SKIP)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const owner = node.parentElement!.closest(`${BLOCKS}, .med-md-block`);
    if (block && owner !== block && text && !text.endsWith("\n")) text += "\n";
    block = owner;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** The passage that the document selection covers in the Notes, if any. */
export function selectedPassage(article: HTMLElement | null): Passage | null {
  const selection = article?.ownerDocument.getSelection();
  if (!article || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
  const start = element(range.startContainer)?.closest<HTMLElement>("[data-note-section]");
  const end = element(range.endContainer)?.closest<HTMLElement>("[data-note-section]");
  if (!start || start !== end || !article.contains(start)) return null;
  if (element(range.commonAncestorContainer)?.closest(SKIP)) return null;
  const { text, nodes } = proseText(start);
  let from = -1;
  let to = -1;
  for (const { node, start: at } of nodes) {
    if (!range.intersectsNode(node)) continue;
    if (from < 0) from = at + (node === range.startContainer ? range.startOffset : 0);
    to = at + (node === range.endContainer ? range.endOffset : node.length);
  }
  if (from < 0 || to <= from) return null;
  const raw = text.slice(from, to);
  const quote = raw.trim();
  if (!quote) return null;
  const begin = from + raw.length - raw.trimStart().length;
  return {
    section: start.dataset.noteSection!,
    quote,
    prefix: text.slice(Math.max(0, begin - PREFIX), begin),
    range: rangeAt(nodes, begin, begin + quote.length) ?? range.cloneRange(),
  };
}

function rangeAt(nodes: { node: Text; start: number }[], from: number, to: number) {
  const point = (offset: number, end: boolean) => {
    const found = end
      ? nodes.findLast(({ start }) => start < offset)
      : nodes.find(({ node, start }) => offset < start + node.length);
    return found && { node: found.node, offset: offset - found.start };
  };
  const first = point(from, false);
  const last = point(to, true);
  if (!first || !last) return null;
  const range = new Range();
  range.setStart(first.node, Math.min(first.offset, first.node.length));
  range.setEnd(last.node, Math.min(last.offset, last.node.length));
  return range;
}

/** Finds a comment's passage in its note: after its prefix when the quote
 * repeats, else the first match. */
export function findPassage(section: Element, quote: string, prefix = "") {
  const { text, nodes } = proseText(section);
  const after = prefix ? text.indexOf(prefix + quote) : -1;
  const at = after >= 0 ? after + prefix.length : text.indexOf(quote);
  return at < 0 ? null : rangeAt(nodes, at, at + quote.length);
}

/** The index of the rendered block that holds a node. */
export function blockOf(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest<HTMLElement>("[data-block-index]");
  return block ? Number(block.dataset.blockIndex) : undefined;
}

// One registry for every Notes view; hidden workspaces keep their marks.
const marks = new Map<object, { saved: Range[]; draft: Range | null }>();
const supported = () => typeof Highlight !== "undefined" && "highlights" in CSS;
export function markPassages(owner: object, saved: Range[], draft: Range | null) {
  if (!supported()) return;
  if (saved.length || draft) marks.set(owner, { saved, draft });
  else marks.delete(owner);
  const all = [...marks.values()];
  CSS.highlights.set("med-brief-comment", new Highlight(...all.flatMap((mark) => mark.saved)));
  CSS.highlights.set(
    "med-brief-draft",
    new Highlight(...all.flatMap((mark) => (mark.draft ? [mark.draft] : []))),
  );
}

/** A comment as a note, for the shared comment card. */
const asNote = (comment: BriefComment): Note => ({
  id: comment.id,
  path: "Notes",
  side: "new",
  line: 1,
  text: comment.text,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});
const short = (quote: string) => {
  const line = quote.replace(/\s+/g, " ");
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

export function PassageComments({
  comments,
  lost = false,
  onMutate,
}: {
  comments: readonly BriefComment[];
  /** The passages are no longer in the notes. */
  lost?: boolean;
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  return (
    <div data-passage-ui {...stylex.props(styles.list)}>
      {comments.map((comment) => (
        <div key={comment.id} {...stylex.props(styles.item)}>
          <div {...stylex.props(styles.quote)} title={comment.quote}>
            {short(comment.quote)}
          </div>
          {lost && <p {...stylex.props(styles.lost)}>The notes no longer contain this passage.</p>}
          <NoteCard
            note={asNote(comment)}
            replies={[]}
            label={`Comment on “${short(comment.quote)}”`}
            onMutate={onMutate}
          />
        </div>
      ))}
    </div>
  );
}

export function PassageDraft({
  quote,
  onSave,
  onCancel,
}: {
  quote: string;
  onSave(text: string): Promise<void>;
  onCancel(): void;
}) {
  return (
    <div data-passage-ui {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.item)}>
        <div {...stylex.props(styles.quote)} title={quote}>
          {short(quote)}
        </div>
        <PassageComposer
          label={`Comment on “${short(quote)}”`}
          onSave={onSave}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

/** The button beside a selected passage. It keeps the selection on press. */
export function PassageButton({
  top,
  left,
  onComment,
}: {
  top: number;
  left: number;
  onComment(): void;
}) {
  return (
    <button
      type="button"
      data-passage-ui
      aria-label="Comment on the selection"
      title="Comment (C)"
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onComment}
      {...stylex.props(ui.button, ui.pressable, styles.button, styles.at(top, left))}
    >
      <Icon name="note" size={13} />
      Comment
    </button>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBlock: 10,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: 1.5,
  },
  item: { display: "flex", flexDirection: "column" },
  // Level with the card, which keeps its inset from the diffs.
  quote: {
    marginBlock: 0,
    marginInline: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: "color-mix(in srgb, var(--med-warning, #e8c17a) 70%, transparent)",
    color: tokens.muted,
    fontSize: 12,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  lost: { margin: 0, color: tokens.warning, fontSize: 11.5 },
  button: {
    position: "absolute",
    zIndex: 3,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    minHeight: 26,
    paddingInline: 9,
    fontSize: 12,
    backgroundColor: tokens.raised,
    boxShadow: tokens.shadow,
  },
  at: (top: number, left: number) => ({ top, left }),
});
