#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startHost } from "../host/server";
import type { Comparison } from "../shared/protocol";
import { ctagsSetupMessage, discoverCtags } from "../host/search/symbols";
import { installSearchTools } from "../host/search/install";
import { DEFAULT_PORT, getStateDirectory } from "../host/runtime/connection";
import { disableCrashReports } from "../host/runtime/crash-reports";
import { runOpenCommand } from "./open";
import { reviewHelp, runReviewCommand } from "./review";

import { version } from "../../package.json";

async function main() {
  await disableCrashReports();
  if (process.argv.length === 3 && ["--version", "-v"].includes(process.argv[2]!)) {
    console.log(`med ${version}`);
    return;
  }
  if (process.argv[2] === "service") {
    const { loginService } = await import("./login-service");
    await loginService(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "__index-worker") {
    const { runSourcesCommand } = await import("./sources");
    await runSourcesCommand("vault", ["index", ...process.argv.slice(3)]);
    return;
  }
  if (
    ["web", "add", "list", "remove", "index", "status", "stop", "serve"].includes(
      process.argv[2] ?? "",
    )
  ) {
    const { runServiceCommand } = await import("./service");
    await runServiceCommand(process.argv[2]!, process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "docs") {
    const { runDocsCommand } = await import("./docs");
    runDocsCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "skills") {
    const { runSkillsCommand } = await import("./skills");
    await runSkillsCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "sources" || process.argv[2] === "vault") {
    const { runSourcesCommand } = await import("./sources");
    await runSourcesCommand(process.argv[2], process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "open") {
    await runOpenCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "pr") {
    const { runPullRequestCommand } = await import("./pr");
    await runPullRequestCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "review") {
    await runReviewCommand(process.argv.slice(3));
    return;
  }
  const { values, positionals } = parseArgs({
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
  if (values.help) {
    const { serviceHelp } = await import("./service");
    console.log(serviceHelp + "\n\nLegacy foreground modes:");
    console.log(
      "Usage: med-diff [repository ...] [--port <port>] [--no-open]\n       med-diff --patch <path|-> [--no-open]\n       med-diff --files <old> <new> [--no-open]\n       med-diff --editor [--no-open]\n       med-diff open <file> [--line N] [--edit]\n       med-diff --setup-search\n\nOpen a local, read-only review. Use --patch - to read a patch from stdin.\nSetup search builds pinned Zoekt binaries once; it requires Go during setup only.\nDefault port: 4173. Use --state-dir <path> or MED_STATE_DIR to select saved review state.\n\n" +
        reviewHelp +
        "\n\nRegister folders: med-diff sources --help\nOpen saved repositories: med-diff --registered\nOffline guides: med-diff docs\nTeach Claude Code and Codex to hand off reviews: med skills install",
    );
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
    const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
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
      stateDir: getStateDirectory(values["state-dir"]),
      ...(initialComparison ? { initialComparison } : {}),
      allowedInputPaths,
      onClose: cleanup,
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
        void host.close().catch((error: unknown) => {
          console.error(error);
          process.exitCode = 1;
        });
      }
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Med could not complete the command.");
  process.exitCode = 1;
});
