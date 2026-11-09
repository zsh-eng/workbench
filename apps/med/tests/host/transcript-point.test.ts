import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptPoint } from "../../src/host/agent-transcripts";
import { claudeModelValue } from "../../src/host/owned-sessions";
import { removeFolder } from "./remove-folder";

// What Med reads from a Claude Code transcript to resume or fork a session as
// it ran: the model and effort of the last reply up to a point, and where the
// point's line ends.

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
});

const reply = (uuid: string, requestedModel: string, effort: string, text = "Done.") => ({
  type: "assistant",
  uuid,
  requestedModel,
  effort,
  message: { role: "assistant", model: requestedModel, content: [{ type: "text", text }] },
});

async function transcript(entries: object[]) {
  const directory = await mkdtemp(join(tmpdir(), "med transcript point "));
  directories.push(directory);
  const path = join(directory, "session.jsonl");
  await writeFile(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return path;
}

test("the point of a message is its line's end, with the last reply's model and effort there", async () => {
  // A line longer than a read's block between the points, so the reads join
  // a line across blocks; and text past ASCII, whose bytes count.
  const long = "é".repeat(5 * 1024 * 1024);
  const path = await transcript([
    { type: "user", uuid: "u1", message: { role: "user", content: "Start." } },
    reply("a1", "claude-opus-5-5", "high", "Ünïcode first."),
    { type: "user", uuid: "u2", message: { role: "user", content: long } },
    // A subagent's line and an API error's do not count.
    { ...reply("s1", "claude-haiku-5-5", "low"), isSidechain: true },
    reply("e1", "<synthetic>", ""),
    reply("a2", "claude-sonnet-5-5", "xhigh"),
  ]);
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  const endOf = (index: number) => Buffer.byteLength(lines.slice(0, index + 1).join("\n")) + 1;

  expect(await transcriptPoint(path, "a1")).toEqual({
    end: endOf(1),
    model: "claude-opus-5-5",
    effort: "high",
  });
  // The prompt after a reply: the reply before it gives the choices.
  expect(await transcriptPoint(path, "u2")).toEqual({
    end: endOf(2),
    model: "claude-opus-5-5",
    effort: "high",
  });
  // Without a message, the transcript's end and its last reply.
  expect(await transcriptPoint(path)).toEqual({
    end: Buffer.byteLength(text),
    model: "claude-sonnet-5-5",
    effort: "xhigh",
  });
  expect(await transcriptPoint(path, "u1")).toEqual({ end: endOf(0) });
  expect(await transcriptPoint(path, "missing")).toBeUndefined();
});

test("a model's ID shows as the model that Claude Code names for it, or stays as it is", () => {
  const models = [
    { value: "default", displayName: "Default (recommended)" },
    { value: "opus", displayName: "Opus 5.5" },
    { value: "opus[1m]", displayName: "Opus 5.5 (1M context)" },
    { value: "haiku", displayName: "Haiku 5.5" },
    { value: "claude-opus-5", displayName: "Opus 5" },
    { value: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
  ];
  expect(claudeModelValue(models, "claude-opus-5-5")).toBe("opus");
  expect(claudeModelValue(models, "claude-opus-5-5[1m]")).toBe("opus[1m]");
  expect(claudeModelValue(models, "claude-haiku-5-5")).toBe("haiku");
  expect(claudeModelValue(models, "claude-opus-5")).toBe("claude-opus-5");
  expect(claudeModelValue(models, "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
  // A model that Claude Code no longer lists keeps its ID.
  expect(claudeModelValue(models, "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  expect(claudeModelValue(models, "default")).toBe("default");
});
