// The test bed for the performance budget: the exploration demo world, plus
// threads at real size. Each extra thread has its own worktree of the demo
// repository and a long Claude Code transcript; one has a diff of about
// 10,000 lines. Everything lives under a scratch HOME.
//
// Transcripts are clones of long ended sessions in ~/.claude/projects (read
// only), which a fixed rule picks on this computer; see `realTranscripts`.
// Without them, a generator writes synthetic ones of the same sizes, with the
// record mix of real long sessions. The budget records which set it used, and
// only their sizes.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildWorld, projectFolder } from "../explorations/world.mjs";

const MINUTE = 60_000;

/** The sizes of the long transcripts, in MB: each real one is the largest
 * ended transcript at or below its size; a synthetic one has that size. */
const SIZES_MB = [294, 201, 111, 79, 32, 17];
/** A transcript that has not changed for this long has ended. */
const ENDED_MS = 2 * 60 * MINUTE;
/** The pick of real transcripts on this computer. The folder is not in Git:
 * the paths name private projects and sessions. */
const PICK = join(import.meta.dirname, "../../.benchmarks/perf/transcripts.json");

/** The long threads, newest first: ⌘1 is the first. Titles stay short. */
const LONG_TITLES = [
  "Harbour import",
  "Moon phase column",
  "Station map",
  "Offline tables",
  "Units in config",
  "Share a table",
];

function git(cwd, args, env) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env }).trim();
}

/** A seeded random source (mulberry32), so a synthetic set is the same each run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the tide station harbour range datum chart high low water moon spring neap table time zone offset height metre feet predict constituent phase amplitude test build check render pane thread session diff file line commit branch worktree review note guide search filter region query parse format value result error state update layout scroll frame".split(
    " ",
  );

function words(next, count) {
  let text = "";
  for (let i = 0; i < count; i++) text += (i ? " " : "") + WORDS[Math.floor(next() * WORDS.length)];
  return text;
}

/** Synthetic code with enough variety for the highlighter. */
function codeLines(next, count, name) {
  const lines = [`// ${name}: ${words(next, 8)}.`, `import { predict } from "../tides";`, ""];
  while (lines.length < count) {
    const kind = Math.floor(next() * 6);
    const id = `${WORDS[Math.floor(next() * WORDS.length)]}${Math.floor(next() * 1000)}`;
    if (kind === 0) lines.push(`/** ${words(next, 6 + Math.floor(next() * 8))}. */`);
    else if (kind === 1)
      lines.push(
        `export const ${id} = { amplitude: ${(next() * 4).toFixed(3)}, phase: ${(next() * 360).toFixed(1)}, speed: ${(next() * 30).toFixed(5)} };`,
      );
    else if (kind === 2)
      lines.push(
        `export function ${id}(height: number, at: Date): number {`,
        `  const hours = (at.getTime() - ${Math.floor(next() * 1e12)}) / 3_600_000;`,
        `  return height * Math.cos(((${(next() * 30).toFixed(4)} * hours - ${(next() * 360).toFixed(1)}) * Math.PI) / 180);`,
        "}",
        "",
      );
    else if (kind === 3) lines.push(`  "${id}": "${words(next, 3)}",`);
    else if (kind === 4)
      lines.push(`if (${id} > ${Math.floor(next() * 90)}) throw new Error("${words(next, 5)}");`);
    else
      lines.push(
        `const ${id} = [${Array.from({ length: 6 }, () => (next() * 10).toFixed(2)).join(", ")}];`,
      );
  }
  return lines.slice(0, count).join("\n") + "\n";
}

/**
 * Writes a synthetic Claude Code transcript of about `bytes`, with the record
 * mix of real long sessions: by bytes, half are tool results with screenshots,
 * then text tool results, thinking, commands, attachments, and replies.
 */
