// The hunks of one file's unified patch, as `git diff` writes it. The Commit
// tab names a hunk by its text; the host finds the same hunk again in Git's
// current patch before it stages, unstages, or discards it.

/** One `@@` hunk: its header line, its lines, and any "\ No newline" mark. */
export interface PatchHunk {
  /** As Git wrote it, each line with its newline. */
  text: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Lines that start with "+" and with "-". */
  added: number;
  removed: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A one-file patch as its header, the lines before the first hunk, and its
 * hunks. A second file's header ends the first file. */
export function splitPatch(patch: string): { header: string; hunks: PatchHunk[] } {
  const lines = patch.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let header = "";
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | null = null;
  for (const raw of lines) {
    const line = raw.endsWith("\n") ? raw : `${raw}\n`;
    const start = HUNK.exec(line);
    if (start) {
      current = {
        text: line,
        oldStart: Number(start[1]),
        oldCount: start[2] === undefined ? 1 : Number(start[2]),
        newStart: Number(start[3]),
        newCount: start[4] === undefined ? 1 : Number(start[4]),
        added: 0,
        removed: 0,
      };
      hunks.push(current);
    } else if (current) {
      if (line.startsWith("diff --git ")) break;
      current.text += line;
      if (line[0] === "+") current.added += 1;
      else if (line[0] === "-") current.removed += 1;
    } else header += line;
  }
  return { header, hunks };
}

/** A hunk's lines without its `@@` line, whose numbers and function name
 * change when another hunk of the file is staged. */
export const hunkBody = (text: string) => text.slice(text.indexOf("\n") + 1);

/** A patch that adds or deletes the whole file: its one hunk is the file. */
export const wholeFilePatch = (header: string) => /^(new|deleted) file mode /m.test(header);
