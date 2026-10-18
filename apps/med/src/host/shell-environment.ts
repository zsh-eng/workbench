import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userHome } from "./service/discover";

// The environment of the user's login shell, for the agents that Med starts.
// Med's login service starts from launchd, which reads no shell profile: a
// token or a PATH that ~/.zshrc exports, such as ANTHROPIC_API_KEY, is not in
// the service's environment, so Claude Code started from Med would ask for
// /login. VS Code reads its shell environment the same way. A host started
// from a terminal already has that environment and reads nothing.

/** The longest that the shell may take to print its environment. */
const SHELL_TIMEOUT_MS = 5000;
/** Variables of the shell process itself, not of the user's environment. */
const SHELL_OWN = new Set(["_", "PWD", "OLDPWD", "SHLVL", "MED_RESOLVING_ENVIRONMENT"]);

let resolved: NodeJS.ProcessEnv = {};

/** The shell's variables, read once at start; empty outside the login service. */
export const shellEnvironment = () => resolved;

/** Whether this process is Med's login service: launchd names the job in
 * XPC_SERVICE_NAME (see service/login-item.ts). MED_SHELL_ENVIRONMENT=1 or 0
 * turns the read on or off. */
export function wantsShellEnvironment(env = process.env, platform = process.platform) {
  if (env.MED_SHELL_ENVIRONMENT === "1") return true;
  if (env.MED_SHELL_ENVIRONMENT === "0") return false;
  return platform === "darwin" && /^local\.med\.[0-9a-f]{12}$/.test(env.XPC_SERVICE_NAME ?? "");
}

/** Reads the login shell's environment once, when this process needs it. A
 * shell that fails or takes too long leaves Med's own environment. */
export async function loadShellEnvironment() {
  resolved = wantsShellEnvironment() ? await readShellEnvironment().catch(() => ({})) : {};
}

/** Runs the user's shell as a terminal would (interactive, login), and reads
 * its environment between two marks, so the profile's own output is ignored.
 * Profiles can test MED_RESOLVING_ENVIRONMENT to skip slow work. */
export function readShellEnvironment(
  shell = process.env.SHELL || "/bin/zsh",
  timeoutMs = SHELL_TIMEOUT_MS,
): Promise<NodeJS.ProcessEnv> {
  const mark = randomUUID();
  return new Promise((resolve, reject) => {
    const child = spawn(
      shell,
      ["-i", "-l", "-c", `printf '%s' '${mark}'; command env -0; printf '%s' '${mark}'`],
      {
        cwd: userHome(),
        env: { ...process.env, MED_RESOLVING_ENVIRONMENT: "1" },
        stdio: ["ignore", "pipe", "ignore"],
        // Its own process group, so a timeout also ends what the profile started.
        detached: true,
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* The shell has ended. */
      }
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error("The login shell did not print its environment in time."));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) stop();
      else chunks.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      const start = output.indexOf(mark);
      const end = output.lastIndexOf(mark);
      if (start < 0 || end <= start)
        return reject(new Error("The login shell printed no environment."));
      const env: NodeJS.ProcessEnv = {};
      for (const entry of output.slice(start + mark.length, end).split("\0")) {
        const split = entry.indexOf("=");
        if (split <= 0) continue;
        const name = entry.slice(0, split);
        if (!SHELL_OWN.has(name)) env[name] = entry.slice(split + 1);
      }
      resolve(env);
    });
  });
}
