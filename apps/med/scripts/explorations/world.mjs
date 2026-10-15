// The demo world for Med's design explorations: one small repository, its
// agents' worktrees, and the transcripts of the Claude Code and Codex sessions
// that made their changes. Every edit in a transcript is the edit in its
// worktree, so a feature that reads transcripts sees the diff it explains.
//
// HOME for the host and the CLI is <root>/home, so Med shows ~/code/tide.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { buildWeekView, registerWeekView } from "./week-view.mjs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- the code

const files = {
  "package.json": `{
  "name": "tide",
  "version": "0.3.0",
  "description": "Tide tables for harbours",
  "type": "module",
  "bin": { "tide": "src/cli.ts" },
  "scripts": { "test": "bun test" }
}
`,
  "README.md": `# tide

Tide tables for harbours, in a terminal.

\`\`\`sh
tide brest 2026-10-15
\`\`\`

Brest
  high 04:41  6.1 m
  low  10:53  0.0 m
`,
  "src/stations.ts": `export interface Station {
  id: string;
  name: string;
  region: "North Sea" | "Atlantic" | "Baltic" | "Mediterranean";
  timeZone: string;
  /** Mean tidal range in metres. */
  range: number;
}

export const stations: Station[] = [
  { id: "aberdeen", name: "Aberdeen", region: "North Sea", timeZone: "Europe/London", range: 3.7 },
  { id: "alesund", name: "Ålesund", region: "Atlantic", timeZone: "Europe/Oslo", range: 1.9 },
  { id: "brest", name: "Brest", region: "Atlantic", timeZone: "Europe/Paris", range: 6.1 },
  { id: "cadiz", name: "Cádiz", region: "Atlantic", timeZone: "Europe/Madrid", range: 2.3 },
  { id: "den-helder", name: "Den Helder", region: "North Sea", timeZone: "Europe/Amsterdam", range: 1.4 },
  { id: "gdansk", name: "Gdańsk", region: "Baltic", timeZone: "Europe/Warsaw", range: 0.1 },
  { id: "marseille", name: "Marseille", region: "Mediterranean", timeZone: "Europe/Paris", range: 0.2 },
  { id: "st-malo", name: "Saint-Malo", region: "Atlantic", timeZone: "Europe/Paris", range: 8.0 },
  { id: "tromso", name: "Tromsø", region: "Atlantic", timeZone: "Europe/Oslo", range: 2.2 },
];
`,
  "src/tides.ts": `import type { Station } from "./stations";

export interface Tide {
  kind: "high" | "low";
  at: Date;
  /** Height above chart datum, in metres. */
  height: number;
}

/** The principal lunar semidiurnal period (M2), in milliseconds. */
const M2 = 12.4206012 * 60 * 60 * 1000;
/** A high water at Brest, which sets the phase for every station. */
const EPOCH = Date.UTC(2026, 0, 1, 4, 41);

/** High and low waters for a station on one day: a single M2 constituent,
 * which is close enough for a harbour table and far from a pilot's. */
export function predict(station: Station, day: Date): Tide[] {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const end = start + 24 * 60 * 60 * 1000;
  const tides: Tide[] = [];
  let at = EPOCH + Math.ceil((start - EPOCH) / (M2 / 2)) * (M2 / 2);
  for (; at < end; at += M2 / 2) {
    const high = Math.abs(Math.round((at - EPOCH) / (M2 / 2))) % 2 === 0;
    tides.push({ kind: high ? "high" : "low", at: new Date(at), height: high ? station.range : 0 });
  }
  return tides;
}
`,
  "src/cli.ts": `import { predict } from "./tides";
import { findStations } from "./search";
import { formatHeight, formatTime } from "./format";

const [query = "", date] = process.argv.slice(2);
const day = date ? new Date(date) : new Date();
for (const station of findStations(query)) {
  console.log(station.name);
  for (const tide of predict(station, day))
    console.log(\`  \${tide.kind.padEnd(4)} \${formatTime(tide.at, station.timeZone)}  \${formatHeight(tide.height)}\`);
}
`,
};

const search0 = `import { stations, type Station } from "./stations";

/** Stations whose name contains the query. */
export function findStations(query: string): Station[] {
  return stations.filter((station) => station.name.includes(query));
}
`;
const searchTest0 = `import { expect, test } from "bun:test";
import { findStations } from "../src/search";

test("finds a station by its name", () => {
  expect(findStations("Brest").map((station) => station.id)).toEqual(["brest"]);
});
`;
const format0 = `/** A time of day at a station, such as 04:41. */
export function formatTime(at: Date, timeZone: string) {
  const offset = new Date(at.toLocaleString("en-US", { timeZone })).getTime() - at.getTime();
  const local = new Date(at.getTime() + offset);
  return \`\${pad(local.getHours())}:\${pad(local.getMinutes())}\`;
}

/** A height in metres, such as 3.7 m. */
export function formatHeight(metres: number) {
  return \`\${metres} m\`;
}

const pad = (value: number) => String(value).padStart(2, "0");
`;
const format1 = format0
  .replace(
    "/** A height in metres, such as 3.7 m. */",
    "/** A height in metres with one decimal, such as 3.7 m. */",
  )
  .replace("return `${metres} m`;", "return `${metres.toFixed(1)} m`;");
const formatTest1 = `import { expect, test } from "bun:test";
import { formatHeight, formatTime } from "../src/format";

test("formats a height with one decimal", () => {
  expect(formatHeight(3.75)).toBe("3.8 m");
});

test("formats a time in the station's zone", () => {
  expect(formatTime(new Date("2026-07-01T04:41:00Z"), "Europe/London")).toBe("05:41");
});
`;
const readmeModel = `
## How it predicts

tide uses one constituent, the principal lunar semidiurnal tide (M2), with a
period of 12 hours 25 minutes. Each station has its mean range. This is close
enough for a harbour table. Do not navigate with it.
`;

// ------------------------------------------------------------ the sessions

/** The steps of an agent's session; `world.mjs` applies the edits and writes
 * the transcript from them. */
