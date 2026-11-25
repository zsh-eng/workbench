import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiTranscriptReader } from "../../src/shared/agent-session-pi";
import { findTranscript, readTranscriptPage } from "../../src/host/agent-transcripts";
import { createSessionIndex } from "../../src/host/session-index";
import { createSessionSearch } from "../../src/host/session-search";
import { createThreadService } from "../../src/host/thread-service";
import { createThreadStore } from "../../src/host/thread-store";
import { SavedReviewStore } from "../../src/host/saved-reviews";
import { createCheckoutWork } from "../../src/host/checkout-work";
import { createThreadSubagents } from "../../src/host/thread-subagents";
import { OwnedSessions } from "../../src/host/owned-sessions";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  folders.push(dir);
  return dir;
}

async function writePiSession(
  home: string,
  cwd: string,
  id: string,
  lines: Record<string, unknown>[],
  mtime?: Date,
) {
  const folderName = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(home, ".pi", "agent", "sessions", folderName);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `2026-11-25T07-00-00-000Z_${id}.jsonl`);
  await writeFile(file, `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

test("Pi transcript reader parses messages, tool calls, tool results, session_info, and idle state", () => {
  const reader = createPiTranscriptReader();
  expect(reader.idle()).toBe(true);

  const header = reader.line(
    JSON.stringify({
      type: "session",
      version: 3,
      id: "pi-sess-1",
      timestamp: "2026-11-25T07:00:00.000Z",
      cwd: "/work/repo",
    }),
  );
  expect(header).toEqual([]);

  const user = reader.line(
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-11-25T07:00:01.000Z",
      message: { role: "user", content: "Fix dark mode mermaid diagrams" },
    }),
  );
  expect(reader.idle()).toBe(false);
  expect(user).toHaveLength(1);
  expect(user[0]!.update).toMatchObject({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "Fix dark mode mermaid diagrams" },
  });

  const toolUse = reader.line(
    JSON.stringify({
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-11-25T07:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me inspect the CSS." },
          {
            type: "toolCall",
            id: "tc1",
            name: "edit",
            arguments: { path: "src/app.css", oldText: "a", newText: "b" },
          },
        ],
        stopReason: "toolUse",
      },
    }),
  );
  expect(reader.idle()).toBe(false);
  expect(toolUse.map((e) => e.update.sessionUpdate)).toEqual(["agent_thought_chunk", "tool_call"]);
  expect(toolUse[1]!.update).toMatchObject({
    toolCallId: "tc1",
    title: "Edit src/app.css",
    kind: "edit",
    status: "in_progress",
  });

  const toolResult = reader.line(
    JSON.stringify({
      type: "message",
      id: "m3",
      parentId: "m2",
      timestamp: "2026-11-25T07:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "edit",
        content: [{ type: "text", text: "Updated src/app.css" }],
        isError: false,
      },
    }),
  );
  expect(reader.idle()).toBe(false);
  expect(toolResult[0]!.update).toMatchObject({
    sessionUpdate: "tool_call_update",
    toolCallId: "tc1",
    status: "completed",
  });

  const reply = reader.line(
    JSON.stringify({
      type: "message",
      id: "m4",
      parentId: "m3",
      timestamp: "2026-11-25T07:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done updating dark mode styles." }],
        stopReason: "stop",
      },
    }),
  );
  expect(reader.idle()).toBe(true);
  expect(reply[0]!.update).toMatchObject({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Done updating dark mode styles." },
  });

  const named = reader.line(
    JSON.stringify({
      type: "session_info",
      id: "m5",
      parentId: "m4",
      timestamp: "2026-11-25T07:00:05.000Z",
      name: "Mermaid dark mode fix",
    }),
  );
  expect(named[0]!.update).toEqual({
    sessionUpdate: "session_info_update",
    title: "Mermaid dark mode fix",
  });
});

test("Pi sessions are discovered into Recent, readable via transcripts, searchable, and deduplicated against Med-owned Pi sessions", async () => {
  const root = await tempDir("med-pi-recents-");
  const home = join(root, "home");
  const repo = join(root, "repo");
  const stateDir = join(root, "state");
  await mkdir(home, { recursive: true });
  await mkdir(repo, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const now = Date.now();
  const freshId = "019a0000-0000-7000-8000-000000000001";
  const ownedPiId = "019a0000-0000-7000-8000-000000000002";
  const oldId = "019a0000-0000-7000-8000-000000000003";

  // 1. Fresh terminal Pi session (already finished its first reply, as Pi flushes on first assistant reply)
  const freshPath = await writePiSession(
    home,
    repo,
    freshId,
    [
      {
        type: "session",
        version: 3,
        id: freshId,
        timestamp: new Date(now - 20_000).toISOString(),
        cwd: repo,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: new Date(now - 15_000).toISOString(),
        message: { role: "user", content: "Inspect Pi recents discovery" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: new Date(now - 10_000).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Checked discovery wiring." }],
          stopReason: "stop",
        },
      },
    ],
    new Date(now - 10_000),
  );

  // 2. Pi session whose underlying file belongs to a Med-owned ACP Pi thread (must not duplicate)
  await writePiSession(
    home,
    repo,
    ownedPiId,
    [
      {
        type: "session",
        version: 3,
        id: ownedPiId,
        timestamp: new Date(now - 15_000).toISOString(),
        cwd: repo,
      },
      {
        type: "message",
        id: "u2",
        parentId: null,
        timestamp: new Date(now - 12_000).toISOString(),
        message: { role: "user", content: "Owned inside Med" },
      },
      {
        type: "message",
        id: "a2",
        parentId: "u2",
        timestamp: new Date(now - 8_000).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Working inside Med." }],
          stopReason: "stop",
        },
      },
    ],
    new Date(now - 8_000),
  );

  // 3. Older idle Pi session (2 days old -> appears in Archived/history and search, not auto-opened as tab)
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
  await writePiSession(
    home,
    repo,
    oldId,
    [
      { type: "session", version: 3, id: oldId, timestamp: twoDaysAgo.toISOString(), cwd: repo },
      {
        type: "message",
        id: "u3",
        parentId: null,
        timestamp: twoDaysAgo.toISOString(),
        message: { role: "user", content: "Old Pi refactor" },
      },
      {
        type: "session_info",
        id: "s3",
        parentId: "u3",
        timestamp: twoDaysAgo.toISOString(),
        name: "Pi refactor archive",
      },
    ],
    twoDaysAgo,
  );

  const repositories = () => [
    {
      id: "repo-1",
      name: "repo",
      path: repo,
      branch: "main",
      branches: [{ name: "main", head: "0000000", remote: false, current: true }],
      worktrees: [{ path: repo, branch: "main", head: "0000000", bare: false, linked: false }],
    },
  ];

  const sessions = createSessionIndex({
    repositories,
    settingsFile: join(stateDir, "found.json"),
    home: () => home,
    now: () => now,
  });
  await sessions.scan();

  const store = createThreadStore({ file: join(stateDir, "threads.json"), now: () => now });
  const savedReviews = new SavedReviewStore(join(stateDir, "reviews"));
  const threads = createThreadService({
    savedReviews,
    store,
    sessions,
    repositories,
    status: async () => undefined,
    lastMessage: async () => undefined,
    owned: () => [
      {
        session: { agent: "acp", name: "Pi", id: "med-owned-uuid", cwd: repo },
        agentId: ownedPiId,
      },
    ],
    checkoutWork: createCheckoutWork(),
    subagents: createThreadSubagents(),
    removeWorktree: async () => {},
    home: () => home,
    now: () => now,
  });

  // Fresh terminal Pi session opens automatically in Recent; ownedPiId is deduplicated; oldId stays archived.
  const listed = await threads.list();
  expect(listed.threads.map((t) => t.id)).toEqual([`pi-${freshId}`]);
  expect(listed.threads[0]).toMatchObject({
    id: `pi-${freshId}`,
    agent: "pi",
    title: "Inspect Pi recents discovery",
    repository: { id: "repo-1", name: "repo", path: repo },
  });

  // Older Pi session shows in Archived/history with its session_info title; ownedPiId is still skipped.
  const history = await threads.history();
  expect(history.map((t) => t.id)).toEqual([`pi-${oldId}`]);
  expect(history[0]).toMatchObject({
    id: `pi-${oldId}`,
    agent: "pi",
    title: "Pi refactor archive",
  });

  // Transcript lookup and page reading work for Pi sessions.
  const located = await findTranscript({ agent: "pi", id: freshId }, home);
  expect(located).toBe(freshPath);
  const page = await readTranscriptPage({ agent: "pi", id: freshId }, located!, 1024 * 1024);
  expect(page.events.map((e) => e.update.sessionUpdate)).toEqual([
    "user_message_chunk",
    "agent_message_chunk",
  ]);

  // Session search finds Pi sessions by text, pi:<id>, and path.
  const search = createSessionSearch({ codexNames: async () => new Map(), home: () => home });
  const byText = await search.find("refactor");
  expect(byText.map((s) => `${s.agent}:${s.id}`)).toEqual([`pi:${oldId}`]);
  const byKey = await search.lookup(`pi:${freshId}`);
  expect(byKey).toHaveLength(1);
  expect(byKey[0]!.agent).toBe("pi");
  const byPath = await search.lookup(freshPath);
  expect(byPath).toHaveLength(1);
  expect(byPath[0]!.id).toBe(freshId);

  // Resuming a discovered Pi session keeps its `pi` session key and empty
  // sleeping settings so session/resume preserves the session's own model.
  const ownedManager = new OwnedSessions({
    holderDirectory: join(stateDir, "holders"),
    logDirectory: join(stateDir, "logs"),
    recordsFile: join(stateDir, "owned.json"),
    agents: async () => [
      {
        id: "pi",
        name: "Pi",
        kind: "pi",
        binary: "pi",
        command: "pi",
        args: [],
        available: true,
        source: "builtin",
      },
    ],
    home: () => home,
  });
  const resumed = await ownedManager.resume({ agent: "pi", id: freshId, cwd: repo });
  expect(resumed.session).toEqual({ agent: "pi", name: "Pi", id: freshId, cwd: repo });
  expect(resumed.state().settings).toEqual([]);
  // Resuming a discovered Pi session must not alias its own ID away.
  expect(
    ownedManager.sessions().find((entry) => entry.session.id === freshId)?.agentId,
  ).toBeUndefined();
});