async function syntheticTranscript({ path, id, cwd, bytes, seed }) {
  const next = random(seed);
  // Base64 of random bytes: as incompressible as a PNG screenshot.
  const pool = Buffer.from(
    Array.from({ length: 1_400_000 }, () => Math.floor(next() * 256)),
  ).toString("base64");
  await mkdir(dirname(path), { recursive: true });
  const out = createWriteStream(path);
  let written = 0;
  let parent = null;
  let at = Date.now() - 3 * 60 * MINUTE;
  const write = (record) => {
    const uuid = randomUUID();
    const line = JSON.stringify({
      parentUuid: parent,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId: id,
      version: "2.1.295",
      gitBranch: "main",
      timestamp: new Date((at += 1500)).toISOString(),
      uuid,
      ...record,
    });
    parent = uuid;
    written += line.length + 1;
    return out.write(`${line}\n`) ? undefined : new Promise((done) => out.once("drain", done));
  };
  const assistant = (content, stop = null) =>
    write({
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        id: `msg_${randomUUID().slice(0, 16)}`,
        type: "message",
        role: "assistant",
        content,
        stop_reason: stop,
        usage: { input_tokens: 12, output_tokens: 180 },
      },
    });
  const user = (content) => write({ type: "user", message: { role: "user", content } });
  const toolUse = async (name, input) => {
    const toolId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await assistant([{ type: "tool_use", id: toolId, name, input }], "tool_use");
    return toolId;
  };
  while (written < bytes) {
    await user([{ type: "text", text: `${words(next, 20 + Math.floor(next() * 80))}?` }]);
    const steps = 8 + Math.floor(next() * 20);
    for (let step = 0; step < steps && written < bytes; step++) {
      const roll = next();
      if (roll < 0.25)
        await assistant([
          {
            type: "thinking",
            thinking: words(next, 200 + Math.floor(next() * 900)),
            signature: "x",
          },
        ]);
      if (roll < 0.06) {
        // A screenshot: about 400 KB of base64, as the browser tools return.
        const length = 250_000 + Math.floor(next() * 400_000);
        const start = Math.floor(next() * (pool.length - length));
        const toolId = await toolUse("mcp__browser__screenshot", { action: "screenshot" });
        await user([
          {
            type: "tool_result",
            tool_use_id: toolId,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: pool.slice(start, start + length),
                },
              },
            ],
          },
        ]);
      } else if (roll < 0.75) {
        const command = `${["bun test", "rg -n", "git diff --stat", "bun run build", "ls -la"][Math.floor(next() * 5)]} ${words(next, 3)}`;
        const toolId = await toolUse("Bash", { command, description: words(next, 5) });
        const lines = Array.from({ length: 10 + Math.floor(next() * 120) }, () =>
          words(next, 6 + Math.floor(next() * 10)),
        );
        await user([{ type: "tool_result", tool_use_id: toolId, content: lines.join("\n") }]);
      } else if (roll < 0.85) {
        const toolId = await toolUse("Read", {
          file_path: `${cwd}/src/${WORDS[Math.floor(next() * WORDS.length)]}.ts`,
        });
        await user([
          {
            type: "tool_result",
            tool_use_id: toolId,
            content: codeLines(next, 40 + Math.floor(next() * 160), "read"),
          },
        ]);
      } else {
        const toolId = await toolUse("Edit", {
          file_path: `${cwd}/src/search.ts`,
          old_string: words(next, 12),
          new_string: words(next, 14),
        });
        await user([
          { type: "tool_result", tool_use_id: toolId, content: "The file has been updated." },
        ]);
      }
      if (next() < 0.3)
        await write({
          type: "attachment",
          attachment: {
            type: "edited_text_file",
            filename: `${cwd}/src/search.ts`,
            snippet: words(next, 150),
          },
        });
    }
    const reply = `## ${words(next, 4)}\n\n${words(next, 40)}\n\n- ${words(next, 12)}\n- ${words(next, 10)}\n\n\`\`\`ts\n${codeLines(next, 8, "reply")}\`\`\`\n\n${words(next, 30)}`;
    await assistant([{ type: "text", text: reply }], "end_turn");
    await write({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 0,
      hookInfos: [],
      hookErrors: [],
      preventedContinuation: false,
      stopReason: "",
      hasOutput: false,
      level: "suggestion",
    });
  }
  await new Promise((done) => out.end(done));
  return written;
}