const stationSearch = [
  {
    user: "Station search only matches exact names. Make it forgiving: ignore case, rank names that start with the text first, and let me filter by region, such as region:atlantic.",
  },
  {
    think:
      "The search is one includes() call in src/search.ts. I need folding, ranking, and a small query parser.",
  },
  { read: "src/search.ts" },
  {
    bash: "rg -n findStations src tests",
    output:
      'src/cli.ts:2:import { findStations } from "./search";\nsrc/cli.ts:7:for (const station of findStations(query)) {\nsrc/search.ts:4:export function findStations(query: string): Station[] {\ntests/search.test.ts:2:import { findStations } from "../src/search";',
  },
  {
    write: "src/filters.ts",
    content: `/** A search query: its text, and the regions that \`region:\` names. */
export interface Query {
  text: string;
  regions: string[];
}

/** Splits "sa region:atlantic region:north-sea" into text and regions. */
export function parseQuery(query: string): Query {
  const regions: string[] = [];
  const text = query
    .replace(/\\bregion:(\\S+)/gi, (_, region: string) => {
      regions.push(region.toLowerCase().replace(/-/g, " "));
      return "";
    })
    .trim();
  return { text, regions };
}
`,
  },
  {
    edit: "src/search.ts",
    old: `import { stations, type Station } from "./stations";

/** Stations whose name contains the query. */
export function findStations(query: string): Station[] {
  return stations.filter((station) => station.name.includes(query));
}
`,
    new: `import { stations, type Station } from "./stations";
import { parseQuery } from "./filters";

/** Lowercase, so "brest" finds Brest. */
export function fold(text: string) {
  return text.toLowerCase();
}

/** Stations that match a query such as "sa region:atlantic": names that
 * start with the text first, then names that contain it. */
export function findStations(query: string): Station[] {
  const { text, regions } = parseQuery(query);
  const wanted = fold(text);
  return stations
    .filter((station) => regions.length === 0 || regions.includes(fold(station.region)))
    .map((station) => ({ station, name: fold(station.name) }))
    .filter(({ name }) => name.includes(wanted))
    .sort((a, b) => rank(a.name, wanted) - rank(b.name, wanted) || a.name.localeCompare(b.name))
    .map(({ station }) => station);
}

/** Names that start with the text come first. */
function rank(name: string, wanted: string) {
  return name.startsWith(wanted) ? 0 : 1;
}
`,
  },
  {
    edit: "tests/search.test.ts",
    old: `  expect(findStations("Brest").map((station) => station.id)).toEqual(["brest"]);
});
`,
    new: `  expect(findStations("Brest").map((station) => station.id)).toEqual(["brest"]);
});

test("ignores case", () => {
  expect(findStations("brest").map((station) => station.id)).toEqual(["brest"]);
});

test("ranks names that start with the text before names that contain it", () => {
  expect(findStations("de").map((station) => station.id)).toEqual(["den-helder", "aberdeen"]);
});

test("filters by region", () => {
  expect(findStations("region:baltic").map((station) => station.id)).toEqual(["gdansk"]);
});
`,
  },
  {
    bash: "bun test",
    output:
      "bun test v1.3.5\n\ntests/format.test.ts:\n✓ formats a height with one decimal\n✓ formats a time in the station's zone\n\ntests/search.test.ts:\n✓ finds a station by its name\n✓ ignores case\n✓ ranks names that start with the text before names that contain it\n✓ filters by region\n\n 6 pass\n 0 fail",
  },
  {
    edit: "README.md",
    old: "Brest\n  high 04:41  6.1 m\n  low  10:53  0.0 m\n",
    new: "Brest\n  high 04:41  6.1 m\n  low  10:53  0.0 m\n\n## Find a station\n\nSearch ignores case and lists names that start with your text first.\nAdd `region:` to keep one region, such as `tide sa region:atlantic`.\n",
  },
  { commit: "feat: forgiving station search with region filters" },
  {
    say: "Search now ignores case, ranks names that start with your text first, and takes `region:` filters, such as `tide sa region:atlantic`. The parser is in `src/filters.ts`. All 6 tests pass.",
  },
  { end: true },
  { user: "Accents still fail: alesund does not find Ålesund. Can you check?" },
  {
    think:
      "fold() only lowercases. Ålesund needs Unicode decomposition, then the combining marks removed.",
  },
  {
    edit: "src/search.ts",
    old: `/** Lowercase, so "brest" finds Brest. */
export function fold(text: string) {
  return text.toLowerCase();
}`,
    new: `/** Lowercase, without accents, so "alesund" finds Ålesund. */
export function fold(text: string) {
  return text.normalize("NFD").replace(/\\p{Diacritic}/gu, "").toLowerCase();
}`,
  },
  {
    edit: "tests/search.test.ts",
    old: `test("filters by region", () => {`,
    new: `test("folds accents, so alesund finds Ålesund", () => {
  expect(findStations("alesund").map((station) => station.id)).toEqual(["alesund"]);
});

test("filters by region", () => {`,
  },
  {
    bash: "bun test tests/search.test.ts",
    output:
      "bun test v1.3.5\n\ntests/search.test.ts:\n✓ finds a station by its name\n✓ ignores case\n✓ ranks names that start with the text before names that contain it\n✓ folds accents, so alesund finds Ålesund\n✓ filters by region\n\n 5 pass\n 0 fail",
  },
  { commit: "fix: fold accents in station search" },
  {
    say: "Fixed: `fold()` now removes accents after Unicode decomposition, so `alesund` finds Ålesund and `cadiz` finds Cádiz. I added a test. The branch has two commits and is ready to review.",
  },
  { end: true },
];

const fixDst = [
  {
    user: "Times in Tromsø are an hour off since the clocks changed on Sunday. Can you fix formatTime?",
  },
  { read: "src/format.ts" },
  {
    think:
      "formatTime parses a toLocaleString result in the machine's zone. That applies the offset twice and uses the wrong daylight saving rules. Intl.DateTimeFormat with timeZone is correct for each date.",
  },
  {
    bash: "TZ=UTC bun test tests/format.test.ts",
    output:
      "bun test v1.3.5\n\ntests/format.test.ts:\n✓ formats a height with one decimal\n✓ formats a time in the station's zone\n\n 2 pass\n 0 fail",
  },
  {
    edit: "src/format.ts",
    old: `/** A time of day at a station, such as 04:41. */
export function formatTime(at: Date, timeZone: string) {
  const offset = new Date(at.toLocaleString("en-US", { timeZone })).getTime() - at.getTime();
  const local = new Date(at.getTime() + offset);
  return \`\${pad(local.getHours())}:\${pad(local.getMinutes())}\`;
}`,
    new: `/** A time of day at a station, such as 04:41, in the station's own zone.
 * Intl applies the zone's daylight saving rules for that date. */
export function formatTime(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return \`\${part("hour")}:\${part("minute")}\`;
}`,
  },
  {
    edit: "src/format.ts",
    old: `
const pad = (value: number) => String(value).padStart(2, "0");
`,
    new: "",
  },
  {
    edit: "tests/format.test.ts",
    old: `  expect(formatTime(new Date("2026-07-01T04:41:00Z"), "Europe/London")).toBe("05:41");
});
`,
    new: `  expect(formatTime(new Date("2026-07-01T04:41:00Z"), "Europe/London")).toBe("05:41");
});

test("follows daylight saving time after the clocks change", () => {
  // Clocks went back on 25 October 2026: Oslo is UTC+1 again.
  expect(formatTime(new Date("2026-10-26T04:41:00Z"), "Europe/Oslo")).toBe("05:41");
});
`,
  },
  {
    bash: "TZ=America/New_York bun test tests/format.test.ts",
    output:
      "bun test v1.3.5\n\ntests/format.test.ts:\n✓ formats a height with one decimal\n✓ formats a time in the station's zone\n✓ follows daylight saving time after the clocks change\n\n 3 pass\n 0 fail",
  },
  {
    say: "Fixed: `formatTime` now asks `Intl.DateTimeFormat` for the hour in the station's zone, so each date gets its own daylight saving rules. The tests pass in UTC and in New York.\n\nOne choice for you: should the table show each station's own time, or the reader's? I kept the station's own time, as a harbour table does. Should I switch it?",
  },
  { end: true },
];

