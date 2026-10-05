import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
export const defaultDirectory =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Workbench Backup")
    : join(homedir(), ".local", "share", "workbench-backup");
const account = (origin: string) =>
  new Bun.CryptoHasher("sha256").update(origin).digest("hex");
const credentialPath = (directory: string) =>
  join(directory, "credential.json");
export function getCredential(
  origin: string,
  directory: string,
): string | null {
  if (process.platform === "darwin") {
    const p = Bun.spawnSync(
      [
        "/usr/bin/security",
        "find-generic-password",
        "-s",
        "workbench-backup",
        "-a",
        account(origin),
        "-w",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  }
  if (!existsSync(credentialPath(directory))) return null;
  const value = JSON.parse(readFileSync(credentialPath(directory), "utf8"));
  return value.origin === origin ? value.token : null;
}
export function saveCredential(
  origin: string,
  directory: string,
  token: string,
) {
  if (!/^wb_[a-f0-9]{64}$/.test(token)) throw Error("Invalid credential");
  if (process.platform === "darwin") {
    // Interactive stdin keeps the secret out of process arguments and shell history.
    const input = `add-generic-password -U -s workbench-backup -a ${account(origin)} -w ${token}\n`;
    const p = Bun.spawnSync(["/usr/bin/security", "-i"], {
      stdin: Buffer.from(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0 || p.stderr.toString().includes("SecKeychain"))
      throw Error("Could not save credential in Keychain");
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(credentialPath(directory), JSON.stringify({ origin, token }), {
    mode: 0o600,
  });
}
export function removeCredential(origin: string, directory: string) {
  if (process.platform === "darwin")
    Bun.spawnSync(
      [
        "/usr/bin/security",
        "delete-generic-password",
        "-s",
        "workbench-backup",
        "-a",
        account(origin),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
  else if (existsSync(credentialPath(directory)))
    unlinkSync(credentialPath(directory));
}
export function normalizeOrigin(input: string) {
  const u = new URL(input);
  if (u.username || u.password || u.pathname !== "/" || u.search || u.hash)
    throw Error("--origin must be a server origin");
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw Error("HTTPS is required except on loopback");
  return u.origin;
}
export async function authRequest(
  origin: string,
  path: string,
  body: object,
  token?: string,
) {
  const r = await fetch(origin + path, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { response: r, body: (await r.json()) as any };
}
export async function login(
  origin: string,
  directory: string,
  noBrowser: boolean,
) {
  const { response, body } = await authRequest(origin, "/api/cli/device", {});
  if (!response.ok) throw Error(`Login unavailable (${response.status})`);
  const url = new URL(body.verification_uri);
  if (
    url.origin !== origin ||
    url.pathname !== "/device" ||
    !Number.isFinite(body.expires_in) ||
    !Number.isFinite(body.interval)
  )
    throw Error("Invalid device login response");
  console.error(
    `Open ${url.href}\nEnter code: ${body.user_code}\nWaiting for approval…`,
  );
  if (!noBrowser && process.platform === "darwin")
    Bun.spawn(["open", url.href], { stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + Math.min(body.expires_in, 600) * 1000;
  let interval = Math.max(body.interval, 5);
  while (Date.now() < deadline) {
    await Bun.sleep(interval * 1000);
    const result = await authRequest(origin, "/api/cli/token", {
      device_code: body.device_code,
    });
    if (result.response.ok) {
      saveCredential(origin, directory, result.body.access_token);
      return;
    }
    if (result.body.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (result.body.error === "authorization_pending") continue;
    throw Error(`Login failed: ${result.body.error}`);
  }
  throw Error("Login code expired. Run wb auth login again.");
}
