/** Read-only Vim motions over file bytes; DOM rows are never the text model. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const MAX_VIM_MATCHES = 200_000;
const keyword = /[\p{L}\p{N}\p{M}_]/u;
const floorIndex = (values: number[], value: number) => {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
};
const kind = (char: string) => (/\s/u.test(char) ? 0 : keyword.test(char) ? 1 : 2);
export type VimMotion = {
  handled: boolean;
  align?: "start" | "center" | "end";
  search?: 1 | -1;
  wordSearch?: string;
  lineCommand?: true;
  copy?: true;
  definition?: string;
  /** `gc` comments on the selected lines, or the cursor's; `ga` asks about them. */
  annotate?: "comment";
  /** `K`: the name under the cursor, whose definition a card shows. */
  hover?: string;
};
export type VisualMode = "character" | "line";
export interface VisualRange {
  mode: VisualMode;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}
export class VimNavigation {
  readonly lines: string[];
  readonly starts: number[] = [];
  line = 0;
  column = 0;
  desired = 0;
  count = "";
  prefix = "";
  find: { key: string; char: string } | undefined;
  query = "";
  direction: 1 | -1 = 1;
  matches: number[] = [];
  private marks = new Map<string, { line: number; column: number }>();
  private previousJump: { line: number; column: number } | undefined;
  visual: { mode: VisualMode; line: number; column: number } | null = null;
  private objectRange: VisualRange | null = null;
  get visualRange(): VisualRange | null {
    if (!this.visual) return null;
    if (this.objectRange) return this.objectRange;
    const anchor = this.starts[this.visual.line]! + this.visual.column;
    const forward = anchor <= this.offset;
    const startLine = forward ? this.visual.line : this.line;
    const endLine = forward ? this.line : this.visual.line;
    if (this.visual.mode === "line")
      return {
        mode: "line",
        startLine,
        endLine,
        start: this.starts[startLine]!,
        end: this.starts[endLine + 1] ?? this.text.length,
      };
    const column = forward ? this.column : this.visual.column;
    const columns = this.geometry(endLine).columns;
    const length =
      (columns[floorIndex(columns, column) + 1] ?? this.lines[endLine]!.length) - column;
    return {
      mode: "character",
      startLine,
      endLine,
      start: Math.min(anchor, this.offset),
      end: length
        ? this.starts[endLine]! + column + length
        : (this.starts[endLine + 1] ?? this.text.length),
    };
  }
  selectedText() {
    const range = this.visualRange;
    return range ? this.text.slice(range.start, range.end) : "";
  }
  clearVisual() {
    this.objectRange = null;
    this.visual = null;
  }

