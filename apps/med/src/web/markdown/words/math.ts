// Normalizes LaTeX math delimiters before Pierre Words parses Markdown:
// - Converts \(...\) inline math and \[...\] display math to $$ delimiters.
// - Preserves exact source line count so preview scroll-sync line maps stay exact.
// - Records single-line standalone $$...$$ / \[...\] lines for display promotion.
// - Optionally promotes unambiguous single-dollar $...$ inline math (smartDollars)
//   for session threads without false-matching currency ($10-$20) or shell vars ($HOME/$USER).

export interface PreparedMath {
  text: string;
  /** 1-based source lines containing standalone single-line display math. */
  displayLines: Set<number>;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DISPLAY_OPEN_DOLLAR = /^(\s*)\$\$\s*$/;
const DISPLAY_OPEN_BRACKET = /^(\s*)\\\[\s*$/;
const DISPLAY_CLOSE_BRACKET = /^(\s*)\\\]\s*$/;
const SINGLE_LINE_DOLLAR = /^(\s*)\$\$(.+?)\$\$\s*$/;
const SINGLE_LINE_BRACKET = /^(\s*)\\\[(.+?)\\\]\s*$/;
const MATH_SIGNAL = /[\\^_=<>+\-*/|{}()[\]]/;
const CURRENCY_START = /^\d[\d,.]*(?:[kKmMbB%])?(?:\s|$)/;
const SHELL_VAR_PREFIX = /^[A-Z_][A-Z0-9_]*(?:[/:\-.]|$)/;
const WORD_CHAR = /[A-Za-z0-9_]/;

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function isLikelyInlineMath(body: string): boolean {
  if (!body || /^\s|\s$/.test(body)) return false;
  // Reject currency ranges like $10 and $20 or $100 unless math syntax is present ($10^6$, $2\pi r$).
  if (CURRENCY_START.test(body) && !/[\\^_=<>]/.test(body)) return false;
  // Reject shell path/var fragments like $HOME/$USER or $PATH:$HOME.
  if (SHELL_VAR_PREFIX.test(body) && !/[\\^_=<>+\s]/.test(body)) return false;
  // Single identifier ($n$, $x$, $\alpha$) or expression with math operators.
  if (/^[A-Za-z]$/.test(body)) return true;
  if (MATH_SIGNAL.test(body)) return true;
  // Multi-letter single token without math symbols (e.g. $HOME$, $foo$) is usually not math.
  return false;
}

/** Transforms inline \(...\) and optional unambiguous $...$ outside inline code spans. */
function transformInlineLine(line: string, smartDollars: boolean): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    // Skip inline code spans (`...` or ``...``).
    if (line[i] === "`") {
      let ticks = 1;
      while (line[i + ticks] === "`") ticks++;
      const delim = "`".repeat(ticks);
      const end = line.indexOf(delim, i + ticks);
      if (end >= 0) {
        out += line.slice(i, end + ticks);
        i = end + ticks;
        continue;
      }
      out += delim;
      i += ticks;
      continue;
    }

    // Preserve existing $$...$$ inline math spans intact.
    if (line[i] === "$" && line[i + 1] === "$" && !isEscaped(line, i)) {
      let close = i + 2;
      while (close < line.length) {
        const next = line.indexOf("$$", close);
        if (next < 0) break;
        if (!isEscaped(line, next)) {
          out += line.slice(i, next + 2);
          i = next + 2;
          close = -1;
          break;
        }
        close = next + 2;
      }
      if (close < 0) continue;
      out += "$$";
      i += 2;
      continue;
    }

    // Convert \(...\) inline math to $$...$$.
    if (line[i] === "\\" && line[i + 1] === "(" && !isEscaped(line, i)) {
      let close = i + 2;
      let found = -1;
      while (close < line.length) {
        const next = line.indexOf("\\)", close);
        if (next < 0) break;
        if (!isEscaped(line, next)) {
          found = next;
          break;
        }
        close = next + 2;
      }
      if (found > i + 2) {
        const inner = line.slice(i + 2, found).trim();
        if (inner) {
          out += `$$${inner}$$`;
          i = found + 2;
          continue;
        }
      }
    }

    // Convert inline \[...\] (when embedded mid-line) to $$...$$.
    if (line[i] === "\\" && line[i + 1] === "[" && !isEscaped(line, i)) {
      let close = i + 2;
      let found = -1;
      while (close < line.length) {
        const next = line.indexOf("\\]", close);
        if (next < 0) break;
        if (!isEscaped(line, next)) {
          found = next;
          break;
        }
        close = next + 2;
      }
      if (found > i + 2) {
        const inner = line.slice(i + 2, found).trim();
        if (inner) {
          out += `$$${inner}$$`;
          i = found + 2;
          continue;
        }
      }
    }