const glossary = [
  {
    user: "Add a short glossary to the README: chart datum, high water, range, spring and neap tides.",
  },
  { read: "README.md" },
  // A subagent that found the terms in the code, and finished.
  {
    agent: "Find each term in the code",
    prompt:
      "Find where the code uses chart datum, high water, range, and spring and neap tides. Report each file and line.",
    steps: [
      { read: "src/tides.ts" },
      {
        bash: "rg -n -i 'datum|high water|range|spring|neap' src",
        description: "Search the source for the terms",
        output: "src/tides.ts:6:  /** Height above chart datum, in metres. */",
      },
      {
        say: "Only src/tides.ts names one of the terms: chart datum, on line 6. The code does not name range, spring, or neap tides.",
      },
      { end: true },
    ],
    result:
      "Only src/tides.ts names one of the terms: chart datum, on line 6. The code does not name range, spring, or neap tides.",
  },
  {
    edit: "README.md",
    old: "  low  10:53  0.0 m\n",
    new: "  low  10:53  0.0 m\n\n## Glossary\n\n**Chart datum.** The level that heights count from: about the lowest tide.\n\n**High water.** The highest level of one tide.\n",
  },
  // A subagent in the background that still works.
  {
    agent: "Check the glossary against the model",
    background: true,
    prompt:
      "Read the prediction model in src/tides.ts. Check that each glossary term in the README agrees with it.",
    steps: [
      { read: "src/tides.ts" },
      { running: "bun test tests/format.test.ts", description: "Run the format tests" },
    ],
  },
];
/** Steps that the glossary agent takes while the video records. */
export const glossaryLive = [
  { think: "Two more terms: range, then spring and neap tides." },
  {
    edit: "README.md",
    old: "**High water.** The highest level of one tide.\n",
    new: "**High water.** The highest level of one tide.\n\n**Range.** High water minus the next low water.\n",
  },
  {
    edit: "README.md",
    old: "**Range.** High water minus the next low water.\n",
    new: "**Range.** High water minus the next low water.\n\n**Spring and neap tides.** Near a new or full moon the range is largest (spring);\nnear a half moon it is smallest (neap).\n",
  },
  { bash: "bunx markdownlint README.md", output: "" },
  {
    say: "The README has a glossary with four terms: chart datum, high water, range, and spring and neap tides.",
  },
  { end: true },
];

const model = [
  { user: "Explain the prediction model in the README, briefly, with a warning." },
  { read: "src/tides.ts" },
  { edit: "README.md", old: "  low  10:53  0.0 m\n", new: `  low  10:53  0.0 m\n${readmeModel}` },
  { commit: "docs: explain the prediction model" },
  { say: "The README explains the M2 model in four lines and says not to navigate with it." },
  { end: true },
];

// --------------------------------------------------------------- writers

const git = (cwd, args, env = {}) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL ?? process.env.GIT_CONFIG_GLOBAL,
    },
  }).trim();

async function put(root, path, text) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

/** Claude Code names a project folder after its directory. */
export const projectFolder = (cwd) => cwd.replace(/[^A-Za-z0-9-]/g, "-");

