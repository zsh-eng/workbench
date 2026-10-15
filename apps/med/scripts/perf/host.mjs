// The scratch host for the performance budget: a built Med host on a port,
// with a git shim first on its PATH that logs every Git process.
import { execFile, execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** The first `git` on PATH that is not in `skip`. */
function realGit(path, skip) {
  for (const dir of path.split(delimiter)) {
    if (!dir || dir === skip) continue;
    try {
      execFileSync("test", ["-x", join(dir, "git")]);
      return join(dir, "git");
    } catch {
      /* Not here. */
    }
  }
  throw new Error("No git on PATH.");
}

/**
 * Writes the git shim into `dir`/bin. The C shim adds about 1.5 ms to a Git
 * process; the zsh one, used without a C compiler, about 4 ms.
 */
export async function makeGitShim(dir, path = process.env.PATH ?? "") {
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const git = realGit(path, bin);
  try {
    execFileSync(
      "cc",
      [
        "-O2",
        `-DREAL_GIT="${git}"`,
        "-o",
        join(bin, "git"),
        join(import.meta.dirname, "git-shim.c"),
      ],
      {
        stdio: "ignore",
      },
    );
    return { bin, kind: "c", git };
  } catch {
    await writeFile(
      join(bin, "git"),
      `#!/bin/zsh -f\nzmodload zsh/datetime\ns=$(( epochtime[1] * 1000000000 + epochtime[2] ))\n${git} "$@"\nc=$?\ne=$(( epochtime[1] * 1000000000 + epochtime[2] ))\nprint -r -- "$s $e 0 0 $c $PWD\t$*" >> "$MED_GIT_LOG"\nexit $c\n`,
    );
    await chmod(join(bin, "git"), 0o755);
    return { bin, kind: "zsh", git };
  }
}

/** Reads the shim's log: one entry per Git process, times in epoch milliseconds. */
export async function readGitLog(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [start, end, user, sys, status, ...cwd] = line.slice(0, tab).split(" ");
      return {
        start: Number(start) / 1e6,
        end: Number(end) / 1e6,
        cpu: (Number(user) + Number(sys)) / 1000,
        status: Number(status),
        cwd: cwd.join(" "),
        args: line.slice(tab + 1),
      };
    });
}

/** The CPU time of a process in milliseconds (ps reports hundredths). */
export function cpuTime(pid) {
  try {
    const text = execFileSync("ps", ["-o", "time=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    const parts = text.split(":").map(Number);
    const seconds =
      parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return Math.round(seconds * 1000);
  } catch {
    return NaN;
  }
}

/** The same without blocking: ps runs at once, and the caller awaits it later. */
export function cpuTimeAsync(pid) {
  return new Promise((done) =>
    execFile("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }, (error, text) => {
      if (error) return done(NaN);
      const parts = text.trim().split(":").map(Number);
      const seconds =
        parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      done(Math.round(seconds * 1000));
    }),
  );
}

/** The one-minute load average. */
export const loadAverage = () =>
  Number(execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim().split(/\s+/)[1]);

/**
 * Starts `cli serve` on `port` with `env`, the shim first on PATH, and waits
 * until it answers. The token stays in memory; nothing prints it.
 */
export async function startHost({ cli, state, port, env, shim, gitLog, args = [] }) {
  const hostEnv = {
    ...env,
    PATH: `${shim.bin}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
    MED_GIT_LOG: gitLog,
  };
  delete hostEnv.CLAUDE_CODE_SESSION_ID;
  const child = spawn(
    "node",
    [...args, cli, "serve", "--state-dir", state, "--port", String(port)],
    {
      env: hostEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const exited = new Promise((done) => child.once("exit", done));
  for (let i = 0; ; i++) {
    try {
      // Read the body: a kept-alive socket that the host closes later fails the next fetch.
      await (
        await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: "close" } })
      ).arrayBuffer();
      break;
    } catch {
      if (i > 150 || child.exitCode !== null)
        throw new Error(`The host did not start:\n${log.slice(-2000)}`);
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  const token = (await readFile(join(state, "credential"), "utf8")).trim();
  const origin = `http://127.0.0.1:${port}`;
  return {
    pid: child.pid,
    origin,
    token,
    log: () => log,
    cpu: () => cpuTime(child.pid),
    cpuAsync: () => cpuTimeAsync(child.pid),
    /** A CLI command against this host, with the same environment. */
    cli: (cliArgs, extra = {}) =>
      execFileSync("node", [cli, ...cliArgs, "--state-dir", state, "--port", String(port)], {
        encoding: "utf8",
        env: { ...hostEnv, MED_GIT_LOG: "", ...extra },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    /** The thread list, as the sidebar first receives it. */
    async threads() {
      const controller = new AbortController();
      const open = () =>
        fetch(`${origin}/api/threads/events`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      // A socket that the host closed while it idled fails once.
      const response = await open().catch(open);
      const reader = response.body.getReader();
      let text = "";
      while (!text.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      controller.abort();
      const data = /^data: (.*)$/m.exec(text)?.[1];
      return JSON.parse(data);
    },
    async stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}
