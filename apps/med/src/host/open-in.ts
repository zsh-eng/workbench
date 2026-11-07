import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { runProcess } from "./runtime/process";

// Open in: the code host's page for a file's line, and the editors on this
// Mac, which Med opens at the file and line itself.

export interface Editor {
  id: string;
  name: string;
  /** The editor's command line tool. */
  command: string;
  /** Its arguments to open a file at a line. */
  args(file: string, line: number): string[];
}

const KNOWN = [
  {
    id: "vscode",
    name: "VS Code",
    command: "code",
    app: "Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: (file: string, line: number) => ["-g", `${file}:${line}`],
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    app: "Cursor.app/Contents/Resources/app/bin/cursor",
    args: (file: string, line: number) => ["-g", `${file}:${line}`],
  },
  {
    id: "zed",
    name: "Zed",
    command: "zed",
    app: "Zed.app/Contents/MacOS/cli",
    args: (file: string, line: number) => [`${file}:${line}`],
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    command: "idea",
    app: "IntelliJ IDEA.app/Contents/MacOS/idea",
    args: (file: string, line: number) => ["--line", String(line), file],
  },
];

const runnable = (path: string) =>
  access(path, constants.X_OK).then(
    () => true,
    () => false,
  );

/**
 * The editors on this machine: each one's tool on `PATH`, or in its app in
 * /Applications or ~/Applications.
 */
export async function findEditors(env: NodeJS.ProcessEnv = process.env): Promise<Editor[]> {
  const folders = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const apps =
    process.platform === "darwin" ? ["/Applications", join(homedir(), "Applications")] : [];
  const found = await Promise.all(
    KNOWN.map(async (editor) => {
      for (const folder of folders) {
        const path = join(folder, editor.command);
        if (await runnable(path)) return { ...editor, command: path };
      }
      for (const folder of apps) {
        const path = join(folder, editor.app);
        if (await runnable(path)) return { ...editor, command: path };
      }
      return null;
    }),
  );
  return found.filter((editor) => editor !== null);
}

/** Starts an editor at a file's line, apart from Med. */
export function launchEditor(editor: Editor, file: string, line: number) {
  const child = spawn(editor.command, editor.args(file, line), {
    stdio: "ignore",
    detached: true,
    shell: false,
  });
  child.on("error", () => {
    /* The editor went away since Med found it; the request already succeeded. */
  });
  child.unref();
}

/** A remote's host, owner and repository, from its SSH or HTTPS address. */
export function parseRemote(url: string) {
  const trimmed = url.trim();
  const match =
    // git@github.com:acme/trailhead.git
    /^(?:[\w.-]+@)?([\w.-]+):(?!\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(trimmed) ??
    // ssh://git@host:22/acme/trailhead.git, https://host/acme/trailhead
    /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?([\w.-]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );
  if (!match) return null;
  return { host: match[1]!.toLowerCase(), owner: match[2]!, repo: match[3]! };
}

/**
 * Whether a host is GitHub: github.com is; any other host is asked once,
 * through `/api/v3/meta`, which GitHub Enterprise answers.
 */
export function createHostProbe(fetcher: typeof fetch = fetch) {
  const known = new Map<string, Promise<boolean>>([["github.com", Promise.resolve(true)]]);
  return (host: string) => {
    let answer = known.get(host);
    if (!answer) {
      answer = fetcher(`https://${host}/api/v3/meta`, {
        signal: AbortSignal.timeout(3_000),
        headers: { accept: "application/json" },
      }).then(
        async (response) =>
          response.ok && typeof (await response.json().catch(() => null)) === "object",
        () => false,
      );
      known.set(host, answer);
    }
    return answer;
  };
}

/** The code host's page of a checkout's branch, when it has one. */
export type CodeHostLink =
  | { name: string; base: string }
  /** The branch is not pushed, so the host has no page for it. */
  | { name: string; push: true };

const git = async (checkout: string, args: string[]) => {
  const result = await runProcess("git", args, { cwd: checkout, maxBytes: 64 * 1024 }).catch(
    () => null,
  );
  return result?.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
};

/**
 * The page of the checkout's branch on its code host: the remote that the
 * branch pushes to, or origin. Null when the remote is not a GitHub host.
 */
export async function codeHostLink(
  checkout: string,
  isGitHub: (host: string) => Promise<boolean>,
): Promise<CodeHostLink | null> {
  const upstream = await git(checkout, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  const remotes = (await git(checkout, ["remote"])).split("\n").filter(Boolean);
  // "origin/feature/tides": the remote is the longest name that starts it.
  const remote =
    remotes
      .filter((name) => upstream.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0] ?? (remotes.includes("origin") ? "origin" : "");
  if (!remote) return null;
  const parsed = parseRemote(await git(checkout, ["remote", "get-url", remote]));
  if (!parsed || !(await isGitHub(parsed.host))) return null;
  const branch = upstream.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : "";
  if (!branch) return { name: parsed.host, push: true };
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  return {
    name: parsed.host,
    base: `https://${parsed.host}/${parsed.owner}/${parsed.repo}/blob/${ref}`,
  };
}