/** Writes a Claude Code transcript from steps, applying the edits to `cwd`. */
class ClaudeTranscript {
  constructor({ home, cwd, branch, title, id = randomUUID() }) {
    this.id = id;
    this.cwd = cwd;
    this.branch = branch;
    this.path = join(home, ".claude", "projects", projectFolder(cwd), `${id}.jsonl`);
    this.parent = null;
    this.title = title;
    this.lines = [];
    /** The transcripts of its subagents. */
    this.subagents = [];
  }
  base(at) {
    return {
      parentUuid: this.parent,
      isSidechain: !!this.agentId,
      ...(this.agentId && { agentId: this.agentId }),
      userType: "external",
      entrypoint: "claude-desktop",
      cwd: this.cwd,
      sessionId: this.id,
      version: "2.1.295",
      gitBranch: this.branch,
      timestamp: new Date(at).toISOString(),
    };
  }
  push(record) {
    const uuid = randomUUID();
    this.lines.push(JSON.stringify({ ...record, uuid }));
    this.parent = uuid;
    return uuid;
  }
  assistant(at, content, stop) {
    return this.push({
      ...this.base(at),
      type: "assistant",
      requestId: `req_${randomUUID().slice(0, 12)}`,
      message: {
        model: "claude-opus-5-5",
        id: `msg_${randomUUID().slice(0, 16)}`,
        type: "message",
        role: "assistant",
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 180, cache_read_input_tokens: 24_000 },
      },
    });
  }
  user(at, content, extra = {}) {
    return this.push({
      ...this.base(at),
      type: "user",
      message: { role: "user", content },
      ...extra,
    });
  }
  async step(step, at) {
    const tool = (name, input, result, extra, error = false) => {
      const id = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      this.assistant(at, [{ type: "tool_use", id, name, input }], "tool_use");
      this.user(
        at + 900,
        [
          {
            tool_use_id: id,
            type: "tool_result",
            content: result,
            ...(error && { is_error: true }),
          },
        ],
        extra ? { toolUseResult: extra } : {},
      );
    };
    if (step.agent) {
      // A subagent: its call here, and its own transcript and meta file beside
      // this one, as Claude Code writes them (src/host/thread-subagents.ts).
      const id = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const agentId = randomUUID().replace(/-/g, "").slice(0, 17);
      this.assistant(
        at,
        [
          {
            type: "tool_use",
            id,
            name: "Agent",
            input: {
              description: step.agent,
              prompt: step.prompt,
              subagent_type: "general-purpose",
              ...(step.background && { run_in_background: true }),
            },
          },
        ],
        "tool_use",
      );
      const folder = join(dirname(this.path), this.id, "subagents");
      const sub = new ClaudeTranscript({
        home: "",
        cwd: this.cwd,
        branch: this.branch,
        id: this.id,
      });
      sub.path = join(folder, `agent-${agentId}.jsonl`);
      sub.agentId = agentId;
      sub.user(at + 100, [{ type: "text", text: step.prompt }]);
      for (const [index, inner] of step.steps.entries())
        await sub.step(inner, at + 300 + index * 300);
      await sub.save();
      await writeFile(
        join(folder, `agent-${agentId}.meta.json`),
        JSON.stringify({ agentType: "general-purpose", description: step.agent, toolUseId: id }),
      );
      this.subagents.push(sub.path);
      // A background agent's call returns at once, as Claude Code's does.
      if (step.background)
        this.user(
          at + 200,
          [
            {
              tool_use_id: id,
              type: "tool_result",
              content: [
                { type: "text", text: `Async agent launched successfully. agentId: ${agentId}` },
              ],
            },
          ],
          {
            toolUseResult: {
              isAsync: true,
              status: "async_launched",
              agentId,
              description: step.agent,
              prompt: step.prompt,
            },
          },
        );
      if (step.result !== undefined)
        this.user(
          at + 300 + step.steps.length * 300,
          [
            {
              tool_use_id: id,
              type: "tool_result",
              content: [{ type: "text", text: step.result }],
            },
          ],
          {
            toolUseResult: {
              status: "completed",
              agentId,
              content: [{ type: "text", text: step.result }],
            },
          },
        );
      return;
    }
    if (step.running) {
      // A command that has not returned yet.
      this.assistant(
        at,
        [
          {
            type: "tool_use",
            id: `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            name: "Bash",
            input: { command: step.running, description: step.description ?? "Run a command" },
          },
        ],
        "tool_use",
      );
      return;
    }
    if (step.user) {
      if (this.title && this.lines.length === 0)
        this.lines.push(
          JSON.stringify({ type: "custom-title", customTitle: this.title, sessionId: this.id }),
        );
      this.user(at, [{ type: "text", text: step.user }]);
    } else if (step.think) {
      this.assistant(at, [{ type: "thinking", thinking: step.think, signature: "demo" }], null);
    } else if (step.say) {
      this.assistant(at, [{ type: "text", text: step.say }], null);
    } else if (step.end) {
      // The last text of a turn ends it; mark it so a reader sees the turn end.
      const last = JSON.parse(this.lines.at(-1));
      if (last.type === "assistant") {
        last.message.stop_reason = "end_turn";
        this.lines[this.lines.length - 1] = JSON.stringify(last);
      }
      this.push({
        ...this.base(at),
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
    } else if (step.read) {
      const text = await readFile(join(this.cwd, step.read), "utf8");
      const numbered = text
        .split("\n")
        .map((line, index) => `${String(index + 1).padStart(6)}→${line}`)
        .join("\n");
      tool("Read", { file_path: join(this.cwd, step.read) }, numbered, {
        type: "text",
        file: {
          filePath: join(this.cwd, step.read),
          content: text,
          numLines: text.split("\n").length,
          startLine: 1,
          totalLines: text.split("\n").length,
        },
      });
    } else if (step.bash) {
      // A failed command (`error: true`) is an error result, as Claude Code writes it.
      tool(
        "Bash",
        { command: step.bash, description: step.description ?? "Run a command" },
        step.error ? `Exit code 1\n${step.output ?? ""}` : (step.output ?? ""),
        { stdout: step.output ?? "", stderr: "", interrupted: false, isImage: false },
        step.error,
      );
    } else if (step.commit) {
      git(this.cwd, ["add", "-A"]);
      git(this.cwd, ["commit", "-qm", step.commit], dated(at));
      const sha = git(this.cwd, ["rev-parse", "--short", "HEAD"]);
      tool(
        "Bash",
        {
          command: `git add -A && git commit -m "${step.commit}"`,
          description: "Commit the change",
        },
        `[${this.branch} ${sha}] ${step.commit}`,
      );
    } else if (step.write) {
      await put(this.cwd, step.write, step.content);
      tool(
        "Write",
        { file_path: join(this.cwd, step.write), content: step.content },
        `File created successfully at: ${join(this.cwd, step.write)}`,
        {
          type: "create",
          filePath: join(this.cwd, step.write),
          content: step.content,
          structuredPatch: [],
        },
      );
    } else if (step.edit) {
      const file = join(this.cwd, step.edit);
      const before = await readFile(file, "utf8");
      const index = before.indexOf(step.old);
      if (index < 0) throw new Error(`The edit's old text is not in ${step.edit}`);
      const after = before.slice(0, index) + step.new + before.slice(index + step.old.length);
      await writeFile(file, after);
      const oldStart = before.slice(0, index).split("\n").length;
      const oldLines = step.old.split("\n");
      const newLines = step.new.split("\n");
      tool(
        "Edit",
        { file_path: file, old_string: step.old, new_string: step.new, replace_all: false },
        `The file ${file} has been updated.`,
        {
          filePath: file,
          oldString: step.old,
          newString: step.new,
          originalFile: before,
          structuredPatch: [
            {
              oldStart,
              oldLines: oldLines.length,
              newStart: oldStart,
              newLines: newLines.length,
              lines: [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)],
            },
          ],
          userModified: false,
          replaceAll: false,
        },
      );
    }
  }
  /** Appends the lines written since the last save, as Claude Code does. */
  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const fresh = this.lines.slice(this.saved ?? 0);
    if (!fresh.length) return;
    if (this.saved) await appendFile(this.path, fresh.join("\n") + "\n");
    else await writeFile(this.path, fresh.join("\n") + "\n");
    this.saved = this.lines.length;
  }
}

const dated = (at) => {
  const iso = new Date(at).toISOString();
  return { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso };
};

/** Runs steps from `from` to `to` (milliseconds), spread evenly. */
async function play(transcript, steps, from, to) {
  const gap = steps.length > 1 ? (to - from) / (steps.length - 1) : 0;
  for (const [index, step] of steps.entries()) await transcript.step(step, from + index * gap);
  await transcript.save();
}

