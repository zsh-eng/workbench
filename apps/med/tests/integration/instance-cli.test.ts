import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_PORT, freePort, servicePort } from "../../src/host/runtime/connection";

// A second Med, with its own state folder, as an agent runs it beside the
// user's: the real CLI and server, a scratch home, and no port given.

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step().catch(() => {});
});

it("gives another state folder its own port, and names it in the advice it prints", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-instance-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const state = join(root, "state");
  await mkdir(home);
  const cli = resolve("src/cli/index.ts");
  const env = {
    ...process.env,
    HOME: home,
    MED_HOME_DIR: home,
    MED_STATE_DIR: state,
    MED_PORT: "",
    CLAUDE_CODE_SESSION_ID: "",
    MED_SESSION: "",
    MED_THREAD_KEY: "",
    MED_THREAD_REPO: "",
  };
  const med = (...args: string[]) => exec("bun", [cli, ...args], { env, timeout: 60_000 });
  cleanup.push(() => med("stop"));

  // web takes a free port: 6330 is the user's own Med.
  const web = await med("web", "--no-open");
  const port = Number(/^http:\/\/127\.0\.0\.1:(\d+)\/sources#token=/.exec(web.stdout)?.[1]);
  expect(port).toBeGreaterThan(0);
  expect(port).not.toBe(DEFAULT_PORT);
  const flags = `--port ${port} --state-dir ${state}`;
  expect(web.stderr).toContain(`the server of ${state} uses port ${port}. Commands with ${flags}`);
  expect(await readdir(join(state, "connections"))).toEqual([`${port}.json`]);
  // It lists only its own threads: sessions that no review names stay hidden
  // until the reader shows them.
  const token = /#token=(.+)$/m.exec(web.stdout)![1]!;
  const threads = await fetch(`http://127.0.0.1:${port}/api/threads`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(((await threads.json()) as { found: unknown }).found).toEqual({ shown: false });

  // Later commands with only the state folder find that server.
  const repo = join(root, "app");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "start",
  );
  git("switch", "-q", "-c", "feat/isolated");
  await writeFile(join(repo, "a.txt"), "a\n");
  await med("add", repo);
  expect(await readdir(join(state, "connections"))).toEqual([`${port}.json`]);
  expect(JSON.parse((await med("status")).stdout)).toMatchObject({ service: "med" });

  // The advice of a hand-off reaches this server when run as printed.
  const created = await med(
    "review",
    "create",
    "--title",
    "Isolated hand-off",
    "--repo",
    repo,
    "--working",
    "--no-pr",
  );
  expect(created.stdout).toMatch(
    new RegExp(
      `^\\[Review changes here\\]\\(http://127\\.0\\.0\\.1:${port}/review/r_[a-z0-9]+\\)\\n$`,
    ),
  );
  expect(created.stderr).toContain(
    `Hand off each later round of this task with the same key: med review create --key feat/isolated ${flags} …`,
  );
  await expect(med("review", "repos", "--repo", root)).rejects.toMatchObject({
    stderr: expect.stringContaining(`run: med add ${flags} ${root}`),
  });

  // MED_PORT chooses the port, as --port does.
  const other = join(root, "other");
  const chosen = await freePort();
  const pinned = await exec("bun", [cli, "web", "--no-open"], {
    env: { ...env, MED_STATE_DIR: other, MED_PORT: String(chosen) },
    timeout: 60_000,
  });
  cleanup.push(() =>
    exec("bun", [cli, "stop"], { env: { ...env, MED_STATE_DIR: other, MED_PORT: String(chosen) } }),
  );
  expect(pinned.stdout).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${chosen}/sources#token=`));
  expect(pinned.stderr).not.toContain("Port 6330 is for");

  // An agent that Med starts inherits MED_PORT 6330 with Med's own folder.
  // With another folder, that port does not count. (Nothing binds here.)
  const inherited = join(root, "inherited");
  expect(
    (await servicePort(inherited, undefined, { MED_PORT: String(DEFAULT_PORT) })).port,
  ).not.toBe(DEFAULT_PORT);

  // Two commands that start the server at once both reach the one server.
  const raced = { ...env, MED_STATE_DIR: join(root, "raced") };
  cleanup.push(() => exec("bun", [cli, "stop"], { env: raced }));
  const both = await Promise.all(
    [0, 1].map(() => exec("bun", [cli, "web", "--no-open"], { env: raced, timeout: 60_000 })),
  );
  const ports = both.map((run) => Number(/^http:\/\/127\.0\.0\.1:(\d+)\//.exec(run.stdout)?.[1]));
  expect(ports[0]).toBeGreaterThan(0);
  expect(ports[1]).toBe(ports[0]);
  expect(await readdir(join(root, "raced", "connections"))).toEqual([`${ports[0]}.json`]);
});

/** A scratch home and another state folder, for the CLI. */
async function scratch() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-instance-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(home);
  return {
    ...process.env,
    HOME: home,
    MED_HOME_DIR: home,
    MED_STATE_DIR: join(root, "state"),
    MED_PORT: "",
  };
}

it("starts the foreground mode of another folder on a free port", async () => {
  const child = spawn("bun", [resolve("src/cli/index.ts"), "--editor", "--no-open"], {
    env: await scratch(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(async () => child.kill("SIGTERM"));
  const url = await new Promise<string>((done, fail) => {
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
      const match = /Med review: (\S+)/.exec(text);
      if (match) done(match[1]!);
    });
    child.once("exit", () => fail(new Error(`The foreground mode exited: ${text}`)));
  });
  expect(Number(new URL(url).port)).not.toBe(DEFAULT_PORT);
});

// A login item keeps its port, so another folder's needs --port. The refusal
// comes before Med writes a login item or calls launchctl.
it.skipIf(process.platform !== "darwin")(
  "asks for a port for the login service of another folder",
  async () => {
    await expect(
      exec("bun", [resolve("src/cli/index.ts"), "service", "login", "on"], {
        env: await scratch(),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Choose a port for the login service of"),
    });
  },
);
