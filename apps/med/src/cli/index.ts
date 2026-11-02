#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startHost } from "../host/server";
import { ownCommand } from "../host/thread-agents";
import type { Comparison } from "../shared/protocol";
import { ctagsSetupMessage, discoverCtags } from "../host/search/symbols";
import { installSearchTools } from "../host/search/install";
import {
  DEFAULT_PORT,
  defaultStateDirectory,
  getStateDirectory,
  givenPort,
} from "../host/runtime/connection";
import { disableCrashReports } from "../host/runtime/crash-reports";
import { exitStatus, nearest, UsageError } from "./exit-status";
import { runOpenCommand } from "./open";
import { reviewHelp, runReviewCommand } from "./review";

import { version } from "../../package.json";

/** The commands that `med` runs. A first word that is none of these must be a folder. */
const COMMANDS = [
  "web",
  "add",
  "status",
  "stop",
  "review",
  "pr",
  "thread",
  "open",
  "list",
  "remove",
  "index",
  "sources",
  "vault",
  "skills",
  "service",
  "agents",
  "docs",
  "serve",
  "help",
] as const;

async function mainHelp() {
  const { serviceHelp } = await import("./service");
  return (
    serviceHelp +
    "\n\nLegacy foreground modes:\n" +
    `Usage: med-diff [repository ...] [--port <port>] [--no-open]\n       med-diff --patch <path|-> [--no-open]\n       med-diff --files <old> <new> [--no-open]\n       med-diff --editor [--no-open]\n       med-diff open <file> [--line N] [--edit]\n       med-diff --setup-search\n\nOpen a local, read-only review. Use --patch - to read a patch from stdin.\nSetup search builds pinned Zoekt binaries once; it requires Go during setup only.\nDefault port: ${DEFAULT_PORT} (or MED_PORT); another state folder than ~/.local/state/med gets a free port. Use --state-dir <path> or MED_STATE_DIR to select saved review state.\n\n` +
    reviewHelp +
    "\n\nRegister folders: med-diff sources --help\nOpen saved repositories: med-diff --registered\nOffline guides: med-diff docs\nTeach Claude Code and Codex to hand off reviews: med skills install"
  );
}