/** A Codex rollout that adds feet: written directly, with its patch applied. */
async function codexSession({ home, cwd, at }) {
  const id = randomUUID();
  const day = new Date(at);
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  );
  const path = join(
    folder,
    `rollout-${day.toISOString().slice(0, 19).replace(/:/g, "-")}-${id}.jsonl`,
  );
  const format = join(cwd, "src/format.ts");
  const before = await readFile(format, "utf8");
  const after = before.replace(
    `/** A height in metres with one decimal, such as 3.7 m. */
export function formatHeight(metres: number) {
  return \`\${metres.toFixed(1)} m\`;
}`,
    `/** A height with one decimal, in metres or in feet, such as 3.7 m or 12.1 ft. */
export function formatHeight(metres: number, unit: "m" | "ft" = "m") {
  return unit === "ft" ? \`\${(metres * 3.28084).toFixed(1)} ft\` : \`\${metres.toFixed(1)} m\`;
}`,
  );
  await writeFile(format, after);
  const t = (offset) => new Date(at + offset).toISOString();
  const prompt =
    "Readers in the US want heights in feet. Add a unit option to formatHeight, metres by default.";
  const lines = [
    {
      timestamp: t(0),
      type: "session_meta",
      payload: {
        id,
        timestamp: t(0),
        cwd,
        originator: "codex_cli_rs",
        cli_version: "0.160.0",
        git: { branch: "feet", commit_hash: "" },
      },
    },
    {
      timestamp: t(0),
      type: "turn_context",
      payload: { cwd, model: "gpt-6-astra", approval_policy: "on-request" },
    },
    {
      timestamp: t(1000),
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
    },
    {
      timestamp: t(1000),
      type: "event_msg",
      payload: { type: "user_message", message: prompt, kind: "plain" },
    },
    {
      timestamp: t(4000),
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "**Adding a unit to formatHeight**" }],
        content: null,
        encrypted_content: "gAAAA",
      },
    },
    {
      timestamp: t(6000),
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({
          command: ["bash", "-lc", "rg -n formatHeight src tests"],
          workdir: cwd,
        }),
        call_id: "call_rg",
      },
    },
    {
      timestamp: t(7000),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_rg",
        output: JSON.stringify({
          output:
            'src/cli.ts:3:import { formatHeight, formatTime } from "./format";\nsrc/format.ts:9:export function formatHeight(metres: number) {\n',
          metadata: { exit_code: 0, duration_seconds: 0.1 },
        }),
      },
    },
    {
      timestamp: t(20000),
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        status: "completed",
        call_id: "call_patch",
        name: "apply_patch",
        input: `*** Begin Patch\n*** Update File: ${format}\n@@\n-/** A height in metres with one decimal, such as 3.7 m. */\n-export function formatHeight(metres: number) {\n-  return \`\${metres.toFixed(1)} m\`;\n+/** A height with one decimal, in metres or in feet, such as 3.7 m or 12.1 ft. */\n+export function formatHeight(metres: number, unit: "m" | "ft" = "m") {\n+  return unit === "ft" ? \`\${(metres * 3.28084).toFixed(1)} ft\` : \`\${metres.toFixed(1)} m\`;\n*** End Patch`,
      },
    },
    {
      timestamp: t(21000),
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call_patch",
        output: JSON.stringify({
          output: `Success. Updated the following files:\nM ${format}\n`,
          metadata: { exit_code: 0, duration_seconds: 0 },
        }),
      },
    },
    {
      timestamp: t(30000),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: 'formatHeight takes an optional unit now: "m" by default, or "ft". The CLI still prints metres; a --feet flag is a small next step if you want it.',
          },
        ],
      },
    },
    {
      timestamp: t(30500),
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: "formatHeight takes an optional unit now.",
      },
    },
  ];
  await mkdir(folder, { recursive: true });
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await utimes(path, new Date(at + 30_000), new Date(at + 30_000));
  return { id, path };
}

// ------------------------------------------------- attempts (experiment 7)

/** One task that Claude and Codex both did, each in its own worktree. */
export const WEEK_TITLE = "Show a week of tides in the CLI";
const weekPrompt =
  "Add a --week option to the CLI: seven days of tides for a station, one block for each day with the date as its heading.";
const cliBody0 = `const [query = "", date] = process.argv.slice(2);
const day = date ? new Date(date) : new Date();
for (const station of findStations(query)) {
  console.log(station.name);
  for (const tide of predict(station, day))
    console.log(\`  \${tide.kind.padEnd(4)} \${formatTime(tide.at, station.timeZone)}  \${formatHeight(tide.height)}\`);
}
`;
const readmeUsage0 = "```sh\ntide brest 2026-10-15\n```\n";

/** Attempt A: Claude Code with Opus. A week module, a day format, and padded
 * heights, which break a test that it reports. */
const weekClaude = [
  { user: weekPrompt },
  {
    think:
      "The CLI prints one day. A week is seven calls to predict(), so a small week() helper and a day heading are enough.",
  },
  { read: "src/cli.ts" },
  {
    write: "src/week.ts",
    content: `import type { Station } from "./stations";
import { predict, type Tide } from "./tides";

const DAY = 24 * 60 * 60 * 1000;

/** Seven days of tides for a station, from \`start\`. */
export function week(station: Station, start: Date): { day: Date; tides: Tide[] }[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start.getTime() + offset * DAY);
    return { day, tides: predict(station, day) };
  });
}
`,
  },
  {
    edit: "src/format.ts",
    old: `/** A height in metres with one decimal, such as 3.7 m. */
export function formatHeight(metres: number) {
  return \`\${metres.toFixed(1)} m\`;
}`,
    new: `/** A height in metres with one decimal, padded so that columns line up. */
export function formatHeight(metres: number) {
  return \`\${metres.toFixed(1).padStart(4)} m\`;
}

/** A day at a station, such as Thu 15 Oct. */
export function formatDay(day: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(day);
}`,
  },
  {
    edit: "src/cli.ts",
    old: `import { formatHeight, formatTime } from "./format";

${cliBody0}`,
    new: `import { formatDay, formatHeight, formatTime } from "./format";
import { week } from "./week";

const args = process.argv.slice(2);
const weekly = args.includes("--week");
const [query = "", date] = args.filter((arg) => arg !== "--week");
const day = date ? new Date(date) : new Date();
for (const station of findStations(query)) {
  console.log(station.name);
  const days = weekly ? week(station, day) : [{ day, tides: predict(station, day) }];
  for (const entry of days) {
    if (weekly) console.log(\`  \${formatDay(entry.day, station.timeZone)}\`);
    const indent = weekly ? "    " : "  ";
    for (const tide of entry.tides)
      console.log(\`\${indent}\${tide.kind.padEnd(4)} \${formatTime(tide.at, station.timeZone)}  \${formatHeight(tide.height)}\`);
  }
}
`,
  },
  {
    bash: "bun src/cli.ts Brest 2026-10-15 --week | head -12",
    output:
      "Brest\n  Thu 15 Oct\n    low  05:54   0.0 m\n    high 12:07   6.1 m\n    low  18:19   0.0 m\n    high 00:32   6.1 m\n  Fri 16 Oct\n    low  06:44   0.0 m\n    high 12:57   6.1 m\n    low  19:10   0.0 m\n    high 01:22   6.1 m\n  Sat 17 Oct",
  },
  {
    bash: "bun test",
    error: true,
    output:
      'bun test v1.3.5\n\ntests/format.test.ts:\n✗ formats a height with one decimal\n\n  expect(received).toBe(expected)\n\n  Expected: "3.8 m"\n  Received: " 3.8 m"\n\n✓ formats a time in the station\'s zone\n\ntests/search.test.ts:\n✓ finds a station by its name\n\n 2 pass\n 1 fail\nRan 3 tests across 2 files.',
  },
  {
    edit: "README.md",
    old: readmeUsage0,
    new: "```sh\ntide brest 2026-10-15\ntide brest --week   # seven days, one block for each day\n```\n",
  },
  {
    say: "`tide brest --week` prints seven days, one block for each day with its date. The days come from `week()` in `src/week.ts`, and `formatDay()` writes the heading in the station's zone. I also padded heights so that the columns line up.\n\nOne test fails: `tests/format.test.ts` expects `3.8 m`, and the padding makes it ` 3.8 m`. Change the test if you keep the padding.",
  },
  { end: true },
];