/** A transcript file as a source: its path, session ID, and size. */
async function source(path) {
  const info = await stat(path).catch(() => undefined);
  return info?.isFile() ? { path, id: basename(path, ".jsonl"), bytes: info.size } : undefined;
}

/**
 * Real transcripts for the long threads, or undefined. The first run picks,
 * for each of SIZES_MB, the largest ended main transcript in
 * ~/.claude/projects at or below that size, and keeps the pick in
 * .benchmarks/perf/transcripts.json, so that later runs use the same files
 * while they all exist. Delete that file to pick again.
 */
async function realTranscripts(now) {
  const saved = await readFile(PICK, "utf8")
    .then((text) => JSON.parse(text).paths)
    .catch(() => undefined);
  if (Array.isArray(saved) && saved.length === SIZES_MB.length) {
    const found = await Promise.all(saved.map(source));
    if (found.every(Boolean)) return found;
  }
  const root = join(homedir(), ".claude", "projects");
  const candidates = [];
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    const files = await readdir(join(root, folder.name)).catch(() => []);
    for (const name of files.filter((file) => file.endsWith(".jsonl"))) {
      const path = join(root, folder.name, name);
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && now - info.mtimeMs > ENDED_MS && info.size >= 10e6)
        candidates.push({ path, id: basename(name, ".jsonl"), bytes: info.size });
    }
  }
  candidates.sort((a, b) => b.bytes - a.bytes);
  const picked = [];
  for (const mb of SIZES_MB) {
    const entry = candidates.find((item) => item.bytes <= mb * 1e6 && !picked.includes(item));
    if (!entry) return undefined;
    picked.push(entry);
  }
  await mkdir(dirname(PICK), { recursive: true });
  await writeFile(
    PICK,
    `${JSON.stringify({ paths: picked.map((entry) => entry.path) }, null, 2)}\n`,
  );
  return picked;
}

/**
 * Two commits on the worktree's branch: one adds `files` files of 300 lines,
 * and the next changes ten places in each and adds a few files, as a large
 * refactor does. The review compares the two, so its diff has many hunks
 * with context. Returns the number of lines in that diff.
 */
async function bigChange(tree, files, env) {
  const next = random(7);
  const regions = ["north-sea", "atlantic", "baltic", "mediterranean"];
  const paths = [];
  for (let i = 0; i < files; i++) {
    const path = `src/atlas/${regions[i % regions.length]}/station-${String(i).padStart(3, "0")}.ts`;
    await mkdir(dirname(join(tree, path)), { recursive: true });
    await writeFile(join(tree, path), codeLines(next, 300, path));
    paths.push(path);
  }
  git(tree, ["add", "-A"], env);
  git(tree, ["commit", "-qm", "Add the harbour atlas"], env);
  for (const path of paths) {
    const lines = (await readFile(join(tree, path), "utf8")).split("\n");
    // Ten hunks: six lines replaced at every 30th line.
    for (let hunk = 0; hunk < 10; hunk++) {
      const at = 8 + hunk * 29;
      const fresh = codeLines(next, 6, `${path} ${hunk}`).split("\n").slice(0, 6);
      lines.splice(at, 6, ...fresh);
    }
    await writeFile(join(tree, path), lines.join("\n"));
  }
  for (let i = 0; i < 4; i++)
    await writeFile(join(tree, `src/atlas/index-${i}.ts`), codeLines(next, 250, `index ${i}`));
  git(tree, ["add", "-A"], env);
  git(tree, ["commit", "-qm", "Use the harbour atlas"], env);
  return git(tree, ["diff", "HEAD~1", "HEAD"], env).split("\n").length;
}

/**
 * Builds the test bed under `root` and returns it. `transcripts` is "auto"
 * (real when available), "real", or "synthetic".
 */
