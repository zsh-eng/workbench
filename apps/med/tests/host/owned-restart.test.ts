import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import { finishedUnseen } from "../../src/shared/threads";
import type { OwnedState } from "../../src/shared/owned-session";
import { runAgentsCommand } from "../../src/cli/agents";
import { cleanup, fixture, alive } from "./owned-fixture";

afterEach(cleanup);

test("agents keep working through a host restart; after a reboot, Claude Code resumes and others stay stopped", async () => {
  const { api, home, thread, start, restart } = await fixture();
  const kept = await start("claude");
  await kept.until((state) => state.status === "idle" && state.settings.length > 0);
  await kept.act({ action: "setting", id: "effort", value: "high" });
  await kept.until((state) => state.status === "idle");
  await kept.act({ action: "setting", id: "mode", value: "plan" });
  await kept.act({ action: "prompt", text: "Format the durations." });
  const replies = await thread(kept.id);
  await vi.waitFor(() =>
    expect(replies()).toEqual(["Model opus, effort high, mode plan: Format the durations."]),
  );
  const ended = await start("claude");
  await ended.until((state) => state.status === "idle");
  await ended.act({ action: "stop" });
  const acp = await start("fake");
  await acp.until((state) => state.status === "idle");

  // A restart leaves the agents in their holders: each goes on where it was.
  await restart();
  const project = join(home, ".claude", "projects", "-fake-repo");
  const started = async () =>
    JSON.parse(await readFile(join(project, `${kept.id}.args.json`), "utf8")) as string[];
  const before = await started();
  expect((await kept.state()).settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "opus"],
    ["effort", "high"],
    ["mode", "plan"],
  ]);
  const after = await thread(kept.id);
  await kept.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() =>
    expect(after().at(-1)).toBe("Model opus, effort high, mode plan: Still here?"),
  );
  expect(await started()).toEqual(before);
  const acpReplies = await thread(acp.id);
  await acp.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() => expect(acpReplies().at(-1)).toBe("(small, build) Still here?"));
  expect((await ended.state()).status).toBe("exited");

  const host = await restart({ reboot: true });
  // Claude Code waits without a process, with the choices it had.
  const back = await kept.until((state) => state.settings.length === 3);
  expect(back.status).toBe("idle");
  expect(back.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "opus"],
    ["effort", "high"],
    ["mode", "plan"],
  ]);
  // The user stopped one, and an ACP agent cannot resume: both stay stopped.
  expect((await ended.state()).status).toBe("exited");
  expect((await acp.state()).status).toBe("exited");

  // While another Claude Code process runs the session, as in a terminal,
  // Med does not start a second one, and sends nothing. A process that starts
  // the session by its arguments counts; without its record, Med does not
  // know where it is open.
  const send = (text: string) =>
    api<{ message: { delivery: string; error?: string }; state: AgentInboxState }>(
      `/api/sessions/${kept.thread}/agent/messages`,
      { text, noteIds: [] },
    );
  const inbox = async () => (await api<AgentInboxState>(`/api/sessions/${kept.thread}/agent`)).data;
  const other = spawn(process.execPath, [
    "-e",
    "setTimeout(() => {}, 30000)",
    "claude",
    "--resume",
    kept.id,
  ]);
  const exited = once(other, "exit");
  await once(other, "spawn");
  expect((await send("Are you there?")).status).toBe(409);
  expect((await inbox()).elsewhere).toEqual({ [kept.id]: "other-app" });

  // When it ends, a message resumes the session in a new process, on the new port.
  const again = await thread(kept.id);
  other.kill();
  await exited;
  await vi.waitFor(async () => expect((await inbox()).elsewhere).toEqual({}), { timeout: 5000 });
  expect((await send("Are you there?")).data.message.delivery).toBe("delivered");
  await vi.waitFor(
    () => expect(again().at(-1)).toBe("Model opus, effort high, mode plan: Are you there?"),
    { timeout: 5000 },
  );
  await kept.until((state) => state.status === "idle");
  expect((await send("Check the summary.")).data.message.delivery).toBe("delivered");
  await vi.waitFor(() =>
    expect(again().at(-1)).toBe("Model opus, effort high, mode plan: Check the summary."),
  );
  const args = await started();
  expect(args).toEqual(expect.arrayContaining(["--resume", kept.id, "--effort", "high"]));
  const env = JSON.parse(await readFile(join(project, `${kept.id}.env.json`), "utf8"));
  expect(env.MED_PORT).toBe(String(host.port));
});