/** Attempt B: Codex. A predictDays() in tides.ts, a test file, and a fix
 * after its first test run fails. */
const tidesEnd0 = "  return tides;\n}\n";
const weekCodex = [
  { user: weekPrompt },
  { think: "**Adding a week view to the CLI**" },
  {
    bash: 'rg -n "predict\\(" src tests',
    output:
      "src/cli.ts:8:  for (const tide of predict(station, day))\nsrc/tides.ts:17:export function predict(station: Station, day: Date): Tide[] {",
  },
  {
    edit: "src/tides.ts",
    old: tidesEnd0,
    new: `${tidesEnd0}
/** Tides for \`days\` days from the day of \`start\`, one list for each day. */
export function predictDays(station: Station, start: Date, days: number) {
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(first + index * 24 * 60 * 60 * 1000);
    return { day, tides: predict(station, day) };
  });
}
`,
  },
  {
    edit: "src/cli.ts",
    old: `import { predict } from "./tides";`,
    new: `import { predictDays } from "./tides";`,
  },
  {
    edit: "src/cli.ts",
    old: cliBody0,
    new: `const args = process.argv.slice(2);
const days = args.includes("--week") ? 7 : 1;
const [query = "", date] = args.filter((arg) => !arg.startsWith("--"));
const start = date ? new Date(date) : new Date();
const heading = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } as const;
for (const station of findStations(query)) {
  console.log(station.name);
  for (const { day, tides } of predictDays(station, start, days)) {
    if (days > 1) console.log(\`  \${day.toLocaleDateString("en-GB", heading)}\`);
    for (const tide of tides)
      console.log(\`\${days > 1 ? "    " : "  "}\${tide.kind.padEnd(4)} \${formatTime(tide.at, station.timeZone)}  \${formatHeight(tide.height)}\`);
  }
}
`,
  },
  {
    write: "tests/week.test.ts",
    content: `import { expect, test } from "bun:test";
import { stations } from "../src/stations";
import { predictDays } from "../src/tides";

const brest = stations.find((station) => station.id === "brest")!;

test("predicts seven days from the start day", () => {
  const days = predictDays(brest, new Date("2026-10-15T18:00:00Z"), 7);
  expect(days.map(({ day }) => day.toISOString().slice(0, 10))).toEqual([
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
  ]);
});

test("each day has four high and low waters", () => {
  for (const { tides } of predictDays(brest, new Date("2026-10-15"), 7))
    expect(tides).toHaveLength(4);
});
`,
  },
  {
    bash: "bun test",
    exit: 1,
    output:
      "bun test v1.3.5\n\ntests/format.test.ts:\n✓ formats a height with one decimal\n✓ formats a time in the station's zone\n\ntests/search.test.ts:\n✓ finds a station by its name\n\ntests/week.test.ts:\n✓ predicts seven days from the start day\n✗ each day has four high and low waters\n\n  expect(received).toHaveLength(expected)\n\n  Expected length: 4\n  Received length: 3\n\n 4 pass\n 1 fail\nRan 5 tests across 3 files.",
  },
  {
    think:
      "A tide comes about every 6 h 12 min, so a day has three or four of them. The test is wrong, not the code.",
  },
  {
    edit: "tests/week.test.ts",
    old: `test("each day has four high and low waters", () => {
  for (const { tides } of predictDays(brest, new Date("2026-10-15"), 7))
    expect(tides).toHaveLength(4);
});`,
    new: `test("each day has three or four high and low waters", () => {
  // A high or low water comes every 6 h 12 min, so some days have only three.
  for (const { tides } of predictDays(brest, new Date("2026-10-15"), 7))
    expect([3, 4]).toContain(tides.length);
});`,
  },
  {
    bash: "bun test",
    output:
      "bun test v1.3.5\n\ntests/format.test.ts:\n✓ formats a height with one decimal\n✓ formats a time in the station's zone\n\ntests/search.test.ts:\n✓ finds a station by its name\n\ntests/week.test.ts:\n✓ predicts seven days from the start day\n✓ each day has three or four high and low waters\n\n 5 pass\n 0 fail\nRan 5 tests across 3 files.",
  },
  {
    edit: "README.md",
    old: readmeUsage0,
    new: "```sh\ntide brest 2026-10-15\ntide brest 2026-10-15 --week\n```\n\n`--week` prints seven days from the date, each under its own heading.\n",
  },
  {
    say: "Added `--week`: `tide brest --week` prints seven days from today, or from the date you give, each under a heading such as Thursday 15 October. `predictDays()` in `src/tides.ts` does the work, and `tests/week.test.ts` covers it. My first test expected four tides each day, but some days have three; I fixed the test. All 5 tests pass.",
  },
  { end: true },
];

/** The patch that Codex's apply_patch writes for one file. */
function codexPatch(file, before, after) {
  const lines = (text, mark) =>
    text
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => `${mark}${line}`);
  const body =
    before === null
      ? [`*** Add File: ${file}`, ...lines(after, "+")]
      : [`*** Update File: ${file}`, "@@", ...lines(before, "-"), ...lines(after, "+")];
  return ["*** Begin Patch", ...body, "*** End Patch"].join("\n");
}

/** Writes a Codex rollout from steps, from `from` to `to`, applying its
 * patches to `cwd`. `exit` on a shell step is its exit code. */
