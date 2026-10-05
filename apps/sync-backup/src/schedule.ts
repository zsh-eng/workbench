import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const label = "app.zsheng.workbench-backup";
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

export function schedule(action: string, origin: string, directory: string) {
  if (process.platform !== "darwin")
    throw Error("Scheduling requires macOS launchd");
  const domain = `gui/${process.getuid!()}`;
  const service = `${domain}/${label}`;
  const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const launchctl = (...args: string[]) =>
    Bun.spawnSync(["/bin/launchctl", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  const current = launchctl("print", service);
  if (action === "status")
    return {
      installed: existsSync(plist),
      loaded: current.exitCode === 0,
      plist,
      // launchctl's output includes the actual configured paths and last exit code.
      launchd: current.exitCode === 0 ? current.stdout.toString() : null,
    };
  if (action === "uninstall") {
    if (current.exitCode === 0) {
      const result = launchctl("bootout", service);
      if (result.exitCode !== 0) throw Error(result.stderr.toString().trim());
    }
    if (existsSync(plist)) unlinkSync(plist);
    return { installed: false, plist };
  }
  if (existsSync(plist) || current.exitCode === 0)
    throw Error(
      "Schedule already exists. Use schedule status, or uninstall before replacing it.",
    );
  mkdirSync(dirname(plist), { recursive: true });
  const logs = join(directory, "logs");
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const args = [
    process.execPath,
    cli,
    "sync",
    "--origin",
    origin,
    "--data-dir",
    directory,
    "--json",
  ];
  const stdout = join(logs, "sync.stdout.log");
  const stderr = join(logs, "sync.stderr.log");
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(dirname(cli))}</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>3600</integer>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(stdout)}</string>
<key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict></plist>
`,
    { mode: 0o600, flag: "wx" },
  );
  const result = launchctl("bootstrap", domain, plist);
  if (result.exitCode !== 0)
    throw Error(
      `Could not load schedule: ${result.stderr.toString().trim()}. Remove it with schedule uninstall before retrying.`,
    );
  return { installed: true, intervalSeconds: 3600, plist, stdout, stderr };
}
