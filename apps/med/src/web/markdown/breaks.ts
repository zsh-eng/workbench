// Where the long words of a table cell may break: the renderer puts a <wbr>
// there (render.worker.ts), and the session pane's height estimate breaks its
// text at the same places (thread-heights.ts).

/** The pieces of a word longer than this may go on separate lines. */
const LONG_WORD = 12;
/** A piece shorter than this stays with its neighbour. */
const SHORT_PIECE = 3;
const LONG = new RegExp(`\\S{${LONG_WORD + 1}}`);
/** A file's extension, at the end of its word or before ":12" or "#L5". */
const EXTENSION = /^\.\w{1,4}(?![\w.])/;

/** Whether a word may break before its character at `at`. */
function cutAt(word: string, at: number) {
  if (EXTENSION.test(word.slice(at))) return false;
  const before = word[at - 1]!;
  const after = word[at]!;
  return (
    ("/-_(,=&?;".includes(before) && before !== after) ||
    (".:".includes(after) && !"./:".includes(before) && word[at + 1] !== "/")
  );
}

/**
 * Text in pieces, with a line break opportunity between each two: at the
 * separators of each long word, after / - _ ( , = & ? ; and before . and :,
 * as in `./gradlew :core:test`, `src/web/App.tsx:12` or
 * `registry.timer(name)`. A file's extension stays with its name, a number or
 * a date stays whole, and no piece is a letter or two. The pieces join into
 * the text as it was.
 */
export function breakPieces(value: string): string[] {
  if (!LONG.test(value)) return [value];
  const pieces: string[] = [];
  let text = "";
  for (const word of value.split(/(\s+)/)) {
    const digits = word.replace(/\D/g, "").length;
    if (word.length <= LONG_WORD || /^\s/.test(word) || digits * 2 >= word.length) {
      text += word;
      continue;
    }
    let last = 0;
    for (let at = 1; at < word.length; at++) {
      if (at - last < SHORT_PIECE || word.length - at < SHORT_PIECE || !cutAt(word, at)) continue;
      pieces.push(text + word.slice(last, at));
      text = "";
      last = at;
    }
    text += word.slice(last);
  }
  pieces.push(text);
  return pieces;
}