async function codexRollout({ home, cwd, branch, model, steps, from, to }) {
  const id = randomUUID();
  const day = new Date(from);
  const two = (value) => String(value).padStart(2, "0");
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(day.getFullYear()),
    two(day.getMonth() + 1),
    two(day.getDate()),
  );
  const path = join(
    folder,
    `rollout-${day.toISOString().slice(0, 19).replace(/:/g, "-")}-${id}.jsonl`,
  );
  const t = (at) => new Date(at).toISOString();
  const lines = [
    {
      timestamp: t(from),
      type: "session_meta",
      payload: {
        id,
        timestamp: t(from),
        cwd,
        originator: "codex_cli_rs",
        cli_version: "0.160.0",
        git: { branch, commit_hash: "" },
      },
    },
    {
      timestamp: t(from),
      type: "turn_context",
      payload: { cwd, model, approval_policy: "on-request" },
    },
  ];
  const item = (at, payload) => lines.push({ timestamp: t(at), type: "response_item", payload });
  const gap = steps.length > 1 ? (to - from) / (steps.length - 1) : 0;
  let last = "";
  for (const [index, step] of steps.entries()) {
    const at = from + index * gap;
    const call = `call_${index}`;
    if (step.user) {
      item(at, {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: step.user }],
      });
      lines.push({
        timestamp: t(at),
        type: "event_msg",
        payload: { type: "user_message", message: step.user, kind: "plain" },
      });
    } else if (step.think) {
      item(at, {
        type: "reasoning",
        summary: [{ type: "summary_text", text: step.think }],
        content: null,
        encrypted_content: "gAAAA",
      });
    } else if (step.bash) {
      item(at, {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["bash", "-lc", step.bash], workdir: cwd }),
        call_id: call,
      });
      item(at + 1500, {
        type: "function_call_output",
        call_id: call,
        output: JSON.stringify({
          output: step.output ?? "",
          metadata: { exit_code: step.exit ?? 0, duration_seconds: 1.2 },
        }),
      });
    } else if (step.edit || step.write) {
      const file = join(cwd, step.edit ?? step.write);
      let before = null;
      let after = step.content;
      if (step.edit) {
        const text = await readFile(file, "utf8");
        const found = text.indexOf(step.old);
        if (found < 0) throw new Error(`The edit's old text is not in ${step.edit}`);
        await writeFile(
          file,
          text.slice(0, found) + step.new + text.slice(found + step.old.length),
        );
        [before, after] = [step.old, step.new];
      } else await put(cwd, step.write, step.content);
      item(at, {
        type: "custom_tool_call",
        status: "completed",
        call_id: call,
        name: "apply_patch",
        input: codexPatch(file, before, after),
      });
      item(at + 800, {
        type: "custom_tool_call_output",
        call_id: call,
        output: JSON.stringify({
          output: `Success. Updated the following files:\n${before === null ? "A" : "M"} ${file}\n`,
          metadata: { exit_code: 0, duration_seconds: 0 },
        }),
      });
    } else if (step.say) {
      last = step.say;
      item(at, {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: step.say }],
      });
    } else if (step.end) {
      lines.push({
        timestamp: t(at),
        type: "event_msg",
        payload: { type: "task_complete", last_agent_message: last },
      });
    }
  }
  await mkdir(folder, { recursive: true });
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await utimes(path, new Date(to), new Date(to));
  return { id, path };
}

/** A Claude Code that answers only `initialize`, with its models: New thread
 * asks for them. It writes no transcript and does no task. */
const fakeClaude = `#!/usr/bin/env node
// The demo world's Claude Code: it tells its models and does nothing else.
const models = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 5.5", supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
  { value: "opus", displayName: "Opus 5.5", supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
  { value: "sonnet", displayName: "Sonnet 4.6", supportedEffortLevels: ["low", "medium", "high"] },
  { value: "haiku", displayName: "Haiku 4.5" },
];
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\\n")) >= 0; ) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.type === "control_request" && message.request?.subtype === "initialize")
        process.stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { commands: [], models } } }) + "\\n");
    } catch {}
  }
});
process.stdin.on("end", () => process.exit(0));
`;
/** What Codex offered in its last session, as Med keeps it. */
const codexOffers = {
  codex: [
    {
      id: "model",
      name: "Model",
      category: "model",
      value: "gpt-6-astra",
      options: ["gpt-6-astra", "gpt-6", "gpt-6-mini"].map((value) => ({ value, name: value })),
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "effort",
      value: "medium",
      options: ["low", "medium", "high"].map((value) => ({
        value,
        name: value[0].toUpperCase() + value.slice(1),
      })),
    },
  ],
};

/**
 * Experiment 7's world: the two attempts, each in its own worktree from main,
 * and the agents that New thread lists. The fake agents come first on PATH, so
 * the demo never starts a real one.
 */
async function weekAttempts({ root, home, state, worktree, now }) {
  const bin = join(root, "bin");
  await put(bin, "claude", fakeClaude);
  await put(
    bin,
    "codex-acp",
    "#!/bin/sh\n# The demo world's Codex: New thread lists it; it never runs.\nexit 1\n",
  );
  await chmod(join(bin, "claude"), 0o755);
  await chmod(join(bin, "codex-acp"), 0o755);
  await writeFile(join(state, "agent-offers.json"), JSON.stringify(codexOffers));

  const a = worktree("week-view-a");
  const b = worktree("week-view-b");
  const started = now - 100 * MINUTE;
  const claude = new ClaudeTranscript({ home, cwd: a, branch: "week-view-a" });
  await play(claude, weekClaude, started, started + 14 * MINUTE);
  await utimes(claude.path, new Date(started + 14 * MINUTE), new Date(started + 14 * MINUTE));
  const codex = await codexRollout({
    home,
    cwd: b,
    branch: "week-view-b",
    model: "gpt-6-astra",
    steps: weekCodex,
    from: started,
    to: started + 9 * MINUTE,
  });
  return {
    bin,
    trees: { weekA: a, weekB: b },
    sessions: {
      weekA: { agent: "claude", id: claude.id, path: claude.path, cwd: a },
      weekB: { agent: "codex", id: codex.id, path: codex.path, cwd: b },
    },
    /** Adds the two attempts as one group, after the other threads. */
    register(cli) {
      const create = (tree, key, attempt) => [
        "review",
        "create",
        "--title",
        WEEK_TITLE,
        "--repo",
        tree,
        "--working",
        "--key",
        key,
        "--group",
        "week-view",
        "--attempt",
        String(attempt),
        "--no-pr",
      ];
      cli(create(a, "week-view-a", 1), { CLAUDE_CODE_SESSION_ID: claude.id });
      cli([...create(b, "week-view-b", 2), "--session", `codex:${codex.id}`]);
    },
  };
}

// ------------------------------------------------------------------ build

/**
 * Builds the world under `root` (removed first). Returns its paths and the
 * sessions; `register(cli)` adds the sources and threads to a running host.
 */