  private boundaries = new Map<number, { columns: number[]; display: number[] }>();
  constructor(
    readonly text: string,
    readonly identity = "",
  ) {
    this.lines = text.split("\n");
    if (this.lines.length > 1 && this.lines.at(-1) === "") this.lines.pop();
    let offset = 0;
    for (const line of this.lines) {
      this.starts.push(offset);
      offset += line.length + 1;
    }
    this.lines = this.lines.map((line) => line.replace(/\r$/, ""));
  }
  private geometry(line = this.line) {
    let value = this.boundaries.get(line);
    if (!value) {
      const text = this.lines[line]!;
      const columns: number[] = [],
        display: number[] = [];
      let visual = 0;
      if (/^[\t -~]*$/.test(text)) {
        for (let i = 0; i < text.length; i++) {
          columns.push(i);
          display.push(visual);
          visual += text[i] === "\t" ? 2 - (visual % 2) : 1;
        }
      } else {
        for (const part of segmenter.segment(text)) {
          columns.push(part.index);
          display.push(visual);
          visual +=
            part.segment === "\t"
              ? 2 - (visual % 2)
              : /[\p{Extended_Pictographic}\u3000-\u9fff]/u.test(part.segment)
                ? 2
                : 1;
        }
      }
      if (!columns.length) {
        columns.push(0);
        display.push(0);
      }
      value = { columns, display };
      if (this.boundaries.size > 256) this.boundaries.clear();
      this.boundaries.set(line, value);
    }
    return value;
  }
  private columns() {
    return this.geometry().columns;
  }
  get offset() {
    return this.starts[this.line]! + this.column;
  }
  wordAtCursor() {
    const text = this.lines[this.line]!;
    let start = this.column,
      end = this.column;
    if (!keyword.test(text[start] ?? "")) return "";
    while (start > 0 && keyword.test(text[start - 1]!)) start--;
    while (end < text.length && keyword.test(text[end]!)) end++;
    return text.slice(start, end);
  }
  get endColumn() {
    return this.columns().at(-1)!;
  }
  get characterLength() {
    const columns = this.columns();
    return (
      (columns[floorIndex(columns, this.column) + 1] ?? this.lines[this.line]!.length) - this.column
    );
  }
  jump(line: number, column = 0, preserve = false) {
    this.objectRange = null;
    this.line = Math.max(0, Math.min(this.lines.length - 1, line));
    const { columns, display } = this.geometry();
    const index = floorIndex(preserve ? display : columns, column);
    this.column = columns[index]!;
    if (!preserve) this.desired = display[index]!;
  }
  jumpOffset(offset: number) {
    let lo = 0,
      hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid]! <= offset) lo = mid + 1;
      else hi = mid;
    }
    const line = Math.max(0, lo - 1);
    this.jump(line, offset - this.starts[line]!);
  }
  rememberJump(origin: { line: number; column: number }) {
    if (origin.line !== this.line || origin.column !== this.column)
      this.previousJump = { line: origin.line, column: origin.column };
  }
  private jumpTo(line: number, column = 0, preserve = false) {
    const origin = { line: this.line, column: this.column };
    this.jump(line, column, preserve);
    this.rememberJump(origin);
  }
  goToLine(input: string): "empty" | "invalid" | "moved" {
    const value = input.trim();
    if (!value) return "empty";
    const line = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(line) || line < 1) return "invalid";
    this.jumpTo(line - 1);
    return "moved";
  }
  restoreSearch(state: {
    line: number;
    column: number;
    desired: number;
    query: string;
    direction: 1 | -1;
    matches: number[];
  }) {
    this.jump(state.line, state.column);
    this.desired = state.desired;
    this.setSearch(state.query, state.direction);
    this.matches = state.matches;
  }
  setSearch(query: string, direction: 1 | -1) {
    this.query = query;
    this.direction = direction;
  }
  setMatches(matches: Uint32Array) {
    this.matches = Array.from(matches);
    this.nextMatch(this.direction, 1, false);
  }
  nextMatch(direction = this.direction, count = 1, remember = true) {
    if (!this.matches.length) return;
    let lo = 0,
      hi = this.matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.matches[mid]! <= this.offset) lo = mid + 1;
      else hi = mid;
    }
    let index = direction === 1 ? lo : lo - 1;
    if (direction === -1 && this.matches[index] === this.offset) index--;
    index =
      (((index + direction * (count - 1)) % this.matches.length) + this.matches.length) %
      this.matches.length;
    const origin = { line: this.line, column: this.column };
    this.jumpOffset(this.matches[index]!);
    if (remember) this.rememberJump(origin);
  }
  private word(motion: string) {
    let position = this.offset;
    const end = this.text.length;
    const next = (at: number) =>
      Math.min(end, at + ((this.text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1));
    const previous = (at: number) =>
      Math.max(0, at - (/[\uDC00-\uDFFF]/.test(this.text[at - 1] ?? "") ? 2 : 1));
    const typeAt = (at: number) => kind(String.fromCodePoint(this.text.codePointAt(at) ?? 32));
    if (motion === "b") {
      position = previous(position);
      while (position > 0 && typeAt(position) === 0) position = previous(position);
      const type = typeAt(position);
      while (position > 0 && typeAt(previous(position)) === type) position = previous(position);
    } else if (motion === "w") {
      const type = typeAt(position);
      while (position < end && typeAt(position) === type) position = next(position);
      while (position < end && typeAt(position) === 0) position = next(position);
    } else {
      position = next(position);
      while (position < end && typeAt(position) === 0) position = next(position);
      const type = typeAt(position);
      while (next(position) < end && typeAt(next(position)) === type) position = next(position);
    }
    this.jumpOffset(Math.min(Math.max(0, end - 1), position));
  }
  /** Text objects use source offsets, so selections can cross virtualized rows. */
  private textObject(object: string, around: boolean, count: number) {
    const previousRange = this.visualRange;
    if (object === "p") {
      const blank = (line: number) => this.lines[line] === "";
      let start = this.line;
      while (start > 0 && blank(start - 1) === blank(start)) start--;
      let end = this.line;
      const runEnd = (line: number) => {
        while (line + 1 < this.lines.length && blank(line + 1) === blank(line)) line++;
        return line;
      };
      for (let i = 0; i < count; i++) {
        end = runEnd(end);
        if (around && blank(end) && end + 1 < this.lines.length) end = runEnd(end + 1);
        if (around && end + 1 < this.lines.length && blank(end + 1)) end = runEnd(end + 1);
        if (i + 1 < count && end + 1 < this.lines.length) end++;
      }
      if (around && !blank(end) && end === this.lines.length - 1)
        while (start > 0 && blank(start - 1)) start--;
      if (previousRange?.mode === "line") {
        if (
          start === previousRange.startLine &&
          end === previousRange.endLine &&
          end + 1 < this.lines.length
        )
          end = runEnd(end + 1);
        start = Math.min(start, previousRange.startLine);
        end = Math.max(end, previousRange.endLine);
      }
      this.visual = { mode: "line", line: start, column: 0 };
      this.jump(end);
      return;
    }
    if (object !== "w" && object !== "W") {
      this.delimitedObject(object, around, count);
      return;
    }
    if (!this.lines[this.line]!.length) return;
    const typeAt = (offset: number) => {
      const char = String.fromCodePoint(this.text.codePointAt(offset) ?? 32);
      return object === "W" ? (/\s/u.test(char) ? 0 : 1) : kind(char);
    };
    const next = (offset: number) =>
      offset + ((this.text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1);
    const before = (offset: number) =>
      offset - (/[\uDC00-\uDFFF]/.test(this.text[offset - 1] ?? "") ? 2 : 1);
    const horizontal = (offset: number) => /[^\S\r\n]/u.test(this.text[offset] ?? "x");
    const runEnd = (offset: number) => {
      const type = typeAt(offset);
      while (offset < this.text.length && typeAt(offset) === type) offset = next(offset);
      return offset;
    };
    let start = this.offset;
    const type = typeAt(start);
    while (start > this.starts[this.line]! && typeAt(before(start)) === type) start = before(start);
    let end = this.offset;
    for (let i = 0; i < count; i++) {
      if (around && typeAt(end) === 0) end = runEnd(end);
      end = runEnd(end);
      if (around) while (end < this.text.length && horizontal(end)) end++;
      if (i + 1 < count && end < this.text.length && around && typeAt(end) === 0) end = runEnd(end);
    }
    if (around && end > start && !horizontal(end - 1) && type !== 0)
      while (start > this.starts[this.line]! && horizontal(start - 1)) start--;
    // A repeated object extends an existing selection by the next unit.
    if (
      previousRange?.mode === "character" &&
      (this.objectRange || previousRange.end - previousRange.start > this.characterLength)
    ) {
      if (start >= previousRange.start && end <= previousRange.end && end < this.text.length) {
        if (around && typeAt(end) === 0) end = runEnd(end);
        end = runEnd(end);
        if (around) while (end < this.text.length && horizontal(end)) end++;
      }
      start = Math.min(start, previousRange.start);
      end = Math.max(end, previousRange.end);
    }
    this.selectObject(start, end);
  }
  private selectObject(start: number, end: number) {
    this.jumpOffset(start);
    const empty = start === end;
    if (start < this.starts[this.line]! + this.lines[this.line]!.length) start = this.offset;
    const startLine = this.line;
    this.visual = { mode: "character", line: this.line, column: this.column };
    this.jumpOffset(Math.max(start, end - 1));
    end = empty ? start : Math.max(end, this.offset + this.characterLength);
    this.objectRange = { mode: "character", start, end, startLine, endLine: this.line };
  }
  private delimitedObject(object: string, around: boolean, count: number) {
    const quote = ['"', "'", "`"].includes(object);
    const pair = ["()", "[]", "{}", "<>"].find((pair) => pair.includes(object));
    if (!quote && !pair && object !== "b" && object !== "B") return;
    const [open, close] = quote ? [object, object] : (pair ?? (object === "b" ? "()" : "{}"));
    const ranges: [number, number][] = [];
    const stack: number[] = [];
    const from = quote ? this.starts[this.line]! : 0;
    const to = quote ? from + this.lines[this.line]!.length : this.text.length;
    let quoted = "";
    for (let offset = from; offset < to; offset++) {
      const char = this.text[offset]!;
      if (char === "\\") {
        offset++;
        continue;
      }
      if (!quote) {
        // Ignore delimiters in quoted source. This is a lexical object, not a parser.
        if (quoted) {
          if (char === quoted || (char === "\n" && quoted !== "`")) quoted = "";
          continue;
        }
        if (['"', "'", "`"].includes(char)) {
          quoted = char;
          continue;
        }
      }
      if (char === close && stack.length) ranges.push([stack.pop()!, offset]);
      else if (char === open) stack.push(offset);
    }
    const selection = this.visualRange;
    const enclosing = ranges.filter(([start, end]) => start <= this.offset && end >= this.offset);
    // Quotes can also select the next quoted string on the current line.
    if (quote && !enclosing.length) {
      const next = ranges.find(([start]) => start > this.offset);
      if (next) enclosing.push(next);
    }
    enclosing.sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
    let index = count - 1;
    if (!quote && selection && this.objectRange && enclosing[index]) {
      const [start, end] = enclosing[index]!;
      if (selection.start === start + (around ? 0 : 1) && selection.end === end + (around ? 1 : 0))
        index++;
    }
    const target = enclosing[index];
    if (!target) return;
    let [start, end] = target;
    start += around ? 0 : 1;
    end += around ? 1 : 0;
    if (quote && around) {
      while (end < to && /\s/u.test(this.text[end]!)) end++;
      if (end === target[1] + 1) while (start > from && /\s/u.test(this.text[start - 1]!)) start--;
    }
    this.selectObject(start, end);
  }
  private characterFind(key: string, char: string, count: number, repeated = false) {
    const forward = key === "f" || key === "t";
    const till = key.toLowerCase() === "t";
    let position = this.column;
    for (let i = 0; i < count; i++) {
      const skip = repeated && till && i === 0 ? 2 : 1;
      const next = forward
        ? this.lines[this.line]!.indexOf(char, position + skip)
        : this.lines[this.line]!.lastIndexOf(char, position - skip);
      if (next < 0 || (!forward && position - skip < 0)) return;
      position = next;
    }
    const columns = this.columns();
    const index = floorIndex(columns, position);
    if (till && index >= 0)
      position = columns[Math.max(0, Math.min(columns.length - 1, index + (forward ? -1 : 1)))]!;
    this.jump(this.line, position);
  }
  key(key: string, control = false, halfPage = 10): VimMotion {
    if (key === "Escape") {
      this.clearVisual();
      this.count = "";
      this.prefix = "";
      return { handled: true };
    }
    if (control) {
      if (key !== "d" && key !== "u") return { handled: false };
      const n = Math.min(200000, Number(this.count) || halfPage);
      this.count = "";
      this.prefix = "";
      this.jump(this.line + (key === "d" ? n : -n), this.desired, true);
      return { handled: true };
    }
    if (/^[0-9]$/.test(key) && (key !== "0" || this.count) && !/[fFtTm'`]/.test(this.prefix)) {
      this.count = (this.count + key).slice(0, 6);
      return { handled: true };
    }
    if (
      !this.prefix &&
      ((this.visual && (key === "i" || key === "a")) ||
        ["g", "z", "f", "F", "t", "T", "m", "'", "`"].includes(key))
    ) {
      this.prefix = key;
      return { handled: true };
    }
    const n = Math.min(200000, Number(this.count) || 1);
    const explicit = !!this.count;
    const prefix = this.prefix;
    this.prefix = "";
    this.count = "";
    if (prefix === "i" || prefix === "a") {
      this.textObject(key, prefix === "a", n);
      return { handled: true };
    }
    if (prefix === "m") {
      if (/^[a-z]$/.test(key)) this.marks.set(key, { line: this.line, column: this.column });
      return { handled: true };
    }
    if (prefix === "'" || prefix === "`") {
      const target = key === "'" || key === "`" ? this.previousJump : this.marks.get(key);
      if (target)
        this.jumpTo(
          target.line,
          prefix === "`" ? target.column : Math.max(0, this.lines[target.line]!.search(/\S/)),
        );
      return { handled: true };
    }
    if (["f", "F", "t", "T"].includes(prefix)) {
      if (Array.from(key).length === 1) {
        this.find = { key: prefix, char: key };
        this.characterFind(prefix, key, n);
      }
      return { handled: true };
    }
    if (prefix === "g") {
      if (key === "g") this.jumpTo(explicit ? n - 1 : 0);
      if (key === "d") return { handled: true, definition: this.wordAtCursor() };
      if (key === "c") return { handled: true, annotate: "comment" };
      return { handled: true };
    }
    if (prefix === "z") {
      const align =
        key === "t" ? "start" : key === "z" ? "center" : key === "b" ? "end" : undefined;
      if (align && explicit) this.jumpTo(n - 1, this.desired, true);
      return { handled: true, ...(align ? { align } : {}) };
    }
    if (key === "K" && !control) return { handled: true, hover: this.wordAtCursor() };
    if (key === "v" || key === "V") {
      this.objectRange = null;
      const mode = key === "v" ? "character" : "line";
      if (this.visual?.mode === mode) this.clearVisual();
      else
        this.visual = this.visual
          ? { ...this.visual, mode }
          : { mode, line: this.line, column: this.column };
      return { handled: true };
    }
    if (this.visual && key === "y") return { handled: true, copy: true };
    if (this.visual && key === "o") {
      const anchor = this.visual;
      this.visual = { mode: anchor.mode, line: this.line, column: this.column };
      this.jump(anchor.line, anchor.column);
      return { handled: true };
    }
    if (key === "j" || key === "k")
      this.jump(this.line + (key === "j" ? n : -n), this.desired, true);
    else if (key === "h" || key === "l") {
      const columns = this.columns();
      const index = floorIndex(columns, this.column);
      this.jump(
        this.line,
        columns[Math.max(0, Math.min(columns.length - 1, index + (key === "l" ? n : -n)))]!,
      );
    } else if (["w", "b", "e"].includes(key)) {
      for (let i = 0; i < n; i++) this.word(key);
    } else if (key === "0") this.jump(this.line);
    else if (key === "^") this.jump(this.line, Math.max(0, this.lines[this.line]!.search(/\S/)));
    else if (key === "$" || key === "A") {
      this.jump(this.line + (key === "$" ? n - 1 : 0));
      this.jump(this.line, this.endColumn);
      this.desired = Infinity;
    } else if (key === "G") this.jumpTo(explicit ? n - 1 : this.lines.length - 1);
    else if (key === ":") {
      this.clearVisual();
      return { handled: true, lineCommand: true };
    } else if (key === "{" || key === "}") {
      const direction = key === "}" ? 1 : -1;
      let line = this.line;
      for (let i = 0; i < n; i++) {
        while (
          line + direction >= 0 &&
          line + direction < this.lines.length &&
          this.lines[line] === ""
        )
          line += direction;
        if (line + direction >= 0 && line + direction < this.lines.length) line += direction;
        while (
          line + direction >= 0 &&
          line + direction < this.lines.length &&
          this.lines[line] !== ""
        )
          line += direction;
      }
      this.jumpTo(line);
    } else if (key === ";" || key === ",") {
      if (this.find) {
        const original = this.find.key;
        const opposite =
          original === original.toLowerCase() ? original.toUpperCase() : original.toLowerCase();
        this.characterFind(key === ";" ? original : opposite, this.find.char, n, true);
      }
    } else if (key === "/" || key === "?") return { handled: true, search: key === "/" ? 1 : -1 };
    else if (key === "n" || key === "N")
      this.nextMatch(key === "n" ? this.direction : this.direction === 1 ? -1 : 1, n);
    else if (key === "*" || key === "#") {
      const text = this.lines[this.line]!;
      let start = this.column,
        end = this.column;
      if (!keyword.test(text[start] ?? "")) return { handled: true };
      while (start > 0 && keyword.test(text[start - 1]!)) start--;
      while (end < text.length && keyword.test(text[end]!)) end++;
      return { handled: true, search: key === "*" ? 1 : -1, wordSearch: text.slice(start, end) };
    } else return { handled: false };
    return { handled: true };
  }
}
/** Literal, smart-case search. Offsets are UTF-16, matching browser text ranges. */
export function findVimMatches(text: string, query: string, wholeWord = false): number[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])` : escaped,
    /\p{Lu}/u.test(query) ? "gu" : "giu",
  );
  const matches: number[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push(match.index);
    if (matches.length === MAX_VIM_MATCHES) break;
  }
  return matches;
}
