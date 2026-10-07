import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStateDirectory, DEFAULT_PORT } from "../host/runtime/connection";
import {
  loginItem,
  loginItemPath,
  loginPlist,
  serviceLabel,
  setLoginItem,
} from "../host/service/login-item";
const exec = promisify(execFile);
export { serviceLabel };

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
      "Usage: med service install|uninstall [--port N] [--state-dir PATH]\n       med service login on|off|status [--port N] [--state-dir PATH]\nOpt in to a per-user macOS login service. Stop a manually started server before install.\nlogin on opens Med at the next login and leaves the running server as it is.",
    );
    return;
  }
  if (process.platform !== "darwin")
    throw new Error(
      "Login-service installation currently supports macOS. Use med serve with your OS service manager elsewhere.",
    );
  const state = getStateDirectory(values["state-dir"]),
    port = Number(values.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  if (positionals[0] === "login") {
    const choice = positionals[1] ?? "status";
    if (positionals.length > 2 || !["on", "off", "status"].includes(choice))
      throw new Error("Use med service login on, off, or status.");
    const item =
      choice === "status"
        ? await loginItem(state)
        : await setLoginItem(state, port, choice === "on");
    console.log(JSON.stringify(item));
    return;
  }
  if (positionals.length !== 1 || !["install", "uninstall"].includes(positionals[0]!))
    throw new Error("Use med service install, uninstall, or login.");
  const label = serviceLabel(state);
  const path = loginItemPath(state),
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
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, loginPlist(state, port), { mode: 0o600 });
  await exec("launchctl", ["bootstrap", domain, path]);
  console.log("Installed Med login service. Keep the executable at its current path.");
}