export async function buildWorld(root, now = Date.now()) {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  root = await realpath(root);
  const home = join(root, "home");
  const state = join(root, "state");
  const code = join(home, "code");
  const repo = join(code, "tide");
  const trees = join(code, "tide.worktrees");
  await mkdir(repo, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(
    join(home, ".gitconfig"),
    "[user]\n\tname = Ada Park\n\temail = ada@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n",
  );
  process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");

  // main: four commits over a week.
  git(repo, ["init", "-q", "-b", "main"]);
  for (const [path, text] of Object.entries(files)) await put(repo, path, text);
  await put(repo, "src/search.ts", search0);
  await put(repo, "src/format.ts", format0);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "Start tide: stations and today's tides"], dated(now - 6 * DAY));
  await put(repo, "tests/search.test.ts", searchTest0);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "Add station search"], dated(now - 4 * DAY));
  await put(repo, "src/format.ts", format1);
  await put(repo, "tests/format.test.ts", formatTest1);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "Format heights with one decimal"], dated(now - 2 * DAY));
  const beforeModel = git(repo, ["rev-parse", "HEAD"]);

  // The model explanation: written on main by an agent yesterday.
  const modelSession = new ClaudeTranscript({
    home,
    cwd: repo,
    branch: "main",
    title: "Explain the prediction model",
  });
  await play(modelSession, model, now - DAY - 40 * MINUTE, now - DAY - 32 * MINUTE);
  const afterModel = git(repo, ["rev-parse", "HEAD"]);

  const worktree = (name) => {
    const path = join(trees, name);
    git(repo, ["worktree", "add", "-q", "-b", name, path, "main"]);
    return path;
  };
  const searchTree = worktree("station-search");
  const dstTree = worktree("fix-dst");
  const glossaryTree = worktree("glossary");
  const feetTree = worktree("feet");

  const searchSession = new ClaudeTranscript({
    home,
    cwd: searchTree,
    branch: "station-search",
    title: "Forgiving station search",
  });
  await play(searchSession, stationSearch, now - 70 * MINUTE, now - 24 * MINUTE);
  const dstSession = new ClaudeTranscript({
    home,
    cwd: dstTree,
    branch: "fix-dst",
    title: "Daylight saving times",
  });
  await play(dstSession, fixDst, now - 19 * MINUTE, now - 6 * MINUTE);
  const glossarySession = new ClaudeTranscript({
    home,
    cwd: glossaryTree,
    branch: "glossary",
    title: "README glossary",
  });
  await play(glossarySession, glossary, now - 3 * MINUTE, now - 20_000);
  const feet = await codexSession({ home, cwd: feetTree, at: now - 48 * MINUTE });

  // Transcript times: the files changed when their last line was written.
  const touch = (path, at) => utimes(path, new Date(at), new Date(at));
  await touch(modelSession.path, now - DAY - 32 * MINUTE);
  await touch(searchSession.path, now - 24 * MINUTE);
  await touch(dstSession.path, now - 6 * MINUTE);
  await touch(glossarySession.path, now - 20_000);

  // A small vault of notes.
  const vault = join(home, "notes");
  await put(
    vault,
    "Tide ideas.md",
    "# Tide ideas\n\n- A week view, one column per day.\n- Moon phase beside spring and neap tides.\n- Share a station's table as a link.\n\nSee [[Harbour list]].\n",
  );
  await put(
    vault,
    "Harbour list.md",
    "# Harbour list\n\nStations to add next: Plymouth, Bergen, Lisbon, Esbjerg.\n",
  );
  await put(
    vault,
    "Releases/0.3.md",
    "# 0.3\n\n- Heights with one decimal.\n- The prediction model in the README.\n",
  );

  // A larger change with no session (week-view.mjs).
  const weekTree = await buildWeekView({ repo, trees, now, helpers: { git, put, dated } });

  // Experiment 7: one task that Claude and Codex both did (see weekAttempts).
  const attempts = await weekAttempts({ root, home, state, worktree, now });

  const world = {
    root,
    home,
    state,
    repo,
    vault,
    trees: {
      search: searchTree,
      dst: dstTree,
      glossary: glossaryTree,
      feet: feetTree,
      week: weekTree,
    },
    sessions: {
      model: { agent: "claude", id: modelSession.id, path: modelSession.path, cwd: repo },
      search: { agent: "claude", id: searchSession.id, path: searchSession.path, cwd: searchTree },
      dst: { agent: "claude", id: dstSession.id, path: dstSession.path, cwd: dstTree },
      glossary: {
        agent: "claude",
        id: glossarySession.id,
        path: glossarySession.path,
        cwd: glossaryTree,
      },
      feet: { agent: "codex", id: feet.id, path: feet.path, cwd: feetTree },
    },
    commits: { beforeModel, afterModel },
    env: { HOME: home, MED_HOME_DIR: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
    glossarySession,
  };

  Object.assign(world.trees, attempts.trees);
  Object.assign(world.sessions, attempts.sessions);
  world.env.PATH = `${attempts.bin}${delimiter}${process.env.PATH ?? ""}`;

  /** Adds the sources and the threads that agents handed off to a running host. */
  world.register = (cli) => {
    cli(["add", repo]);
    cli(["add", vault, "--type", "vault"]);
    cli(
      [
        "review",
        "create",
        "--title",
        "Explain the prediction model",
        "--repo",
        repo,
        "--base",
        beforeModel,
        "--head",
        afterModel,
        "--key",
        "model",
        "--no-pr",
      ],
      { CLAUDE_CODE_SESSION_ID: modelSession.id },
    );
    cli(
      [
        "review",
        "create",
        "--title",
        "Forgiving station search",
        "--repo",
        searchTree,
        "--base",
        "main",
        "--head",
        "station-search",
        "--key",
        "station-search",
        "--no-pr",
      ],
      { CLAUDE_CODE_SESSION_ID: searchSession.id },
    );
    cli(
      [
        "review",
        "create",
        "--title",
        "Daylight saving times",
        "--repo",
        dstTree,
        "--working",
        "--key",
        "fix-dst",
        "--no-pr",
      ],
      { CLAUDE_CODE_SESSION_ID: dstSession.id },
    );
    registerWeekView(cli, weekTree);
    attempts.register(cli);
  };

  /** Marks the subagents' transcripts as written now, so the one that works
   * shows as working however long the scenes before took. */
  world.touchSubagents = async () => {
    const at = new Date();
    for (const path of glossarySession.subagents) await utimes(path, at, at);
  };

  /** The glossary agent's next step, as it works during a recording. */
  let live = 0;
  world.advance = async () => {
    const step = glossaryLive[live++];
    if (!step) return false;
    await glossarySession.step(step, Date.now());
    await glossarySession.save();
    return true;
  };
  return world;
}
