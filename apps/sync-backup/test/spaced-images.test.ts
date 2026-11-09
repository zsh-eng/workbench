import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { applyPlan, parseChangeSet, planChangeSet, readSpaced } from "../src/spaced-apply";
import { MAX_IMAGE_BYTES, resolveImages } from "../src/spaced-images";

const origin = "https://api.example.test";
const png = (seed: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
const idOf = (bytes: Uint8Array) =>
  `xxh64:${Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0")}`;
const url = (bytes: Uint8Array) => `${origin}/api/apps/spaced/files/${idOf(bytes)}`;

test("local images become Spaced file URLs; code, remote links and bad files are not uploaded", () => {
  const base = mkdtempSync(join(tmpdir(), "wb-spaced-images-"));
  const directory = join(base, "set");
  try {
    mkdirSync(join(directory, "figs"), { recursive: true });
    writeFileSync(join(base, "x.png"), png(9));
    const raft = png(1);
    const gif = new TextEncoder().encode("GIF89a\x01\x00");
    writeFileSync(join(directory, "figs/raft.png"), raft);
    writeFileSync(join(directory, "figs/log entry.gif"), gif);
    writeFileSync(join(directory, "figs/page.png"), "<svg></svg>");
    writeFileSync(join(directory, "figs/big.png"), new Uint8Array(MAX_IMAGE_BYTES + 1));
    const { set, images, problems } = resolveImages(
      parseChangeSet(
        JSON.stringify({
          version: "spaced-changes-v1",
          changes: [
            {
              action: "create",
              deck: "d",
              front: "Leader? ![fig](./figs/raft.png) and `![x](figs/raft.png)`",
              back: [
                "![same](figs/raft.png \"title\") ![log](<figs/log entry.gif>) ![remote](https://x.test/a.png)",
                "```md",
                "![example](missing.png)",
                "```",
              ].join("\n"),
            },
            { action: "edit", cardId: "c", front: "![enc](figs/log%20entry.gif)", back: "![b](figs/big.png)" },
            { action: "create", deck: "d", front: "![p](figs/page.png) ![m](none.png) ![a](/etc/x.png)", back: "b" },
            // Forms the rewrite does not read, and a file outside the folder.
            {
              action: "create",
              deck: "d",
              front: "![a [b]](figs/raft.png) ![r][ref] <img src=\"figs/raft.png\"> ![up](../x.png)\n\n[ref]: figs/raft.png",
              back: "```inline``` ![after](figs/raft.png)",
            },
            {
              action: "edit",
              cardId: "e",
              front: "![new](figs/raft.png)",
              back: "B",
              expect: { front: "![old](<figs/log entry.gif>)", back: "A" },
            },
            { action: "suspend", cardId: "c" },
          ],
        }),
      ),
      directory,
      origin,
    );
    const [create, edit] = set.changes as { front: string; back: string }[];
    expect(create!.front).toBe(`Leader? ![fig](${url(raft)}) and \`![x](figs/raft.png)\``);
    expect(create!.back).toBe(
      `![same](${url(raft)} "title") ![log](${url(gif)}) ![remote](https://x.test/a.png)\n\`\`\`md\n![example](missing.png)\n\`\`\``,
    );
    expect(edit!.front).toBe(`![enc](${url(gif)})`);
    // Each file once, with the changes that use it.
    expect(images.map(({ id, type, changes }) => ({ id, type, changes }))).toEqual([
      { id: idOf(raft), type: "image/png", changes: [0, 3, 4] },
      { id: idOf(gif), type: "image/gif", changes: [0, 1, 4] },
    ]);
    // A code span on a fence-like line is not a fence.
    expect((set.changes[3] as { back: string }).back).toBe(`\`\`\`inline\`\`\` ![after](${url(raft)})`);
    // `expect` holds the card's text, so it has the Spaced URL too.
    expect(set.changes[4]).toMatchObject({ front: `![new](${url(raft)})`, expect: { front: `![old](${url(gif)})` } });
    expect(problems).toEqual([
      "changes[1].back: figs/big.png: 2.0 MiB, over Spaced's 2 MiB limit",
      "changes[2].front: figs/page.png: not a PNG, JPEG, WebP, GIF or AVIF image",
      "changes[2].front: none.png: not found",
      "changes[2].front: /etc/x.png: use a path relative to the change set",
      "changes[3].front: ../x.png: outside the change set's folder",
      ...["figs/raft.png", "figs/raft.png", "figs/raft.png"].map(
        (path) => `changes[3].front: ${path}: a local link wb does not upload; write an image as ![alt](path)`,
      ),
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the undo file of an edit with an image restores the old text, and a rerun is skipped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-images-"));
  try {
    const store = new Store(directory);
    let seq = 0;
    const write = (key: string, value: string) =>
      store.db
        .query("INSERT OR REPLACE INTO records VALUES('spaced',?,?,1,?,0,'d',?,0,'operations',?)")
        .run(key, value, ++seq, seq, key);
    const op = (type: string, id: string, payload: object) => {
      const inner = JSON.stringify([type, id]);
      write(JSON.stringify(["operations", inner]), JSON.stringify({ type, payload, timestamp: 5, id: inner, isDeleted: false }));
    };
    op("card", "c", { id: "c", state: "Review" });
    op("cardContent", "c", { cardId: "c", front: "Q", back: "A" });
    const push = async (changes: { key: string; value: string }[]) => {
      for (const change of changes) write(change.key, change.value);
      return changes.map(() => true);
    };
    const bytes = png(2);
    writeFileSync(join(directory, "fig.png"), bytes);
    const file = JSON.stringify({
      version: "spaced-changes-v1",
      changes: [{ action: "edit", cardId: "c", front: "Q", back: "![fig](fig.png)", expect: { back: "A" } }],
    });
    const resolved = () => resolveImages(parseChangeSet(file), directory, origin).set;

    const result = await applyPlan(planChangeSet(resolved(), readSpaced(store.db)), readSpaced(store.db), push);
    expect(readSpaced(store.db).cards.get("c")!.back).toBe(`![fig](${url(bytes)})`);
    // The undo file expects the rewritten URL, so it matches the card.
    expect(result.undo!.changes).toMatchObject([{ action: "edit", back: "A", expect: { back: `![fig](${url(bytes)})` } }]);
    // The same file again finds the card already changed.
    expect(planChangeSet(resolved(), readSpaced(store.db)).items[0]!.skip).toBeDefined();
    await applyPlan(planChangeSet(result.undo!, readSpaced(store.db)), readSpaced(store.db), push);
    expect(readSpaced(store.db).cards.get("c")!.back).toBe("A");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
