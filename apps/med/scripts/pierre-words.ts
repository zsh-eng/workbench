/**
 * Build Med's copy of Pierre Words, its Markdown renderer in WebAssembly, with
 * Med's patch, into src/web/markdown/words/words-wasm.ts.
 *
 *   git clone --filter=blob:none --sparse https://github.com/pierrecomputer/pierre /tmp/pierre
 *   git -C /tmp/pierre sparse-checkout set packages/words packages/wat-tools
 *   git -C /tmp/pierre checkout 3e96f6263e222aa08e9381c207f58508f90e5f2c
 *   bun scripts/pierre-words.ts /tmp/pierre
 *
 * The script applies upstream/pierre-words.patch, installs Words' build tools
 * in the clone, builds, and writes the module. The same commit and patch give
 * the same bytes. See upstream/PIERRE-WORDS.md.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COMMIT = "3e96f6263e222aa08e9381c207f58508f90e5f2c";
// Words' own versions, from the clone's pnpm-workspace.yaml.
const TOOLS = ["wabt@1.0.39", "binaryen@132.0.0"];

const med = resolve(import.meta.dirname, "..");
const patch = join(med, "upstream/pierre-words.patch");
const out = join(med, "src/web/markdown/words/words-wasm.ts");
const clone = process.argv[2] ? resolve(process.argv[2]) : "";
if (!clone || !existsSync(join(clone, "packages/words/scripts/build.ts"))) {
  console.error("Usage: bun scripts/pierre-words.ts <a clone of pierrecomputer/pierre>");
  process.exit(1);
}
const run = (command: string, args: string[], cwd = clone) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

const head = run("git", ["rev-parse", "HEAD"]);
if (head !== COMMIT) throw new Error(`Check out ${COMMIT} first: the clone is at ${head}.`);
// A clone that a run patched already keeps its patch.
try {
  execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd: clone, stdio: "ignore" });
} catch {
  run("git", ["apply", patch]);
}

// The tools in a folder of their own, as the clone's own install would need
// its whole workspace; Words' build finds them through the clone's node_modules.
const tools = join(clone, ".med-build");
mkdirSync(tools, { recursive: true });
writeFileSync(join(tools, "package.json"), '{ "private": true }\n');
run("npm", ["install", "--no-audit", "--no-fund", "--no-save", ...TOOLS], tools);
mkdirSync(join(tools, "node_modules/@pierre"), { recursive: true });
rmSync(join(tools, "node_modules/@pierre/wat-tools"), { force: true });
symlinkSync(join(clone, "packages/wat-tools"), join(tools, "node_modules/@pierre/wat-tools"));
if (!existsSync(join(clone, "node_modules")))
  symlinkSync(join(tools, "node_modules"), join(clone, "node_modules"));

console.log(run(process.execPath, ["scripts/build.ts"], join(clone, "packages/words")));
const wasm = readFileSync(join(clone, "packages/words/dist/words.wasm"));
const hash = createHash("sha256").update(wasm).digest("hex");
writeFileSync(
  out,
  `// Pierre Words with Med's patch, as base64. scripts/pierre-words.ts writes this\n` +
    `// file; upstream/PIERRE-WORDS.md says what it holds. SHA-256 ${hash}\n` +
    `export default "${wasm.toString("base64")}";\n`,
);
console.log(`Wrote ${out}: ${wasm.length} bytes of WebAssembly, SHA-256 ${hash}.`);
