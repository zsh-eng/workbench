import { createHash } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userHome } from "./discover";
import { selfCommand } from "./self";

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** The LaunchAgent label for one state directory. */
export function serviceLabel(state: string) {
  return `local.med.${createHash("sha256").update(state).digest("hex").slice(0, 12)}`;
}

export const loginItemPath = (state: string) =>
  join(userHome(), "Library", "LaunchAgents", `${serviceLabel(state)}.plist`);

/** A LaunchAgent that serves this state directory at login and after a crash. */
export function loginPlist(state: string, port: number) {
  const label = serviceLabel(state);
  const command = selfCommand(["serve", "--state-dir", state, "--port", String(port)]);
  // launchd starts agents with the system PATH only. Keep the installer's PATH
  // so the service finds the same Git and Go as a server started in a terminal.
  const searchPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const log = escape(join(state, "service.log"));
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[command.executable, ...command.args].map((v) => `<string>${escape(v)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(searchPath)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string></dict></plist>`;
}

export interface LoginItem {
  /** Login items are a macOS feature. */
  available: boolean;
  enabled: boolean;
}

export async function loginItem(state: string): Promise<LoginItem> {
  if (process.platform !== "darwin") return { available: false, enabled: false };
  const enabled = await stat(loginItemPath(state)).then(
    () => true,
    () => false,
  );
  return { available: true, enabled };
}

/**
 * Writes or removes the login item without starting or stopping anything:
 * launchd loads the agents in LaunchAgents when the user logs in, so the
 * server that is running now keeps running.
 */
export async function setLoginItem(state: string, port: number, enabled: boolean) {
  if (process.platform !== "darwin")
    throw new Error("Opening at login is available on macOS. Use your system's service manager.");
  const path = loginItemPath(state);
  if (enabled) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, loginPlist(state, port), { mode: 0o600 });
  } else
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  return loginItem(state);
}
