import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanUp, clearAgentSession, fixture, git } from "./review-cli-fixture";

beforeEach(clearAgentSession);
afterEach(cleanUp);

describe("since your last review", () => {
  it("lists the files that changed since the version the reader read or commented on", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${f.host.port}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const create = async () =>
      (await f.saved(
        (
          await f.run(
            "create",
            "--key",
            "loop",
            "--title",
            "Review loop",
            "--repo",
            repo,
            "--working",
            "--no-pr",
            "--no-session",
          )
        ).split("\n")[0]!,
      )) as { id: string; iterations: { targetIds: string[] }[] };
    await writeFile(join(repo, "other.txt"), "stays\n");
    const one = await create();
    expect((await f.api(`/api/reviews/${one.id}/since`)).since).toBeNull();
    // Version 2 changes file.txt and adds new.txt.
    await writeFile(join(repo, "file.txt"), "second\n");
    await writeFile(join(repo, "new.txt"), "new\n");
    await create();
    expect((await f.api(`/api/reviews/${one.id}/since`)).since).toEqual({
      from: 1,
      to: 2,
      basis: "previous",
      files: [
        { path: "file.txt", change: "changed", target: expect.any(String) },
        { path: "new.txt", change: "new", target: expect.any(String) },
      ],
    });
    // The reader comments on version 2 and reads version 1; version 3 drops
    // new.txt. Since compares with the later of the two: version 2.
    const two = (await f.api(`/api/reviews/${one.id}`)).iterations[1].targetIds[0];
    await post(`/api/reviews/${one.id}/targets/${two}/notes`, {
      expectedRevision: 0,
      mutation: { type: "add", note: { path: "file.txt", side: "new", line: 1, text: "Why?" } },
    });
    const read = await post(`/api/reviews/${one.id}/read`, { version: 1 });
    expect(read.readVersions).toEqual([1]);
    await rm(join(repo, "new.txt"));
    await create();
    expect((await f.api(`/api/reviews/${one.id}/since`)).since).toEqual({
      from: 2,
      to: 3,
      basis: "commented",
      files: [{ path: "new.txt", change: "gone", target: expect.any(String) }],
    });
    // Reading version 3 makes it the last review.
    await post(`/api/reviews/${one.id}/read`, { version: 3 });
    await writeFile(join(repo, "other.txt"), "changed in 4\n");
    await create();
    expect((await f.api(`/api/reviews/${one.id}/since`)).since).toMatchObject({
      from: 3,
      basis: "viewed",
      files: [{ path: "other.txt", change: "changed" }],
    });
    // A version that does not exist cannot be read.
    const missing = await fetch(`http://127.0.0.1:${f.host.port}/api/reviews/${one.id}/read`, {
      method: "POST",
      headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 9 }),
    });
    expect(missing.status).toBe(404);
  });

  it("shows only what changed since the version read, across a rebase, with comments on the version's lines", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const lines = (count: number) => Array.from({ length: count }, (_, at) => `${at + 1}`);
    const write = (name: string, rows: string[]) =>
      writeFile(join(repo, name), `${rows.join("\n")}\n`);
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${f.host.port}${path}`, {
        method,
        headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const post = async (path: string, body: unknown) => {
      const response = await request("POST", path, body);
      expect(response.status).toBe(200);
      return response.body;
    };
    await write("a.txt", lines(12));
    await write("b.txt", ["b"]);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "base");
    git(repo, "switch", "-c", "feat");
    // Commit 1 changes line 2; commit 2 adds two lines at the top.
    await write(
      "a.txt",
      lines(12).map((row) => (row === "2" ? "two" : row)),
    );
    git(repo, "commit", "-am", "Spell two");
    await write("a.txt", ["top", "top", ...lines(12).map((row) => (row === "2" ? "two" : row))]);
    git(repo, "commit", "-am", "Add a header");
    const create = async () =>
      (await f.saved(
        (
          await f.run(
            "create",
            "--key",
            "feat",
            "--title",
            "Spell fixes",
            "--repo",
            repo,
            "--base",
            "main",
            "--head",
            "HEAD",
            "--merge-base",
            "--no-pr",
            "--no-session",
          )
        ).split("\n")[0]!,
      )) as {
        id: string;
        iterations: { targetIds: string[] }[];
        targets: { id: string; commits?: { id: string; subject: string }[] }[];
      };
    const one = await create();
    await post(`/api/reviews/${one.id}/read`, { version: 1 });
    // Main moves under the branch, and the branch rebases onto it and adds a commit.
    git(repo, "switch", "main");
    await write(
      "a.txt",
      lines(12).map((row) => (row === "11" ? "eleven" : row)),
    );
    git(repo, "commit", "-am", "Main spells eleven");
    git(repo, "switch", "feat");
    git(repo, "rebase", "main");
    await write("b.txt", ["b", "more"]);
    git(repo, "commit", "-am", "More b");
    const two = await create();
    // Version 3 also changes a.txt, whose base moved since version 1.
    const rows = ["top", "top", ...lines(12).map((row) => (row === "2" ? "two" : row))];
    await write(
      "a.txt",
      rows.map((row) => (row === "11" ? "eleven" : row === "6" ? "six" : row)),
    );
    git(repo, "commit", "-am", "Spell six");
    const three = await create();
    const latest = three.iterations[2]!.targetIds[0]!;
    expect((await f.api(`/api/reviews/${one.id}/since?version=3`)).since).toMatchObject({
      from: 1,
      basis: "viewed",
      files: [
        { path: "a.txt", change: "changed", target: latest },
        { path: "b.txt", change: "new", target: latest },
      ],
    });
    // The base's change to a.txt stays out: version 1's change replays on the new base.
    const replayed = await f.api(`/api/reviews/${one.id}/targets/${latest}/review?since=1`);
    expect(replayed.patch).toContain("-6\n+six");
    expect(replayed.patch).not.toContain("eleven");
    const target = two.iterations[1]!.targetIds[0]!;
    const since = (await f.api(`/api/reviews/${one.id}/since?version=2`)).since;
    // a.txt changed only with its base; the rebased commits are not new.
    expect(since).toMatchObject({
      from: 1,
      to: 2,
      basis: "viewed",
      files: [{ path: "b.txt", change: "new", target }],
      moved: ["a.txt"],
    });
    const added = two.targets.find((entry) => entry.id === target)!.commits!;
    expect(since.commits).toEqual([added.find((commit) => commit.subject === "More b")!.id]);
    // The diff since version 1 holds only that change.
    const view = await f.api(`/api/reviews/${one.id}/targets/${target}/review?since=1`);
    expect(view.files.map((file: { path: string }) => file.path)).toEqual(["b.txt"]);
    expect(view.patch).toContain(" b\n+more");
    expect(view.patch).not.toContain("eleven");
    // A comment on a new line there is the version's, on the same line.
    const notes = `/api/reviews/${one.id}/targets/${target}/notes`;
    const added1 = await post(`${notes}?since=1`, {
      expectedRevision: 0,
      mutation: { type: "add", note: { path: "b.txt", side: "new", line: 2, text: "Why more?" } },
    });
    expect(added1.reviewId).toBe(view.id);
    expect((await f.api(notes)).notes).toMatchObject([{ path: "b.txt", side: "new", line: 2 }]);
    const removed = await request("POST", `${notes}?since=1`, {
      expectedRevision: 1,
      mutation: { type: "add", note: { path: "b.txt", side: "old", line: 1, text: "Old" } },
    });
    expect(removed.status).toBe(422);

    // A commit of the range shows the version's comments on its own lines.
    const first = added.find((commit) => commit.subject === "Spell two")!.id;
    const commit = await post("/api/review", {
      repo,
      comparison: { kind: "commit", commit: first },
    });
    await post(notes, {
      expectedRevision: 1,
      mutation: { type: "add", note: { path: "a.txt", side: "new", line: 4, text: "Two?" } },
    });
    const lens = `/api/reviews/${one.id}/browsing/${commit.id}/notes?target=${target}`;
    const shown = await f.api(lens);
    // Line 4 of the version is line 2 of the commit; the note on b.txt is not in it.
    expect(shown.notes).toMatchObject([{ path: "a.txt", line: 2, text: "Two?" }]);
    expect(shown.hidden).toBe(1);
    // A new comment on a line that the version still has goes to the version.
    const after = await post(lens, {
      reviewId: commit.id,
      expectedRevision: shown.revision,
      mutation: { type: "add", note: { path: "a.txt", side: "new", line: 3, text: "Three" } },
    });
    expect(after.notes).toMatchObject([
      { path: "a.txt", line: 2 },
      { path: "a.txt", line: 3, text: "Three" },
    ]);
    expect((await f.api(notes)).notes.map((note: { line: number }) => note.line)).toEqual([
      2, 4, 5,
    ]);
    // So do the guide's lines.
    const placed = await post(
      `/api/reviews/${one.id}/browsing/${commit.id}/place?target=${target}`,
      {
        lines: [
          { path: "a.txt", side: "new", line: 4 },
          { path: "a.txt", side: "new", line: 1 },
        ],
      },
    );
    expect(placed.lines).toEqual([{ line: 2 }, null]);
  });
});
