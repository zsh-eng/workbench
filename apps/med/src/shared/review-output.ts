// Review output in any format (docs/PRACTICES.md#b-read-review-output-from-any-source):
// the user's own skills, `/code-review`, a Codex review, or a GitHub review,
// as Markdown in a version's notes or guide summary. The reader is lenient
// and careful: it takes only explicit headings and tags, and leaves what it
// does not know to the notes, which still show the whole text.

export type FindingSeverity = "important" | "nit" | "pre-existing";
export type FindingState = "open" | "fixed" | "intentional" | "wont-fix";

export interface ReviewFinding {
  severity: FindingSeverity;
  /** The finding's text without its tag, place, and resolution. */
  title: string;
  file?: string;
  line?: number;
  endLine?: number;
  state: FindingState;
  /** Why it was closed, as the text after "Fixed:" and the like. */
  reason?: string;
}

export interface ProofCheck {
  command: string;
  /** What the check said, such as "42 passed". */
  result?: string;
  status: "passed" | "failed" | "unknown";
}

export interface ReviewProof {
  checks: ProofCheck[];
  /** Screenshots and clips: paths or links. */
  media: string[];
  /** What the checks do not cover. */
  misses: string[];
  /** Other lines of the proof section. */
  notes: string[];
}

export interface ReviewOutput {
  proof?: ReviewProof;
  findings: ReviewFinding[];
  /** The counts that the text states, such as "2 Important, 1 Nit, 0 Pre-existing". */
  counts?: { important: number; nit: number; preExisting: number };
  /** The text says there is nothing to fix. */
  nothingToFix?: boolean;
  /** An explanation of the change, in Markdown. */
  explainer?: string;
  /** Paths and globs that the text names as generated files. */
  generated: string[];
}

type Section = "proof" | "misses" | "findings" | "explainer" | "generated" | "other";

const PROOF =
  /^(?:proof|checks?(?: run| ran)?|tests?(?: run| ran)?|testing|verification|verified|validation|evidence|how (?:i|we) (?:tested|verified|checked)(?: it)?|what (?:i|we) ran|commands(?: run| ran)?|test results?|results)\b/i;