test("a host restart or a reboot is no news: a thread that the reader saw stays read", async () => {
  const { api, start, threads, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  await session.act({ action: "prompt", text: "Format the durations." });
  await session.until((state) => state.status === "idle" && state.turns > 0);
  const row = async () => {
    const latest = await threads();
    return vi.waitFor(
      () => {
        const found = latest.value.find((entry) => entry.id === session.thread);
        if (!found || found.state === "working") throw new Error("Not yet");
        return found;
      },
      { timeout: 5000 },
    );
  };
  const before = await row();
  // The reader reads the thread.
  await api(`/api/threads/${session.thread}/seen`, { at: before.updatedAt });
  for (const reboot of [false, true]) {
    await restart({ reboot });
    const after = await row();
    // Med attaching to its agent again, or restoring it without a process,
    // changes nothing that the reader sees.
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(finishedUnseen(after)).toBe(false);
  }
  // A new turn is news.
  await session.act({ action: "prompt", text: "And the totals." });
  await session.until((state) => state.status === "idle" && state.turns > 1);
  await vi.waitFor(async () => expect(finishedUnseen(await row())).toBe(true), { timeout: 5000 });
});

test("a turn goes on through a host restart; one that a reboot cuts waits as Interrupted: Continue asks the agent to go on, and Dismiss clears it", async () => {
  const { thread, start, threads, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");

  await restart();
  expect(await session.state()).toMatchObject({ status: "working" });
  expect((await session.state()).halt).toBeUndefined();

  await restart({ reboot: true });
  // Nothing runs by itself: the turn waits for the reader.
  const cut = await session.until((state) => state.halt !== undefined);
  expect(cut).toMatchObject({ status: "idle", halt: { kind: "interrupted" } });
  const latest = await threads();
  await vi.waitFor(() =>
    expect(latest.value.find((entry) => entry.id === session.thread)).toMatchObject({
      state: "idle",
      halt: { kind: "interrupted" },
    }),
  );

  const replies = await thread(session.id);
  await session.act({ action: "continue" });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toMatch(/: Your last turn stopped before it ended/),
  );
  expect((await session.until((state) => state.status === "idle")).halt).toBeUndefined();

  // A second cut turn, dismissed: it does not come back after a restart.
  await session.act({ action: "prompt", text: "Wait for the deploy." });
  await session.until((state) => state.status === "working");
  await restart({ reboot: true });
  await session.until((state) => state.halt?.kind === "interrupted");
  await session.act({ action: "dismiss" });
  expect((await session.state()).halt).toBeUndefined();
  await restart();
  const back = await session.until((state) => state.settings.length > 0);
  expect(back.halt).toBeUndefined();
});

test("med agents lists the agents that keep working; one that it stops resumes with the next message, and one whose holder dies waits as Interrupted", async () => {
  const { stateDir, thread, start } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const printed: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((text) => void printed.push(String(text)));
  const agents = async (...args: string[]) => {
    printed.length = 0;
    await runAgentsCommand([...args, "--state-dir", stateDir]);
    return [...printed];
  };
  try {
    expect(await agents()).toEqual([
      expect.stringMatching(new RegExp(`^${session.id.slice(0, 8)}  Claude Code  0 min  /`)),
    ]);
    expect(await agents("stop", session.id.slice(0, 8))).toEqual(["Stopped 1 agent."]);
    expect(await agents()).toEqual(["No agents run."]);
  } finally {
    log.mockRestore();
  }
  // Without a mark: the next message resumes the session.
  expect((await session.state()).halt).toBeUndefined();
  const replies = await thread(session.id);
  await session.act({ action: "prompt", text: "Are you back?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
  await session.until((state) => state.status === "idle");

  // A holder that dies, as in a crash of the Mac, cuts the turn that ran.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  const info = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  process.kill(info.pid, "SIGKILL");
  expect(await session.until((state) => state.halt !== undefined)).toMatchObject({
    status: "idle",
    halt: { kind: "interrupted" },
  });
});

test("a closed tab's agent stops once its turn ends, and the next message resumes it", async () => {
  vi.stubEnv("MED_AGENT_RELEASE_MS", "0");
  const { api, stateDir, thread, start } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const holder = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");

  await api(`/api/threads/${session.thread}/close`, {});
  // The turn goes on without its tab.
  await new Promise((done) => setTimeout(done, 300));
  expect(alive(holder.pid)).toBe(true);
  await session.act({ action: "interrupt" });
  await vi.waitFor(() => expect(alive(holder.pid)).toBe(false));
  expect(await session.state()).toMatchObject({ status: "idle" });
  expect((await session.state()).halt).toBeUndefined();

  // The tab opens again, and a message resumes the session in a new holder.
  await api(`/api/threads/${session.thread}/open`, { restore: true });
  const replies = await thread(session.id);
  await session.act({ action: "prompt", text: "Are you back?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
  await session.until((state) => state.status === "idle");
  const again = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  await new Promise((done) => setTimeout(done, 300));
  expect(alive(again.pid)).toBe(true);
});

test("an agent that exits says why; Restart and a message each resume its session", async () => {
  const { api, home, thread, start, threads } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  await session.act({ action: "prompt", text: "Crash during the build." });
  const stopped = await session.until((state) => state.halt !== undefined);
  expect(stopped).toMatchObject({
    status: "idle",
    halt: { kind: "stopped", detail: "Exited with code 1" },
  });
  expect(stopped.halt!.lines).toContain("FATAL ERROR: the fake ran out of memory");
  const latest = await threads();
  await vi.waitFor(() =>
    expect(latest.value.find((entry) => entry.id === session.thread)?.halt).toEqual({
      kind: "stopped",
      detail: "Exited with code 1",
    }),
  );

  // Restart starts Claude Code again on the session's transcript.
  await session.act({ action: "restart" });
  const restarted = await session.until((state) => state.status === "idle" && !state.halt);
  expect(restarted.halt).toBeUndefined();
  const project = join(home, ".claude", "projects", "-fake-repo");
  const args = JSON.parse(await readFile(join(project, `${session.id}.args.json`), "utf8"));
  expect(args).toEqual(expect.arrayContaining(["--resume", session.id]));

  // A message to an agent that stopped resumes it too, and arrives once.
  await session.act({ action: "prompt", text: "Crash again." });
  await session.until((state) => state.halt?.kind === "stopped");
  const replies = await thread(session.id);
  const sent = await api<{ message: { delivery: string } }>(
    `/api/sessions/${session.thread}/agent/messages`,
    { text: "Are you back?", noteIds: [] },
  );
  expect(sent.data.message.delivery).toBe("delivered");
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
  expect((await session.until((state) => state.status === "idle")).halt).toBeUndefined();
});

test("a session record that Med cannot read costs only itself, and the file keeps a copy", async () => {
  const { stateDir, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const file = join(stateDir, "owned-sessions.json");
  await vi.waitFor(async () =>
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toEqual([session.id]),
  );
  await restart({
    async closed() {
      const records = JSON.parse(await readFile(file, "utf8"));
      records["unknown-kind"] = { ...records[session.id], kind: "telepathy" };
      await writeFile(file, JSON.stringify(records));
    },
  });
  expect((await session.until((state) => state.settings.length > 0)).status).toBe("idle");
  const kept = (await readdir(stateDir)).filter((name) =>
    name.startsWith("owned-sessions.json.unreadable-"),
  );
  expect(kept).toHaveLength(1);
  expect(JSON.parse(await readFile(join(stateDir, kept[0]!), "utf8"))).toHaveProperty(
    "unknown-kind",
  );
});

test("a long holder log starts again at Med's last checkpoint, and a new host reads the same state from it", async () => {
  vi.stubEnv("MED_HOLDER_COMPACT_BYTES", "1");
  const { stateDir, thread, start, restart } = await fixture();
  const claude = await start("claude");
  await claude.until((state) => state.status === "idle" && state.settings.length > 0);
  await claude.act({ action: "setting", id: "mode", value: "plan" });
  const acp = await start("fake");
  await acp.until((state) => state.status === "idle");
  await acp.act({ action: "setting", id: "model", value: "large" });
  for (const text of ["Format the durations.", "Check it."]) {
    await claude.act({ action: "prompt", text });
    await claude.until((state) => state.status === "idle");
    await acp.act({ action: "prompt", text });
    await acp.until((state) => state.status === "idle");
  }
  // Each log keeps its first line, then the last checkpoint and what followed.
  for (const id of [claude.id, acp.id]) {
    const kinds = (await readFile(join(stateDir, "agents", `${id}.log`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => line.split(" ")[1]);
    expect(kinds.slice(0, 2)).toEqual(["h", "m"]);
    expect(kinds.filter((kind) => kind === "m")).toHaveLength(1);
  }
  const before = { claude: await claude.state(), acp: await acp.state() };
  const same = (state: OwnedState) => ({
    status: state.status,
    turns: state.turns,
    settings: state.settings.map((setting) => [setting.id, setting.value]),
    commands: state.commands.map((command) => command.name),
  });

  await restart();
  expect(same(await claude.state())).toEqual(same(before.claude));
  expect(same(await acp.state())).toEqual(same(before.acp));
  const replies = await thread(acp.id);
  await acp.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("(large, build) Still here?"));
  const claudeReplies = await thread(claude.id);
  await claude.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() =>
    expect(claudeReplies().at(-1)).toBe("Model opus, effort medium, mode plan: Still here?"),
  );
});
