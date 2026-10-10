import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step().catch(() => {});
});

// Releases are built for macOS on Apple Silicon, and the script refuses other machines.
it.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "installs the newest Med release with its checksum, once, and adds it to PATH",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "med-install-")));
    cleanup.push(() => rm(root, { recursive: true, force: true }));

    // Release archives as the release script writes them. 0.4.0 has a wrong checksum.
    const files = new Map<string, Buffer>();
    for (const version of ["0.1.0", "0.2.0", "0.4.0"]) {
      const name = `med-v${version}-macos-arm64`;
      const stage = join(root, "release", name);
      await mkdir(join(stage, "licenses", "upstream"), { recursive: true });
      await writeFile(join(stage, "med"), `#!/bin/sh\necho "med ${version}"\n`);
      await chmod(join(stage, "med"), 0o755);
      await writeFile(join(stage, "LICENSE"), "MIT\n");
      await writeFile(join(stage, "licenses", "upstream", "BUN-LICENSE.md"), "Bun notices\n");
      await exec("tar", ["-czf", `${name}.tar.gz`, "-C", join(root, "release"), name], {
        cwd: join(root, "release"),
      });
      const archive = await readFile(join(root, "release", `${name}.tar.gz`));
      const sha256 = createHash("sha256")
        .update(version === "0.4.0" ? "something else" : archive)
        .digest("hex");
      files.set(`/zsh-eng/workbench/releases/download/med-v${version}/${name}.tar.gz`, archive);
      files.set(
        `/zsh-eng/workbench/releases/download/med-v${version}/SHA256SUMS`,
        Buffer.from(`${sha256}  ${name}.tar.gz\n`),
      );
    }
    const script = resolve("install.sh");
    files.set("/install.sh", await readFile(script));
    // Newest first, as GitHub lists them: another app's release, a release
    // candidate, and the broken 0.4.0 come before it, but 0.4.0 is pinned only.
    files.set(
      "/repos/zsh-eng/workbench/releases",
      Buffer.from(
        JSON.stringify(
          ["reader-v3.0.0", "med-v0.3.0-rc.1", "med-v0.2.0", "med-v0.1.0"].map((tag_name) => ({
            tag_name,
            draft: false,
          })),
        ),
      ),
    );
    const server: Server = createServer((request, response) => {
      const body = files.get(new URL(request.url!, "http://localhost").pathname);
      response.writeHead(body ? 200 : 404).end(body);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanup.push(() => new Promise((done) => server.close(done)));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const home = join(root, "home");
    await mkdir(home);
    const env = {
      HOME: home,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      SHELL: "/bin/zsh",
      TMPDIR: root,
      MED_INSTALL_API: origin,
      MED_INSTALL_DOWNLOADS: origin,
    };
    // The documented form: the script arrives on standard input.
    const install = (...args: string[]) =>
      exec("/bin/sh", ["-c", `curl -fsSL ${origin}/install.sh | sh -s -- ${args.join(" ")}`], {
        env,
      });
    const med = join(home, ".local", "bin", "med");
    const version = async () => (await exec(med, ["--version"])).stdout.trim();
    const rc = () => readFile(join(home, ".zshrc"), "utf8");

    const first = await install();
    expect(await version()).toBe("med 0.2.0");
    expect(first.stdout).toContain("med skills install");
    expect(await rc()).toBe('\n# Med\nexport PATH="$HOME/.local/bin:$PATH"\n');
    expect(
      await readFile(
        join(home, ".local", "share", "med", "licenses", "upstream", "BUN-LICENSE.md"),
        "utf8",
      ),
    ).toBe("Bun notices\n");

    // Again: nothing to download, and the startup file keeps one PATH line.
    expect((await install()).stdout).toContain("Med 0.2.0 is already installed");
    expect(await rc()).toBe('\n# Med\nexport PATH="$HOME/.local/bin:$PATH"\n');

    // A pinned version replaces it; a bad checksum installs nothing.
    expect((await install("--version", "0.1.0")).stdout).toContain("If Med is running, restart it");
    expect(await version()).toBe("med 0.1.0");
    await expect(install("--version", "0.4.0")).rejects.toMatchObject({
      stderr: expect.stringContaining("does not match SHA256SUMS"),
    });
    expect(await version()).toBe("med 0.1.0");

    // --no-modify-path leaves startup files alone and says what to add.
    const other = join(root, "other");
    await mkdir(other);
    const quiet = await exec(
      "/bin/sh",
      ["-c", `curl -fsSL ${origin}/install.sh | sh -s -- --no-modify-path`],
      { env: { ...env, HOME: other } },
    );
    expect(quiet.stdout).toContain('Add it with: export PATH="$HOME/.local/bin:$PATH"');
    await expect(readFile(join(other, ".zshrc"))).rejects.toThrow("ENOENT");
  },
);