async function isFolder(path: string) {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

function notACommand(word: string) {
  const near = nearest(word, COMMANDS);
  return (
    `med: "${word}" is not a command or a folder.` +
    (near ? ` Did you mean "${near}"?` : "") +
    "\nRun med --help to see the commands."
  );
}

async function main(args: string[]) {
  await disableCrashReports();
  const [command, ...rest] = args;
  if (args.length === 1 && ["--version", "-v"].includes(command!)) {
    console.log(`med ${version}`);
    return;
  }
  if (command === "help") {
    // med help <command> is med <command> --help.
    if (rest.length > 1) throw new UsageError("Usage: med help [command]");
    if (!rest.length || rest[0] === "help") return console.log(await mainHelp());
    if (!COMMANDS.includes(rest[0] as never))
      throw new UsageError(notACommand(rest[0]!).replace(" or a folder", ""));
    return main([rest[0]!, "--help"]);
  }
  if (command === "service") {
    const { loginService } = await import("./login-service");
    await loginService(rest);
    return;
  }
  if (command === "__index-worker") {
    const { runSourcesCommand } = await import("./sources");
    await runSourcesCommand("vault", ["index", ...rest]);
    return;
  }
  if (
    ["web", "add", "list", "remove", "index", "status", "stop", "serve"].includes(command ?? "")
  ) {
    const { runServiceCommand } = await import("./service");
    await runServiceCommand(command!, rest);
    return;
  }
  if (command === "docs") {
    const { runDocsCommand } = await import("./docs");
    runDocsCommand(rest);
    return;
  }
  if (command === "skills") {
    const { runSkillsCommand } = await import("./skills");
    await runSkillsCommand(rest);
    return;
  }
  if (command === "sources" || command === "vault") {
    const { runSourcesCommand } = await import("./sources");
    await runSourcesCommand(command, rest);
    return;
  }
  if (command === "open") {
    await runOpenCommand(rest);
    return;
  }
  if (command === "pr") {
    const { runPullRequestCommand } = await import("./pr");
    await runPullRequestCommand(rest);
    return;
  }
  if (command === "review") {
    await runReviewCommand(rest);
    return;
  }
  if (command === "agents") {
    const { runAgentsCommand } = await import("./agents");
    await runAgentsCommand(rest);
    return;
  }
  if (command === "thread") {
    const { runThreadCommand } = await import("./thread");
    await runThreadCommand(rest);
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      port: { type: "string" },
      "state-dir": { type: "string" },
      open: { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
      patch: { type: "string" },
      files: { type: "boolean" },
      editor: { type: "boolean" },
      registered: { type: "boolean" },
      "setup-search": { type: "boolean" },
    },
  });
  // The older foreground mode opens folders: any other word is a typo.
  if (!values.patch && !values.files)
    for (const [index, word] of positionals.entries())
      if (!(await isFolder(word)))
        throw new UsageError(index ? `med: "${word}" is not a folder.` : notACommand(word));
  if (values.help) {
    console.log(await mainHelp());
  } else if (values["setup-search"]) {
    console.log("Setting up pinned Zoekt search tools…");
    const result = await installSearchTools();
    console.log(`Search tools ready: ${result.binDir}`);
    const ctags = await discoverCtags();
    console.log(ctags ? `Symbol extraction ready: ${ctags.path}` : ctagsSetupMessage);
  } else {
    if (values.registered) {
      if (positionals.length || values.editor || values.patch || values.files)
        throw new Error("Use --registered without repository paths or other opening modes.");
      const { SourceCatalogue } = await import("../host/vault/sources");
      const saved = await SourceCatalogue.open(getStateDirectory(values["state-dir"]));
      try {
        for (const source of saved.list().filter((source) => source.kind === "repo"))
          positionals.push((await saved.require(source.id, "repo")).path);
      } finally {
        saved.close();
      }
      if (!positionals.length)
        throw new Error(
          "No repositories registered. Use med add <path>, then med web to browse saved sources.",
        );
    }
    // Another state folder than Med's own takes a free port, not the user's 6330.
    const stateDir = getStateDirectory(values["state-dir"]);
    const port =
      values.port !== undefined
        ? Number(values.port)
        : (givenPort(undefined) ?? (stateDir === defaultStateDirectory() ? DEFAULT_PORT : 0));
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Port must be between 0 and 65535.");
    if (values.editor && (values.patch || values.files))
      throw new Error("Use --editor without comparison inputs.");
    if (values.patch && values.files) throw new Error("Choose either --patch or --files.");
    let initialComparison: Comparison | undefined;
    let ownedTemporary: string | undefined;
    const allowedInputPaths: string[] = [];
    if (values.patch) {
      let path: string;
      if (values.patch === "-") {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const input of process.stdin) {
          const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
          bytes += chunk.byteLength;
          if (bytes > 16 * 1024 * 1024) throw new Error("The stdin patch exceeds 16 MiB.");
          chunks.push(chunk);
        }
        ownedTemporary = await mkdtemp(join(tmpdir(), "med-stdin-"));
        path = join(ownedTemporary, "stdin.patch");
        await writeFile(path, Buffer.concat(chunks), { mode: 0o600 });
      } else path = resolve(values.patch);
      initialComparison = { kind: "patch", path };
      allowedInputPaths.push(path);
    } else if (values.files) {
      if (positionals.length !== 2) throw new Error("Use --files <old> <new>.");
      const oldPath = resolve(positionals[0]!),
        newPath = resolve(positionals[1]!);
      initialComparison = { kind: "files", oldPath, newPath };
      allowedInputPaths.push(oldPath, newPath);
    }
    const cleanup = async () => {
      if (ownedTemporary) await rm(ownedTemporary, { recursive: true, force: true });
    };
    const host = await startHost({
      repo: initialComparison ? process.cwd() : resolve(positionals[0] ?? process.cwd()),
      ...(!initialComparison ? { repos: positionals.slice(1).map((path) => resolve(path)) } : {}),
      port,
      fileMode: values.editor,
      stateDir,
      foundSessions: stateDir === defaultStateDirectory(),
      ...(initialComparison ? { initialComparison } : {}),
      allowedInputPaths,
      onClose: cleanup,
      cli: ownCommand(),
    }).catch(async (error: unknown) => {
      await cleanup();
      throw error;
    });
    console.log(`Med review: ${host.url}`);
    if (values.open) {
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer.exe"
            : "xdg-open";
      const child = spawn(command, [host.url], { stdio: "ignore", detached: true, shell: false });
      child.on("error", () => console.error("Could not open a browser. Use the launch URL above."));
      child.unref();
    }
    let stopping = false;
    const close = () => {
      if (!stopping) {
        stopping = true;
        void host
          .close()
          .catch((error: unknown) => {
            console.error(error);
            process.exitCode = 1;
          })
          // A watcher that chokidar did not close can keep a stopped host alive.
          .finally(() => process.exit());
      }
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Med could not complete the command.");
  process.exitCode = exitStatus(error);
});