/** The layers of the stack thread, bottom first: a branch each, on the one below. */
const STACK_LAYERS = [
  {
    branch: "stack/parse",
    title: "Parse station queries",
    files: {
      "src/query.ts": `/** A station search, split into its words and an optional region. */
export interface Query {
  words: string[];
  region?: string;
}

export function parseQuery(text: string): Query {
  const words = text.trim().toLowerCase().split(/\\s+/).filter(Boolean);
  return { words };
}
`,
    },
  },
  {
    branch: "stack/rank",
    title: "Rank search results",
    files: {
      "src/rank.ts": `/** How well a station's name matches the query's words: 0 is no match. */
export function rank(name: string, words: readonly string[]): number {
  const lower = name.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (lower === word) score += 3;
    else if (lower.startsWith(word)) score += 2;
    else if (lower.includes(word)) score += 1;
  }
  return score;
}
`,
    },
  },
  {
    branch: "stack/fold",
    title: "Fold accents in station names",
    files: {
      "src/fold.ts": `/** A name without accents, so "Saint-Malo" and "saint malo" match. */
export function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}
`,
      "src/rank.ts": `import { fold } from "./fold";

/** How well a station's name matches the query's words: 0 is no match. */
export function rank(name: string, words: readonly string[]): number {
  const folded = fold(name);
  let score = 0;
  for (const word of words.map(fold)) {
    if (folded === word) score += 3;
    else if (folded.startsWith(word)) score += 2;
    else if (folded.includes(word)) score += 1;
  }
  return score;
}
`,
    },
  },
  {
    branch: "stack/region",
    title: "Search by region",
    files: {
      "src/query.ts": `/** A station search, split into its words and an optional region. */
export interface Query {
  words: string[];
  region?: string;
}

const REGIONS = ["north sea", "atlantic", "baltic", "mediterranean"];

export function parseQuery(text: string): Query {
  let rest = text.trim().toLowerCase();
  const region = REGIONS.find((name) => rest.startsWith(\`\${name}:\`));
  if (region) rest = rest.slice(region.length + 1);
  const words = rest.split(/\\s+/).filter(Boolean);
  return region ? { words, region } : { words };
}
`,
      "src/query.test.ts": `import { expect, test } from "bun:test";
import { parseQuery } from "./query";

test("a region prefix narrows the search", () => {
  expect(parseQuery("Atlantic: brest")).toEqual({ words: ["brest"], region: "atlantic" });
});
`,
    },
  },
];

/**
 * Four branches of the demo repository, each one commit on the one below,
 * in a worktree of their own: a stack of reviews (docs/STACKS.md). Returns
 * the worktree and each layer's branch, title, and head.
 */
export async function buildStack(repo, trees, env) {
  const tree = join(trees, "stack");
  git(repo, ["worktree", "add", "-q", "--detach", tree, "main"], env);
  const layers = [];
  for (const layer of STACK_LAYERS) {
    for (const [path, text] of Object.entries(layer.files)) {
      await mkdir(dirname(join(tree, path)), { recursive: true });
      await writeFile(join(tree, path), text);
    }
    git(tree, ["add", "-A"], env);
    git(tree, ["commit", "-qm", layer.title], env);
    git(tree, ["branch", layer.branch], env);
    layers.push({
      branch: layer.branch,
      title: layer.title,
      head: git(tree, ["rev-parse", "HEAD"], env),
    });
  }
  // The worktree is on the top layer, as an agent's checkout would be.
  git(tree, ["switch", "-q", layers.at(-1).branch], env);
  return { tree, layers };
}

