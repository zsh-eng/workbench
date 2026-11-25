import { createContext } from "react";
import type { SessionItem } from "../../data/session-store";
import { iconMarkup } from "../Icon";
import { threadMentionPattern } from "../../data/mentions";
import { decodeInlineQuote, quotePreview } from "./reply-quote";

// What a sent prompt names, shown as chips in its text (chips.css): a
// passage that the user quoted (`<quote>…</quote>`), and a thread that @
// named (threadReference). Each chip opens what it names: the message that
// the quote came from, or the thread. The message box draws the same chips.
// A file's path is a file reference (FileRefs.tsx), which looks the same.

export type PromptChip =
  | { kind: "quote"; text: string; label: string }
  | { kind: "thread"; id: string; label: string };

export type ChipSegment = { kind: "text"; text: string } | { kind: "chip"; chip: PromptChip };

const QUOTE = /<quote>([\s\S]*?)<\/quote>/g;
/** The chips of a text, in order, without overlaps. */
export function matchChips(text: string) {
  const found: { from: number; to: number; chip: PromptChip }[] = [];
  if (text.includes("<quote>"))
    for (const match of text.matchAll(QUOTE)) {
      const full = decodeInlineQuote(match[1] ?? "");
      if (full)
        found.push({
          from: match.index,
          to: match.index + match[0].length,
          chip: { kind: "quote", text: full, label: quotePreview(full) },
        });
    }
  if (text.includes("med thread read"))
    for (const match of text.matchAll(threadMentionPattern))
      found.push({
        from: match.index,
        to: match.index + match[0].length,
        chip: { kind: "thread", id: match[2]!, label: match[1]!.trim() },
      });
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: typeof found = [];
  for (const entry of found) if (!kept.length || entry.from >= kept.at(-1)!.to) kept.push(entry);
  return kept;
}

/** The text as plain parts and chips. */
export function splitChips(text: string): ChipSegment[] {
  const segments: ChipSegment[] = [];
  let at = 0;
  for (const { from, to, chip } of matchChips(text)) {
    if (from > at) segments.push({ kind: "text", text: text.slice(at, from) });
    segments.push({ kind: "chip", chip });
    at = to;
  }
  if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
  return segments;
}

/** Text without its chips, to ask whether the rest is Markdown. */
export const withoutChips = (text: string) =>
  splitChips(text)
    .map((segment) => (segment.kind === "text" ? segment.text : " "))
    .join("");

/** Chips as plain tokens, before Markdown reads the text, so that it neither
 * drops a quote's tags nor reads inside one; decorateChips puts them back. */
export function protectChips(text: string) {
  const chips = new Map<string, PromptChip>();
  let prefix = "MEDPROMPTCHIP";
  while (text.includes(prefix)) prefix += "X";
  let out = "";
  let at = 0;
  for (const [index, { from, to, chip }] of matchChips(text).entries()) {
    const token = `${prefix}${index}END`;
    chips.set(token, chip);
    out += text.slice(at, from) + token;
    at = to;
  }
  return { text: out + text.slice(at), chips };
}

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Med's drawn quote mark, as Icon draws it, for markup. */
export const QUOTE_ICON =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.25 4.25 2.75 7.75l3.5 3.5M3.25 7.75h6.25a3.75 3.75 0 0 1 3.75 3.75v1"/></svg>';

/** The icon of a chip, as markup. */
export function chipIcon(chip: PromptChip) {
  return chip.kind === "quote" ? QUOTE_ICON : iconMarkup("sessions", 12);
}

/** What a chip says to a screen reader and in its tooltip. */
export function chipTitle(chip: PromptChip) {
  return chip.kind === "quote" ? chip.text : `Thread: ${chip.label}`;
}

/** A chip as markup, for a prompt that Markdown renders. A click opens what
 * it names (chipClick). */
export function chipHtml(chip: PromptChip) {
  const data =
    chip.kind === "quote"
      ? `data-chip="quote" data-quote="${escape(chip.text)}"`
      : `data-chip="thread" data-thread="${escape(chip.id)}"`;
  return `<button type="button" class="med-chip" ${data} title="${escape(chipTitle(chip))}"><span class="med-chip-icon">${chipIcon(chip)}</span><span class="med-chip-label">${escape(chip.label)}</span></button>`;
}

/** Puts the chips back into rendered blocks' markup. */
export function decorateChips<Block extends { html: string }>(
  blocks: readonly Block[],
  chips: ReadonlyMap<string, PromptChip>,
): Block[] {
  return blocks.map((block) => {
    let html = block.html;
    for (const [token, chip] of chips)
      if (html.includes(token)) html = html.replaceAll(token, chipHtml(chip));
    return html === block.html ? block : { ...block, html };
  });
}

/** What a click on a chip in a prompt opens. */
export interface ChipActions {
  /** A quote in the prompt `from`: what it quoted came before it. */
  onQuote?(text: string, from: string): void;
  onThread?(id: string): void;
}

/** What a click on a prompt's chip opens: the quoted message or the thread
 * (SessionPanel). */
export const ChipActionsContext = createContext<ChipActions>({});

/** A click in a prompt's text: the chip that it was on opens what it names. */
export function chipClick(target: EventTarget | null, actions: ChipActions, prompt: string) {
  const chip = target instanceof Element ? target.closest<HTMLElement>("[data-chip]") : null;
  if (!chip) return false;
  const { chip: kind, quote, thread } = chip.dataset;
  if (kind === "quote" && quote) actions.onQuote?.(quote, prompt);
  else if (kind === "thread" && thread) actions.onThread?.(thread);
  else return false;
  return true;
}

/** Text as a reader sees it once Markdown renders it, to find a quote,
 * which the user selected from the rendered text: no syntax, one space
 * between words. */
function readable(text: string) {
  return text
    .replace(QUOTE, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The message that a quote in the prompt `from` came from: the newest
 * reply or prompt before it that holds the quote. */
export function quotedItem(items: readonly SessionItem[], quote: string, from: string) {
  const whole = readable(quote);
  if (!whole) return undefined;
  const before = items.findIndex((item) => item.id === from);
  for (const length of [80, 32]) {
    const start = whole.slice(0, length);
    for (let index = (before < 0 ? items.length : before) - 1; index >= 0; index -= 1) {
      const item = items[index]!;
      const text =
        item.kind === "agent"
          ? item.text
          : item.kind === "user"
            ? item.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")
            : undefined;
      if (text && readable(text).includes(start)) return item;
    }
  }
  return undefined;
}
