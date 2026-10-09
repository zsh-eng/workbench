import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const tarball = resolve(process.argv[3] ?? "med-diff-0.1.0.tgz");
const output = resolve(".test-artifacts/package with spaces");
await mkdir(output, { recursive: true });
await mkdir(resolve("docs/validation"), { recursive: true });
const runners = [
  [
    "npx",
    ["--offline", "--yes", `--package=${tarball}`, "med-diff", repo, "--no-open", "--port", "0"],
  ],
  ["bunx", [`--package=${tarball}`, "med-diff", repo, "--no-open", "--port", "0"]],
];
const records = [];
for (const [command, args] of runners) {
  const child = spawn(command, args, {
    cwd: output,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  let diagnostic = "";
  child.stderr.on("data", (bytes) => {
    diagnostic += bytes;
  });
  try {
    const url = await new Promise((resolveUrl, reject) => {
      let text = "";
      const timer = setTimeout(() => reject(new Error(diagnostic || "Launch timed out")), 45000);
      child.stdout.on("data", (bytes) => {
        text += bytes;
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
        if (match) {
          clearTimeout(timer);
          resolveUrl(new URL(match[0]));
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`${code}: ${diagnostic}`));
      });
    });
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    url.hash = "";
    const response = await fetch(new URL("/api/session", url), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    const page = await fetch(url);
    const html = await page.text();
    if (!response.ok || !page.ok || !html.includes('<div id="root">'))
      throw new Error("Package did not serve its application");
    const fontBytes = [];
    for (const name of ["Geist-Variable.woff2", "PaperMono-Variable.woff2"]) {
      const font = await fetch(new URL(`/fonts/${name}`, url));
      const bytes = Buffer.from(await font.arrayBuffer());
      if (!font.ok || bytes.subarray(0, 4).toString() !== "wOF2")
        throw new Error(`Package did not serve ${name}`);
      fontBytes.push(bytes.byteLength);
    }
    records.push({
      runner: command,
      repository: body.repository.name,
      api: response.status,
      assets: page.status,
      pathWithSpaces: true,
      fontBytes,
    });
  } catch (error) {
    records.push({ runner: command, error: String(error) });
  } finally {
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
    await new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once("exit", done);
      setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch {}
        done();
      }, 3000).unref();
    });
  }
}
await writeFile(resolve("docs/validation/package.json"), JSON.stringify(records, null, 2) + "\n");
console.log(records);
if (records.some((record) => record.error)) process.exitCode = 1;
