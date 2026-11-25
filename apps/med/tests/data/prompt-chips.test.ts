import { expect, test } from "vitest";
import { threadReference } from "../../src/web/data/mentions";
import type { SessionItem } from "../../src/web/data/session-store";
import {
  decorateChips,
  matchChips,
  protectChips,
  quotedItem,
  splitChips,
  withoutChips,
} from "../../src/web/components/session/prompt-chips";

const thread = threadReference({ id: "claude-1234", title: "Tide “model”\nnotes" });

test("a prompt's quotes and threads are chips, in order, and its paths stay text", () => {
  const text = `About <quote>Kept the station's time</quote>, see ${thread} and /repo/src/tide.ts:42.`;
  expect(matchChips(text).map(({ chip }) => chip)).toEqual([
    { kind: "quote", text: "Kept the station's time", label: "Kept the station's time" },
    // The title loses its own curly quotes, which would end the reference.
    { kind: "thread", id: "claude-1234", label: "Tide model notes" },
  ]);
  // A path is a file reference's, which FileRefs links.
  expect(withoutChips(text)).toBe("About  , see   and /repo/src/tide.ts:42.");
  expect(splitChips("plain words")).toEqual([{ kind: "text", text: "plain words" }]);
});

test("Markdown reads chips as tokens, and they come back as buttons", () => {
  const { text, chips } = protectChips(`**Read** ${thread} and <quote>a & b</quote>`);
  expect(text).toBe("**Read** MEDPROMPTCHIP0END and MEDPROMPTCHIP1END");
  const [block] = decorateChips(
    [{ html: `<p><strong>Read</strong> MEDPROMPTCHIP0END and MEDPROMPTCHIP1END</p>` }],
    chips,
  );
  expect(block!.html).toContain(
    '<button type="button" class="med-chip" data-chip="thread" data-thread="claude-1234" title="Thread: Tide model notes">',
  );
  expect(block!.html).toContain('data-chip="quote" data-quote="a &amp; b" title="a &amp; b"');
  expect(block!.html).toContain('<span class="med-chip-label">Tide model notes</span>');
  // A prompt that holds the token's text already gets another prefix.
  expect(protectChips("MEDPROMPTCHIP <quote>a b</quote>").text).toBe(
    "MEDPROMPTCHIP MEDPROMPTCHIPX0END",
  );
});

test("a quote opens the message it came from: the newest before its prompt", () => {
  const items: SessionItem[] = [
    { kind: "agent", id: "a1", at: 1, text: "Kept the **station's** own time,\nand wrote a test." },
    { kind: "agent", id: "a2", at: 2, text: "- [Kept](x) the station's own time again" },
    {
      kind: "user",
      id: "u1",
      at: 3,
      content: [{ type: "text", text: "<quote>Kept the station's own time, and</quote> why?" }],
    },
    { kind: "agent", id: "a3", at: 4, text: "Kept the station's own time, and more." },
  ];
  expect(quotedItem(items, "Kept the station's own time, and", "u1")?.id).toBe("a1");
  expect(quotedItem(items, "Kept the station's own time again", "u1")?.id).toBe("a2");
  expect(quotedItem(items, "nowhere", "u1")).toBeUndefined();
});
