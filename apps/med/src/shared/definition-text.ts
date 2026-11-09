// What a hover over a symbol shows of its definition: the lines that declare
// it, and the comment that documents it, from the definition's file. The
// index gives only a line; this reads the text around it, as an editor's
// hover does without a language server.

/** Lines of a declaration at most; a longer one ends with "…". */
const MAX_SIGNATURE_LINES = 6;
/** Lines of a doc comment at most. */
const MAX_DOC_LINES = 24;

const lineComment = /^\s*(\/\/\/?|#(?![!{[])|--|;;+)\s?/;
const blockStart = /^\s*\/\*\*?\s?/;
const blockEnd = /\s*\*\/\s*$/;
const blockMiddle = /^\s*\*(?!\/)\s?/;
const decorator = /^\s*@[\w.]+/;
const docString = /^\s*[rRuUbB]?("""|''')/;

/** Brackets opened minus closed, outside strings, as far as a line can tell. */
function depth(text: string) {
  let open = 0;
  for (const char of text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ""))
    if (char === "(" || char === "[" || char === "<") open++;
    else if (char === ")" || char === "]" || char === ">") open--;
  return open;
}

/** The declaration from its line, until its brackets close. */
function signatureAt(lines: readonly string[], index: number) {
  const signature: string[] = [];
  let open = 0;
  for (let at = index; at < lines.length && signature.length < MAX_SIGNATURE_LINES; at++) {
    const text = lines[at]!.replace(/\s+$/, "");
    signature.push(text);
    open += depth(text);
    if (open <= 0) break;
  }
  if (signature.length === MAX_SIGNATURE_LINES && open > 0) signature.push("…");
  // The body's brace and what follows it on the line are not the signature.
  const last = signature.length - 1;
  signature[last] = signature[last]!.replace(/\s*\{\s*$/, "");
  return trimIndent(signature);
}

function trimIndent(lines: string[]) {
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length),
  );
  return Number.isFinite(indent) ? lines.map((line) => line.slice(indent)) : lines;
}

/** The comment just above the declaration, or a Python docstring under it. */
function docAt(lines: readonly string[], index: number, signatureLines: number) {
  let at = index - 1;
  while (at >= 0 && decorator.test(lines[at]!)) at--;
  const above: string[] = [];
  if (at >= 0 && blockEnd.test(lines[at]!)) {
    // A block comment: /** … */ or /* … */.
    let start = at;
    while (start >= 0 && !blockStart.test(lines[start]!) && at - start < 200) start--;
    if (start >= 0)
      for (let line = start; line <= at; line++)
        above.push(
          lines[line]!.replace(blockEnd, "")
            .replace(line === start ? blockStart : blockMiddle, "")
            .replace(/^\s*\/?\*+\s?/, ""),
        );
  } else
    while (at >= 0 && lineComment.test(lines[at]!)) {
      above.unshift(lines[at]!.replace(lineComment, ""));
      at--;
    }
  if (above.length) return tidy(above);
  // Python: the string that opens the body.
  const body = index + signatureLines;
  const open = docString.exec(lines[body] ?? "");
  if (!open) return [];
  const quote = open[1]!;
  const first = lines[body]!.slice(lines[body]!.indexOf(quote) + 3);
  if (first.includes(quote)) return tidy([first.slice(0, first.indexOf(quote))]);
  const doc = [first];
  for (let line = body + 1; line < lines.length && doc.length < 200; line++) {
    const text = lines[line]!;
    if (text.includes(quote)) {
      doc.push(text.slice(0, text.indexOf(quote)));
      break;
    }
    doc.push(text);
  }
  return tidy(trimIndent(doc.slice(1)).length ? [doc[0]!, ...trimIndent(doc.slice(1))] : doc);
}

/** Without blank lines at the ends, and at most MAX_DOC_LINES. */
function tidy(lines: string[]) {
  const doc = lines.map((line) => line.replace(/\s+$/, ""));
  while (doc.length && !doc[0]!.trim()) doc.shift();
  while (doc.length && !doc.at(-1)!.trim()) doc.pop();
  return doc.length > MAX_DOC_LINES ? [...doc.slice(0, MAX_DOC_LINES), "…"] : doc;
}

/** The declaration at `line` (from 1) in `text`, and its doc comment. */
export function definitionText(text: string, line: number) {
  const lines = text.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) return { signature: [], doc: [] };
  const signature = signatureAt(lines, index);
  const doc = docAt(lines, index, signature.filter((line) => line !== "…").length);
  return { signature, doc };
}