const MISSES =
  /^(?:not (?:covered|checked|tested|verified|run)|what (?:the checks?|this|it|they) (?:miss(?:es)?|(?:do(?:es)?n['’]?t|do(?:es)? not) cover)|(?:known )?gaps?|limitations?|untested|open checks|blind spots?|caveats?|not proven)\b/i;
const FINDINGS = /^(?:(?:code |self[- ])?review(?: findings)?|findings?|issues?|problems?)\b/i;
const EXPLAINER =
  /^(?:explainer|explanation|why|what changed|what and why|overview|context|summary|walkthrough|background|motivation|read (?:this )?first|what to read first)\b/i;
const GENERATED = /^generated(?: files)?\b/i;
const SEVERITY_HEADING = /^(important|nits?|pre-?existing)\b/i;

const severityOf = (word: string): FindingSeverity => {
  const lower = word.toLowerCase();
  if (lower.startsWith("nit")) return "nit";
  if (lower.startsWith("pre")) return "pre-existing";
  return "important";
};

/** A heading, a bold line, or a "Label:" line alone: the label, or undefined. */
function headingOf(line: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading) return clean(heading[1]!);
  const bold = /^\*\*([^*]+?):?\*\*:?\s*$/.exec(line.trim());
  if (bold) return clean(bold[1]!);
  const label = /^([A-Z][\w '’-]{1,40}):\s*$/.exec(line.trim());
  return label ? clean(label[1]!) : undefined;
}

/** Text without Markdown emphasis or a trailing colon. */
const clean = (text: string) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/:\s*$/, "")
    .trim();

function sectionOf(label: string): { section: Section; severity?: FindingSeverity } {
  const severity = SEVERITY_HEADING.exec(label);
  if (severity) return { section: "findings", severity: severityOf(severity[1]!) };
  if (MISSES.test(label)) return { section: "misses" };
  if (GENERATED.test(label)) return { section: "generated" };
  if (PROOF.test(label)) return { section: "proof" };
  if (FINDINGS.test(label)) return { section: "findings" };
  if (EXPLAINER.test(label)) return { section: "explainer" };
  return { section: "other" };
}

interface Item {
  text: string;
  children: string[];
  checked?: boolean;
}

const MEDIA = /(?:[\w./~-]+\/)?[\w.-]+\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v)\b/gi;
/** A line that names media as proof, such as "Screenshot: shots/a.png". */
const MEDIA_LINE =
  /^\W*(?:screenshots?|screen ?shots?|clips?|videos?|recordings?|screen recordings?|media|gifs?)\b[^:]{0,40}:/i;
const LOCATION =
  /(?:^|[\s(`["*])((?:[\w@.+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z][\w]*)(?::(\d+)(?:[-–](\d+))?|#L(\d+)(?:-L?(\d+))?)/;
const PATH_ONLY = /`((?:[\w@.+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z][\w]*)`/;
const TAG =
  /(?:\[(important|nit|pre-?existing|p[0-3])\]|\*\*(important|nit|pre-?existing)\*\*:?|^\(?(important|nit|pre-?existing)\)?\s*(?:[:—–-]|\s(?=\S)))/i;
// A resolution is a marker, not a word in a sentence: it starts the text or a
// sentence, follows a dash or a bracket, and ends at a colon, a dash, a full
// stop, or the end. "This must be fixed" and "a fixed seed" stay open.
const RESOLUTION =
  /(^[\s>*_[(]*|[.;!?)]\s+|\s[—–-]\s*|[([]\s*)(?:\*\*|_)?(fixed|addressed|intentional|won['’]?t fix|wont fix|will not fix|not fixing)(?:\*\*|_|\])?(?=\s*(?:[:—–(.,)\]-]|$)|\s+(?:in|by|with|as)\b)\s*(?:[:—–-]\s*|\(\s*|\.\s*)?([^)\n]*)\)?/i;
/** A bold or bracketed resolution that leads the item: "**Fixed** src/a.ts:3 …". */
const LEADING_RESOLUTION =
  /^[\s>]*(?:\*\*|\[)(fixed|addressed|intentional|won['’]?t fix|wont fix|will not fix|not fixing)(?:\*\*|\])\s*:?\s*/i;

const stateOf = (word: string): FindingState => {
  const lower = word.toLowerCase();
  if (lower.startsWith("fixed") || lower.startsWith("addressed")) return "fixed";
  if (lower.startsWith("intentional")) return "intentional";
  return "wont-fix";
};

/** A finding from a list item or a line, or undefined when it has no tag. */
function findingOf(item: Item, fallback?: FindingSeverity): ReviewFinding | undefined {
  let text = item.text.trim();
  const tag = TAG.exec(text);
  let severity = fallback;
  if (tag) {
    const word = (tag[1] ?? tag[2] ?? tag[3])!.toLowerCase();
    // Codex: P0 and P1 must be fixed; P2 and P3 are nits.
    severity = /^p[01]$/.test(word) ? "important" : /^p[23]$/.test(word) ? "nit" : severityOf(word);
    text = (text.slice(0, tag.index) + text.slice(tag.index + tag[0].length)).trim();
  }
  if (!severity) return undefined;
  let state: FindingState = "open";
  let reason: string | undefined;
  const leading = LEADING_RESOLUTION.exec(text);
  if (leading) {
    state = stateOf(leading[1]!);
    text = text.slice(leading[0].length);
  } else
    for (const part of [text, ...item.children]) {
      const resolved = RESOLUTION.exec(part);
      if (!resolved) continue;
      state = stateOf(resolved[2]!);
      reason = clean(resolved[3] ?? "").replace(/^[—–-]\s*/, "") || undefined;
      // The sentence before keeps its full stop.
      if (part === text)
        text = text
          .slice(0, resolved.index + (/^[.;!?)]/.exec(resolved[1]!)?.[0].length ?? 0))
          .trim();
      break;
    }
  if (state === "open" && item.checked) state = "fixed";
  let file: string | undefined;
  let line: number | undefined;
  let endLine: number | undefined;
  const spaced = ` ${text}`;
  const place = LOCATION.exec(spaced);
  if (place) {
    file = place[1];
    line = Number(place[2] ?? place[4]);
    const end = Number(place[3] ?? place[5]);
    if (Number.isFinite(end) && end >= line) endLine = end;
    // The place goes with the marks around it, such as **src/a.ts:3** or `src/a.ts:3`.
    let from = place.index + place[0].indexOf(place[1]!);
    let to = place.index + place[0].length;
    while (from > 0 && '`*[("'.includes(spaced[from - 1]!)) from--;
    while (to < spaced.length && '`*])"'.includes(spaced[to]!)) to++;
    text = `${spaced.slice(0, from)} ${spaced.slice(to)}`.trim();
  } else {
    const path = PATH_ONLY.exec(text);
    if (path) file = path[1];
  }
  const title = clean(
    clean(text)
      .replace(/^[\s:—–-]+|[\s:—–-]+$/g, "")
      .replace(/\s{2,}/g, " "),
  );
  return {
    severity,
    title: (title || "(no text)").slice(0, 400),
    ...(file && { file: file.replace(/^\.\//, "") }),
    ...(line && Number.isFinite(line) && { line }),
    ...(endLine && { endLine }),
    state,
    ...(reason && state !== "open" && { reason: reason.slice(0, 400) }),
  };
}

const PASSED =
  /(?:✓|✔|✅|\b0 (?:fail(?:ed|ures?|s)?|errors?)\b|\bpass(?:ed|es|ing)?\b|\bok\b|\bgreen\b|\bsucceed(?:ed|s)?\b|\bclean\b|\bexit(?:ed)?(?: code| status)?:? 0\b|\bno (?:errors?|warnings?|issues?)\b)/i;
const FAILED =
  /(?:✗|✘|❌|\b[1-9]\d* (?:fail(?:ed|ures?|s)?|errors?)\b|\bfail(?:ed|s|ing|ure)?\b|\berror\b|\bred\b|\bbroken\b|\bexit(?:ed)?(?: code| status)?:? [1-9]\d*\b)/i;
/** A result that says it failed, not "0 failed" or "no errors". */
const failedText = (text: string) =>
  FAILED.test(text.replace(/\b(?:0|no) (?:fail(?:ed|ures?|s)?|errors?)\b/gi, ""));

/** A result without the parentheses that hold all of it, as in "(42 passed)".
 * Parentheses inside it stay: "633 passed (106 files)". */
function unwrap(text: string) {
  // A parenthesis without its pair goes: "(42 passed".
  if (!text.includes(")")) return text.replace(/^\(\s*/, "");
  if (!text.includes("(")) return text.replace(/\s*\)$/, "");
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  for (let index = 0; index < text.length - 1; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")") depth--;
    // The first parenthesis closes before the end: "(a) and (b)".
    if (depth === 0) return text;
  }
  return text.slice(1, -1).trim();
}

/** A check from a proof item: a command in backticks or after `$`, then its result. */
function checkOf(text: string): ProofCheck | undefined {
  const quoted = /`([^`]+)`/.exec(text);
  const shell = /^\$\s+(.+?)(?:\s+(?:[→:—–]|->)\s+(.+))?$/.exec(text.trim());
  const command = quoted?.[1]?.trim() ?? shell?.[1]?.trim();
  if (!command || MEDIA.test(command)) {
    MEDIA.lastIndex = 0;
    return undefined;
  }
  MEDIA.lastIndex = 0;
  const rest = quoted
    ? text.slice(0, quoted.index) + text.slice(quoted.index + quoted[0].length)
    : (shell?.[2] ?? "");
  const result = clean(unwrap(rest.replace(/^[\s:—–→>-]+|[\s:—–-]+$/g, "").replace(/^-?>\s*/, "")));
  const status = failedText(result) ? "failed" : PASSED.test(result) ? "passed" : "unknown";
  return {
    command: command.slice(0, 300),
    ...(result && { result: result.slice(0, 300) }),
    status,
  };
}

/** Lines into list items with their nested lines, and the other lines. */
function walk(lines: readonly string[]) {
  const blocks: ({ kind: "item"; item: Item } | { kind: "line"; text: string })[] = [];
  let current: { item: Item; indent: number } | undefined;
  for (const raw of lines) {
    const list = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(raw);
    if (list) {
      const indent = list[1]!.length;
      if (current && indent > current.indent) {
        current.item.children.push(list[3]!);
        continue;
      }
      const item: Item = { text: list[3]!, children: [] };
      if (list[2]) item.checked = list[2].toLowerCase() === "x";
      current = { item, indent };
      blocks.push({ kind: "item", item });
      continue;
    }
    if (!raw.trim()) {
      current = undefined;
      continue;
    }
    // A wrapped line of an item continues it.
    if (current && /^\s+\S/.test(raw)) {
      current.item.text += ` ${raw.trim()}`;
      continue;
    }
    current = undefined;
    blocks.push({ kind: "line", text: raw });
  }
  return blocks;
}

/** Paths and globs from a line such as "Generated: `src/api/**`, `*.pb.ts`". */
function globsOf(text: string) {
  const quoted = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim());
  const words = quoted.length
    ? quoted
    : text
        .split(/[,;]\s*|\s+/)
        .map((word) => word.trim())
        .filter((word) => /[/*.]/.test(word) && !/\s/.test(word));
  return words.filter((word) => word && word.length <= 1024 && !/^https?:/.test(word));
}

/** Reads one text. */
function readOne(text: string): ReviewOutput {
  const output: ReviewOutput = { findings: [], generated: [] };
  const proof: ReviewProof = { checks: [], media: [], misses: [], notes: [] };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Sections, with fenced code kept apart: a fence in a proof section holds commands.
  const sections: { section: Section; severity?: FindingSeverity; lines: string[] }[] = [
    { section: "other", lines: [] },
  ];
  let fence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fence = !fence;
      sections.at(-1)!.lines.push(line);
      continue;
    }
    const label = fence ? undefined : headingOf(line);
    if (label !== undefined) {
      sections.push({ ...sectionOf(label), lines: [] });
      continue;
    }
    sections.at(-1)!.lines.push(line);
  }
  const explainer: string[] = [];
  for (const [index, { section, severity, lines: body }] of sections.entries()) {
    const inFence: string[] = [];
    const outFence: string[] = [];
    let open = false;
    for (const line of body) {
      if (/^\s*(?:```|~~~)/.test(line)) {
        open = !open;
        continue;
      }
      (open ? inFence : outFence).push(line);
    }
    if (section === "explainer" || (index === 0 && section === "other")) {
      const prose = body.join("\n").trim();
      // The first text before any section is an explainer when it is prose.
      if (section === "explainer" || (prose.length >= 60 && !/^[-*+\d]/.test(prose)))
        explainer.push(prose);
    }
    for (const block of walk(outFence)) {
      const item: Item =
        block.kind === "item" ? block.item : { text: block.text.trim(), children: [] };
      const counts = /(\d+)\s+important\b[^\n]*?(\d+)\s+nits?\b[^\n]*?(\d+)\s+pre-?existing/i.exec(
        item.text,
      );
      if (counts) {
        output.counts = {
          important: Number(counts[1]),
          nit: Number(counts[2]),
          preExisting: Number(counts[3]),
        };
        continue;
      }
      if (/^\W*nothing to fix\b/i.test(item.text)) {
        output.nothingToFix = true;
        continue;
      }
      if (section === "generated" || /^generated(?: files)?:\s*\S/i.test(item.text)) {
        output.generated.push(...globsOf(item.text.replace(/^generated(?: files)?:/i, "")));
        continue;
      }
      const finding =
        block.kind === "item" || section === "findings" || TAG.test(item.text)
          ? findingOf(item, section === "findings" ? severity : undefined)
          : undefined;
      if (finding && (section !== "proof" || TAG.test(item.text))) {
        output.findings.push(finding);
        continue;
      }
      const missing = /^(?:not covered|misses|gaps?|untested|not checked|not tested):\s*(.+)/i.exec(
        item.text,
      );
      if (section === "misses" || (section === "proof" && missing)) {
        proof.misses.push(clean(missing?.[1] ?? item.text));
        continue;
      }
      if (section !== "proof") continue;
      const check = checkOf(item.text);
      if (check) proof.checks.push(check);
      else if (!(item.text.match(MEDIA) ?? []).length && item.text) proof.notes.push(item.text);
    }
    // Commands in a fence of a proof section: `$ command`, then its output.
    if (section === "proof") {
      let last: ProofCheck | undefined;
      for (const line of inFence) {
        const command = /^\s*\$\s+(.+)$/.exec(line);
        if (command) {
          last = { command: command[1]!.trim().slice(0, 300), status: "unknown" };
          proof.checks.push(last);
        } else if (last && line.trim()) {
          if (failedText(line)) last.status = "failed";
          else if (last.status === "unknown" && PASSED.test(line)) last.status = "passed";
          if (/\d+ (?:pass|passed|tests?|fail)/i.test(line))
            last.result ??= line.trim().slice(0, 300);
        }
      }
    }
  }
  // Media: screenshots and clips in a proof section, or on a line that names
  // them as such anywhere. An image in an explanation is not proof.
  const shown = sections.flatMap(({ section, lines: body }) =>
    section === "proof" ? body : body.filter((line) => MEDIA_LINE.test(line)),
  );
  for (const match of shown.join("\n").matchAll(MEDIA)) {
    const path = match[0];
    if (!proof.media.includes(path)) proof.media.push(path);
  }
  if (proof.checks.length || proof.media.length || proof.misses.length || proof.notes.length)
    output.proof = proof;
  if (explainer.length) output.explainer = explainer.join("\n\n").trim();
  return output;
}

/** Reads review output from several texts, such as a brief, its pins, and a guide summary. */
export function readReviewOutput(texts: readonly (string | undefined)[]): ReviewOutput {
  const all: ReviewOutput = { findings: [], generated: [] };
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text?.trim()) continue;
    const one = readOne(text);
    if (one.proof) {
      const proof = (all.proof ??= { checks: [], media: [], misses: [], notes: [] });
      proof.checks.push(...one.proof.checks);
      proof.media.push(...one.proof.media.filter((path) => !proof.media.includes(path)));
      proof.misses.push(...one.proof.misses);
      proof.notes.push(...one.proof.notes);
    }
    for (const finding of one.findings) {
      const key = `${finding.severity}\0${finding.file ?? ""}\0${finding.line ?? ""}\0${finding.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.findings.push(finding);
    }
    if (one.counts) all.counts = one.counts;
    if (one.nothingToFix) all.nothingToFix = true;
    if (one.explainer)
      all.explainer = all.explainer ? `${all.explainer}\n\n${one.explainer}` : one.explainer;
    for (const glob of one.generated) if (!all.generated.includes(glob)) all.generated.push(glob);
  }
  return all;
}

/** Whether a finding still needs work: an open Important or Nit. */
export const isOpenFinding = (finding: ReviewFinding) =>
  finding.state === "open" && finding.severity !== "pre-existing";
