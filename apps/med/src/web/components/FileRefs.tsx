import { createContext, Fragment, useContext, useMemo } from "react";
import {
  decorateFileRefs,
  lineLabel,
  refLabels,
  refTitle,
  textFileRefs,
  type FileIndex,
  type FileRef,
  type RefOptions,
} from "../data/file-refs";
import type { MarkdownBlock } from "../markdown/model";
import "./FileRefs.css";

/** What file references in a thread link to: the checkout's files, and how
 * a link opens one. Without it, references stay as text. */
export interface FileRefs {
  index: FileIndex | null;
  /** The folder that the agent worked in, which relative paths start from. */
  cwd?: string;
  /** For comments: paths in their text, and GitHub links to the head's files. */
  comments?: RefOptions;
  /** Opens the file at its lines; `background` keeps the current tab. */
  open(ref: FileRef, background: boolean): void;
}
export const FileRefsContext = createContext<FileRefs | null>(null);
export const useFileRefs = () => useContext(FileRefsContext);
/** What file references in the review's comments link to (CommentText). */
export const CommentRefsContext = createContext<FileRefs | null>(null);

// Rendered replies keep their links: a reply that scrolls back into a
// thread's list does not read its HTML again.
const decorated = new WeakMap<
  readonly MarkdownBlock[],
  { index: FileIndex; cwd?: string; comments?: RefOptions; blocks: MarkdownBlock[] }
>();
/** The blocks of a rendered reply or comment, with links to the files that it names. */
export function useFileRefBlocks(blocks: readonly MarkdownBlock[] | undefined) {
  const refs = useFileRefs();
  const index = refs?.index;
  const cwd = refs?.cwd;
  const comments = refs?.comments;
  return useMemo(() => {
    if (!blocks || !index) return blocks;
    const kept = decorated.get(blocks);
    if (kept && kept.index === index && kept.cwd === cwd && kept.comments === comments)
      return kept.blocks;
    const next = decorateFileRefs(blocks, index, cwd, comments);
    decorated.set(blocks, { index, cwd, comments, blocks: next });
    return next;
  }, [blocks, index, cwd, comments]);
}

/** Plain text, such as a prompt, with the paths that name a file of the
 * checkout as links. */
export function LinkedText({ text }: { text: string }) {
  const refs = useFileRefs();
  const index = refs?.index;
  const cwd = refs?.cwd;
  const parts = useMemo(() => (index ? textFileRefs(text, index, cwd) : null), [text, index, cwd]);
  if (!parts || !refs) return text;
  const labels = refLabels(
    parts.flatMap((part) => (typeof part === "string" ? [] : [part.ref.path])),
  );
  return parts.map((part, at) =>
    typeof part === "string" ? (
      <Fragment key={at}>{part}</Fragment>
    ) : (
      <FileRefLink key={at} fileRef={part.ref} label={labels.get(part.ref.path)!} />
    ),
  );
}

/** A link to a file and its lines, as replies show them. A prompt has no
 * Markdown links, so a button opens the file. */
export function FileRefLink({ fileRef, label }: { fileRef: FileRef; label: string }) {
  const refs = useFileRefs();
  const lines = lineLabel(fileRef);
  return (
    <button
      type="button"
      className="med-file-ref"
      data-file-path={fileRef.path}
      data-file-line={fileRef.line}
      data-file-end={fileRef.endLine}
      data-tooltip={refTitle(fileRef)}
      aria-label={`Open ${fileRef.path}${lines ? ` at ${lines}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        refs?.open(fileRef, event.metaKey || event.ctrlKey);
      }}
    >
      <span className="med-file-ref-name">{label}</span>
      {lines && <span className="med-file-ref-lines">{lines}</span>}
    </button>
  );
}