export async function buildFixture({
  root,
  transcripts = "auto",
  now = Date.now(),
  log = () => {},
}) {
  const world = await buildWorld(join(root, "world"), now);
  const env = { ...process.env, ...world.env };
  const trees = join(world.home, "code", "tide.worktrees");
  const worktree = (name) => {
    const path = join(trees, name);
    git(world.repo, ["worktree", "add", "-q", "-b", name, path, "main"], env);
    return path;
  };

  let sources = transcripts === "synthetic" ? undefined : await realTranscripts(now);
  if (!sources && transcripts === "real")
    throw new Error("This computer has too few long ended transcripts in ~/.claude/projects.");
  const kind = sources ? "real" : "synthetic";
  sources ??= SIZES_MB.map((mb) => ({ bytes: mb * 1e6 }));

  // The long threads: one worktree each, with a small uncommitted change.
  const long = [];
  for (const [index, source] of sources.entries()) {
    const name = `long-${index + 1}`;
    const tree = worktree(name);
    await writeFile(
      join(tree, "src/stations.ts"),
      (await readFile(join(tree, "src/stations.ts"), "utf8")).replace(
        "];",
        `  { id: "extra-${index}", name: "Extra ${index}", region: "Atlantic", timeZone: "Europe/Lisbon", range: ${(2 + index / 10).toFixed(1)} },\n];`,
      ),
    );
    await writeFile(
      join(tree, `src/extra-${index}.ts`),
      codeLines(random(100 + index), 40, `extra ${index}`),
    );
    const id = source.id ?? randomUUID();
    const path = join(world.home, ".claude", "projects", projectFolder(tree), `${id}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    let bytes;
    if (source.path) {
      // A clone on APFS: no bytes copy, and the original is never opened for writing.
      await copyFile(source.path, path, constants.COPYFILE_FICLONE);
      bytes = source.bytes;
    } else
      bytes = await syntheticTranscript({
        path,
        id,
        cwd: tree,
        bytes: source.bytes,
        seed: 11 + index,
      });
    // Ten minutes old: the agent has stopped, and the thread stays in view.
    const at = new Date(now - (10 + index) * MINUTE);
    await utimes(path, at, at);
    long.push({ key: name, title: LONG_TITLES[index] ?? name, tree, session: id, bytes });
    log(`  ${name}: ${(bytes / 1e6).toFixed(0)} MB transcript (${kind})`);
  }

  // A stack of four reviews in one thread, for switches between its layers.
  const stack = await buildStack(world.repo, trees, env);

  // The large diff: about 10,000 lines in many hunks, with a short session.
  const atlasTree = worktree("atlas");
  const atlasLines = await bigChange(atlasTree, 48, env);
  const atlasSession = randomUUID();
  const atlasPath = join(
    world.home,
    ".claude",
    "projects",
    projectFolder(atlasTree),
    `${atlasSession}.jsonl`,
  );
  await syntheticTranscript({
    path: atlasPath,
    id: atlasSession,
    cwd: atlasTree,
    bytes: 800_000,
    seed: 5,
  });
  const atlasAt = new Date(now - 30 * MINUTE);
  await utimes(atlasPath, atlasAt, atlasAt);

  const fixture = {
    root,
    world,
    transcripts: kind,
    long,
    atlas: {
      key: "atlas",
      title: "Harbour atlas",
      tree: atlasTree,
      session: atlasSession,
      lines: atlasLines,
    },
    stack: {
      key: "stack",
      title: "Station search, in layers",
      tree: stack.tree,
      layers: stack.layers,
    },
    glossary: {
      key: "glossary",
      title: "README glossary",
      tree: world.trees.glossary,
      session: world.sessions.glossary.id,
    },
    /** A digest of the inputs that counts depend on. */
    digest: createHash("sha256")
      .update(JSON.stringify({ kind, sizes: long.map((entry) => entry.bytes), atlasLines }))
      .digest("hex")
      .slice(0, 12),
  };

  /** Adds the world's threads, then ours; the last one added is ⌘1. */
  fixture.register = (cli) => {
    world.register(cli);
    const create = (thread, comparison) =>
      cli(
        [
          "review",
          "create",
          "--title",
          thread.title,
          "--repo",
          thread.tree,
          ...comparison,
          "--key",
          thread.key,
          "--no-pr",
        ],
        { CLAUDE_CODE_SESSION_ID: thread.session },
      );
    // The stack comes first, so the threads after it keep their ⌘ keys.
    cli([
      "review",
      "create",
      "--title",
      fixture.stack.title,
      "--repo",
      fixture.stack.tree,
      "--base",
      "main",
      "--stack",
      ...fixture.stack.layers.map((layer) => layer.branch),
    ]);
    create(fixture.glossary, ["--working"]);
    create(fixture.atlas, ["--base", "atlas~1", "--head", "atlas"]);
    for (const thread of long.toReversed()) create(thread, ["--working"]);
  };
  return fixture;
}
