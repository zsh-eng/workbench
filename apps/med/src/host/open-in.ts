import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { runProcess } from "./runtime/process";
import type { Settings } from "./settings-file";

// Open in: the code host's page for a file's line, Sourcegraph's and other
// links that the settings add, and the editors on this Mac, which Med opens
// at the file and line itself. docs/usage/settings.md has the `openIn` keys.

export interface Editor {
  id: string;
  name: string;
  /** The editor's command line tool. */
  command: string;
  /** Its arguments to open a file at a line. */
  args(file: string, line: number): string[];
  /** How Med starts it, for Settings: "code -g file:line". */
  usage?: string;
}

const KNOWN = [
  {
    id: "vscode",
    name: "VS Code",
    command: "code",
    app: "Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: (file: string, line: number) => ["-g", `${file}:${line}`],
    usage: "code -g file:line",
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    app: "Cursor.app/Contents/Resources/app/bin/cursor",
    args: (file: string, line: number) => ["-g", `${file}:${line}`],
    usage: "cursor -g file:line",
  },
  {
    id: "zed",
    name: "Zed",
    command: "zed",
    app: "Zed.app/Contents/MacOS/cli",
    args: (file: string, line: number) => [`${file}:${line}`],
    usage: "zed file:line",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    command: "idea",
    app: "IntelliJ IDEA.app/Contents/MacOS/idea",
    args: (file: string, line: number) => ["--line", String(line), file],
    usage: "idea --line line file",
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

/** A code host's kind: the pages of its files. */
export type HostKind = "github" | "gitlab";

/** Open in's settings, from the settings file's `openIn` keys. */
export interface OpenInSettings {
  /** A host's kind, or "off" to leave it out. A host without a choice is
   * GitHub when it answers as GitHub does, and is otherwise left out. */
  hosts: Record<string, HostKind | "off">;
  /** A Sourcegraph instance's address, such as https://sourcegraph.acme.build. */
  sourcegraph: string;
  /** The editors to list, in order; the first is the default. Null lists
   * each one found. */
  editors: string[] | null;
  /** Other links by name: a template with {host}, {owner}, {repo}, {ref},
   * {path}, and {line}. */
  links: Record<string, string>;
}

const record = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

export function openInSettings(settings: Settings): OpenInSettings {
  const hosts = Object.fromEntries(
    Object.entries(record(settings["openIn.hosts"])).filter(
      (entry): entry is [string, HostKind | "off"] =>
        entry[1] === "github" || entry[1] === "gitlab" || entry[1] === "off",
    ),
  );
  const sourcegraph = settings["openIn.sourcegraph"];
  const editors = settings["openIn.editors"];
  return {
    hosts,
    sourcegraph:
      typeof sourcegraph === "string" && /^https?:\/\/\S+$/.test(sourcegraph.trim())
        ? sourcegraph.trim().replace(/\/+$/, "")
        : "",
    editors: Array.isArray(editors) ? editors.filter((id) => typeof id === "string") : null,
    links: Object.fromEntries(
      Object.entries(record(settings["openIn.links"])).filter(
        ([name, template]) => name.trim() && /^https?:\/\//.test(template.trim()),
      ),
    ),
  };
}

/** The editors that Open in lists: those the settings name, in their order. */
export function listedEditors(found: Editor[], settings: OpenInSettings) {
  if (!settings.editors) return found;
  return settings.editors
    .map((id) => found.find((editor) => editor.id === id))
    .filter((editor) => editor !== undefined);
}

/** The code host's page of a checkout's branch, when it has one. */
export type CodeHostLink =
  | { name: string; base: string }
  /** The branch is not pushed, so the host has no page for it. */
  | { name: string; push: true };

/** Another link of a file's line: a URL with {path} and {line} still to
 * fill, or `push` while the branch is not pushed. */
export type OpenInLink = { name: string; template: string } | { name: string; push: true };

const git = async (checkout: string, args: string[]) => {
  const result = await runProcess("git", args, { cwd: checkout, maxBytes: 64 * 1024 }).catch(
    () => null,
  );
  return result?.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
};

/**
 * The remote that the checkout's branch pushes to, or origin: its host,
 * owner and repository, and the branch on it, "" while it is not pushed.
 */
export async function branchRemote(checkout: string) {
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
  if (!parsed) return null;
  const branch = upstream.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : "";
  return { ...parsed, branch };
}

const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** A host's kind: the reader's choice, or GitHub when the host answers as
 * GitHub does. Null leaves the host out. */
export async function hostKind(
  host: string,
  settings: OpenInSettings,
  isGitHub: (host: string) => Promise<boolean>,
): Promise<HostKind | null> {
  const chosen = settings.hosts[host];
  if (chosen === "off") return null;
  if (chosen) return chosen;
  return (await isGitHub(host)) ? "github" : null;
}

/**
 * Open in's links for a checkout: the page of its branch on its code host,
 * then Sourcegraph and the settings' other links, at the same file and line.
 */
export async function openInLinks(
  checkout: string,
  settings: OpenInSettings,
  isGitHub: (host: string) => Promise<boolean>,
): Promise<{ host: CodeHostLink | null; links: OpenInLink[] }> {
  const remote = await branchRemote(checkout);
  if (!remote) return { host: null, links: [] };
  const { host: name, owner, repo, branch } = remote;
  const kind = await hostKind(name, settings, isGitHub);
  const ref = segments(branch);
  const page = `https://${name}/${owner}/${repo}/${kind === "gitlab" ? "-/blob" : "blob"}/${ref}`;
  const host: CodeHostLink | null = !kind
    ? null
    : branch
      ? { name, base: page }
      : { name, push: true };
  // Each link by name, with {path} and {line} left to fill; one that names
  // the branch waits for a push.
  const others: { name: string; template: string; ref: boolean }[] = [
    ...(settings.sourcegraph
      ? [
          {
            name: "Sourcegraph",
            template: `${settings.sourcegraph}/${name}/${owner}/${repo}@${ref}/-/blob/{path}?L{line}`,
            ref: true,
          },
        ]
      : []),
    ...Object.entries(settings.links).map(([label, template]) => ({
      name: label,
      template: template
        .trim()
        .replaceAll("{host}", name)
        .replaceAll("{owner}", encodeURIComponent(owner))
        .replaceAll("{repo}", encodeURIComponent(repo))
        .replaceAll("{ref}", ref),
      ref: template.includes("{ref}"),
    })),
  ];
  return {
    host,
    links: others.map((link) =>
      branch || !link.ref
        ? { name: link.name, template: link.template }
        : { name: link.name, push: true as const },
    ),
  };
}

/**
 * The code hosts of the given checkouts' remotes, with how many checkouts
 * each has, and whether each answers as GitHub does.
 */
export async function codeHosts(checkouts: string[], isGitHub: (host: string) => Promise<boolean>) {
  const counts = new Map<string, number>();
  await Promise.all(
    checkouts.map(async (checkout) => {
      const remote = await branchRemote(checkout);
      if (remote) counts.set(remote.host, (counts.get(remote.host) ?? 0) + 1);
    }),
  );
  return Promise.all(
    [...counts].map(async ([host, repositories]) => ({
      host,
      repositories,
      github: await isGitHub(host),
    })),
  ).then((hosts) =>
    hosts.sort((a, b) => b.repositories - a.repositories || a.host.localeCompare(b.host)),
  );
}
