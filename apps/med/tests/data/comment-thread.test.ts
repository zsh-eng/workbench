import { expect, test } from "vitest";
import { lastSaid } from "../../src/shared/comment-thread";

const claude = { agent: "claude" as const };

test("a comment that no agent answered is the comment and the user's own replies", () => {
  expect(lastSaid({ text: "Rename this." }, [])).toEqual({ text: "Rename this." });
  expect(lastSaid({ text: "Rename this." }, [{ text: "And its test." }])).toEqual({
    text: "Rename this.\n\nAnd its test.",
  });
});

test("a reply after an agent's answer is the reply, with the answer it replies to", () => {
  expect(
    lastSaid({ text: "Rename this." }, [
      { text: "Renamed to tidesAt.", author: claude },
      { text: "Use tideTimes." },
      { text: "Also in the docs." },
    ]),
  ).toEqual({
    text: "Use tideTimes.\n\nAlso in the docs.",
    inReplyTo: { author: "Claude", text: "Renamed to tidesAt." },
  });
});

test("a thread whose answer came last, as after the user edited the comment, is the comment", () => {
  expect(
    lastSaid({ text: "Rename this, please." }, [{ text: "Renamed.", author: claude }]),
  ).toEqual({ text: "Rename this, please." });
});
