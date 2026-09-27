import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getStateDirectory, DEFAULT_PORT } from "../host/runtime/connection";
import { selfCommand } from "../host/service/self";
const exec = promisify(execFile);
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
/** Explicit CLI operation only; normal startup never changes login services. */
export async function loginService(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "state-dir": { type: "string" },
      port: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(
      "Usage: med service install|uninstall [--port N] [--state-dir PATH]\nOpt in to a per-user macOS login service. Stop a manually started server before install.",
    );
    return;
  }
  if (process.platform !== "darwin")
    throw new Error(
      "Login-service installation currently supports macOS. Use med serve with your OS service manager elsewhere.",
    );
  if (positionals.length !== 1 || !["install", "uninstall"].includes(positionals[0]!))
    throw new Error("Use med service install or med service uninstall.");
  const state = getStateDirectory(values["state-dir"]),
    port = Number(values.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  const label = `local.med.${createHash("sha256").update(state).digest("hex").slice(0, 12)}`;
  const directory = join(homedir(), "Library", "LaunchAgents"),
    path = join(directory, `${label}.plist`),
    domain = `gui/${process.getuid!()}`;
  if (positionals[0] === "uninstall") {
    await exec("launchctl", ["bootout", `${domain}/${label}`]).catch(() => {});
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    console.log("Removed Med login service. Registered sources and files remain.");
    return;
  }
  try {
    const owner = JSON.parse(await readFile(join(state, "service.lock"), "utf8"));
    process.kill(owner.pid, 0);
    throw new Error("Run med stop with this state directory before installing the login service.");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ESRCH") throw error;
  }
  await mkdir(state, { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: true });
  const command = selfCommand(["serve", "--state-dir", state, "--port", String(port)]);
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[command.executable, ...command.args].map((v) => `<string>${escape(v)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(join(state, "service.log"))}</string><key>StandardErrorPath</key><string>${escape(join(state, "service.log"))}</string></dict></plist>`;
  await writeFile(path, plist, { mode: 0o600 });
  await exec("launchctl", ["bootstrap", domain, path]);
  console.log("Installed Med login service. Keep the executable at its current path.");
}