    // Optional safe single-dollar $...$ promotion for session threads.
    if (
      smartDollars &&
      line[i] === "$" &&
      line[i + 1] !== "$" &&
      !isEscaped(line, i) &&
      (i === 0 || !WORD_CHAR.test(line[i - 1]!)) &&
      i + 1 < line.length &&
      !/\s/.test(line[i + 1]!)
    ) {
      let close = i + 1;
      let found = -1;
      while (close < line.length) {
        if (line[close] === "`") break;
        if (line[close] === "$" && !isEscaped(line, close)) {
          // A $$ inside is not a closing single $.
          if (line[close + 1] === "$") break;
          const prevChar = line[close - 1] ?? "";
          const nextChar = line[close + 1] ?? "";
          if (!/\s/.test(prevChar) && (!nextChar || !WORD_CHAR.test(nextChar))) {
            found = close;
            break;
          }
          // If the next $ is immediately followed by a digit/word (e.g. $10-$20, $HOME/$USER),
          // this opening $ is currency or a shell variable, not math.
          break;
        }
        close++;
      }
      if (found > i + 1) {
        const body = line.slice(i + 1, found);
        if (isLikelyInlineMath(body)) {
          out += `$$${body}$$`;
          i = found + 1;
          continue;
        }
      }
    }

    out += line[i]!;
    i++;
  }
  return out;
}

export function prepareMath(
  text: string,
  { smartDollars = false }: { smartDollars?: boolean } = {},
): PreparedMath {
  const displayLines = new Set<number>();
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) {
    return { text, displayLines };
  }

  const lines = text.split("\n");
  let fence: string | undefined;
  let mathBlock: "$$" | "\\[" | undefined;
  let addedLines = 0;
  const result = new Array<string>(lines.length);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineNumber = idx + 1 + addedLines;

    if (fence) {
      result[idx] = line;
      const close = FENCE_RE.exec(line)?.[1];
      if (
        close &&
        close[0] === fence[0] &&
        close.length >= fence.length &&
        !line.trim().slice(close.length)
      ) {
        fence = undefined;
      }
      continue;
    }

    if (mathBlock) {
      if (mathBlock === "$$" && DISPLAY_OPEN_DOLLAR.test(line)) {
        mathBlock = undefined;
        result[idx] = line;
        continue;
      }
      if (mathBlock === "\\[") {
        const closeMatch = DISPLAY_CLOSE_BRACKET.exec(line);
        if (closeMatch) {
          mathBlock = undefined;
          result[idx] = `${closeMatch[1]}$$`;
          continue;
        }
        // When `\]` shares the last content line of a multiline `\[` block,
        // put the closing `$$` on the next line and track the added line offset
        // so downstream `displayLines` stay aligned with Words' line numbers.
        const trimmedEnd = line.trimEnd();
        if (trimmedEnd.endsWith("\\]") && !isEscaped(trimmedEnd, trimmedEnd.length - 2)) {
          mathBlock = undefined;
          const before = trimmedEnd.slice(0, -2).trimEnd();
          if (before) {
            result[idx] = `${before}\n$$`;
            addedLines += 1;
          } else {
            result[idx] = "$$";
          }
          continue;
        }
      }
      // Blank lines inside a display math block break Words' $$ parser; a TeX comment keeps the block and line count intact.
      result[idx] = line.trim() ? line : "%";
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      fence = fenceMatch[1];
      result[idx] = line;
      continue;
    }

    const dollarOpen = DISPLAY_OPEN_DOLLAR.exec(line);
    if (dollarOpen) {
      mathBlock = "$$";
      result[idx] = line;
      continue;
    }

    const bracketOpen = DISPLAY_OPEN_BRACKET.exec(line);
    if (bracketOpen) {
      mathBlock = "\\[";
      result[idx] = `${bracketOpen[1]}$$`;
      continue;
    }

    const singleDollar = SINGLE_LINE_DOLLAR.exec(line);
    if (singleDollar && singleDollar[2]!.trim() && !singleDollar[2]!.includes("$$")) {
      displayLines.add(lineNumber);
      result[idx] = line;
      continue;
    }

    const singleBracket = SINGLE_LINE_BRACKET.exec(line);
    if (singleBracket && singleBracket[2]!.trim() && !singleBracket[2]!.includes("\\]")) {
      displayLines.add(lineNumber);
      result[idx] = `${singleBracket[1]}$$${singleBracket[2]!.trim()}$$`;
      continue;
    }

    result[idx] = transformInlineLine(line, smartDollars);
  }

  return { text: result.join("\n"), displayLines };
}

/** True when text contains LaTeX math worth rendering through the Markdown worker. */
export function hasMathSyntax(text: string): boolean {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) return false;
  const prepared = prepareMath(text, { smartDollars: true });
  if (prepared.displayLines.size > 0) return true;
  if (prepared.text !== text) return true;
  // Detect explicit $$...$$ inline or multiline blocks outside code fences.
  return /(?:^|\n)\s*\$\$\s*(?:\n|$)|\$\$[^$\n]+\$\$/.test(prepared.text);
}
