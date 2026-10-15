// A larger change, for a review without a session (measure-chrome.mjs): an
// agent's "week view" for tide, on its own branch and worktree. It has 30 files across the CLI, a
// small web page, tests, docs, CI, and a lock file, with one file deleted,
// one renamed, one image, and one generated file. No session records it.
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

// ------------------------------------------------------------------ logic

const moon = `/** The moon's phase on a day, from the mean synodic month. It is good to a
 * few hours, which is enough to tell spring tides from neap tides. */
export interface MoonPhase {
  /** 0 is new, 0.5 is full, and the value grows toward the next new moon. */
  age: number;
  name:
    | "new"
    | "waxing crescent"
    | "first quarter"
    | "waxing gibbous"
    | "full"
    | "waning gibbous"
    | "last quarter"
    | "waning crescent";
  /** The lit part of the disc, from 0 to 1. */
  illumination: number;
}

/** The mean synodic month, in days. */
export const SYNODIC_MONTH = 29.530588853;
/** A new moon: 2026-01-18 19:52 UTC. */
const NEW_MOON = Date.UTC(2026, 0, 18, 19, 52);
const DAY = 24 * 60 * 60 * 1000;

const names: MoonPhase["name"][] = [
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
];

export function moonPhase(at: Date): MoonPhase {
  const days = (at.getTime() - NEW_MOON) / DAY;
  const age = (((days / SYNODIC_MONTH) % 1) + 1) % 1;
  return {
    age,
    name: names[Math.round(age * 8) % 8]!,
    illumination: (1 - Math.cos(2 * Math.PI * age)) / 2,
  };
}

/** Days from \`at\` to the next new or full moon, whichever comes first. */
export function daysToSyzygy(at: Date): number {
  const { age } = moonPhase(at);
  const toNext = (age < 0.5 ? 0.5 - age : 1 - age) * SYNODIC_MONTH;
  return Math.round(toNext * 10) / 10;
}

/** A glyph for the week table: the eight phases of the Unicode moon. */
export function moonGlyph(phase: MoonPhase): string {
  return ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"][names.indexOf(phase.name)]!;
}
`;

const week = `import { moonPhase, type MoonPhase } from "./moon";
import type { Station } from "./stations";
import { predictRange, type Tide } from "./tides";

const DAY = 24 * 60 * 60 * 1000;

/** One day of a station's week. */
export interface WeekDay {
  /** Midnight UTC at the start of the day. */
  date: Date;
  tides: Tide[];
  moon: MoonPhase;
  /** The highest high water minus the lowest low water, in metres. */
  range: number;
  /** Spring tides follow new and full moons; neap tides follow the quarters. */
  kind: "spring" | "neap" | "mean";
}

export interface Week {
  station: Station;
  days: WeekDay[];
  /** The day with the largest range, where a harbour master looks first. */
  biggest: WeekDay;
  /** The highest and lowest water of the week, for the chart's scale. */
  extremes: { high: number; low: number };
}

/** The first day of the week that contains \`day\`: Monday, as ISO 8601 says. */
export function startOfWeek(day: Date): Date {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const weekday = (new Date(start).getUTCDay() + 6) % 7;
  return new Date(start - weekday * DAY);
}

/** How a day's moon sets its tides. Tides lag the moon by about a day and a
 * half (the age of the tide), so the moon's age moves back by that much. */
export function tideKind(moon: MoonPhase): WeekDay["kind"] {
  const lagged = (moon.age - 1.5 / 29.53 + 1) % 1;
  const fromSyzygy = Math.min(lagged % 0.5, 0.5 - (lagged % 0.5));
  if (fromSyzygy < 0.07) return "spring";
  if (fromSyzygy > 0.18) return "neap";
  return "mean";
}

/** The range of a day's tides: its highest high water minus its lowest low. */
export function dayRange(tides: readonly Tide[]): number {
  let high = -Infinity;
  let low = Infinity;
  for (const tide of tides) {
    if (tide.kind === "high") high = Math.max(high, tide.height);
    else low = Math.min(low, tide.height);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return 0;
  return Math.round((high - low) * 10) / 10;
}

/** Seven days of tides for a station, from the Monday of \`day\`'s week. */
export function buildWeek(station: Station, day: Date, length = 7): Week {
  if (length < 1 || length > 14) throw new RangeError("A week view shows 1 to 14 days.");
  const start = startOfWeek(day).getTime();
  const tides = predictRange(station, new Date(start), new Date(start + length * DAY));
  const days: WeekDay[] = [];
  for (let index = 0; index < length; index++) {
    const from = start + index * DAY;
    const own = tides.filter((tide) => tide.at.getTime() >= from && tide.at.getTime() < from + DAY);
    const moon = moonPhase(new Date(from + DAY / 2));
    days.push({
      date: new Date(from),
      tides: own,
      moon,
      range: dayRange(own),
      kind: tideKind(moon),
    });
  }
  let biggest = days[0]!;
  for (const entry of days) if (entry.range > biggest.range) biggest = entry;
  const heights = tides.map((tide) => tide.height);
  return {
    station,
    days,
    biggest,
    extremes: {
      high: heights.length ? Math.max(...heights) : 0,
      low: heights.length ? Math.min(...heights) : 0,
    },
  };
}

/** The days of a week that have spring tides, for the summary line. */
export function springDays(week: Week): WeekDay[] {
  return week.days.filter((entry) => entry.kind === "spring");
}

/** A week's tides as rows for the terminal table: one row for each day. */
export function weekRows(week: Week, format: (tide: Tide) => string): string[][] {
  return week.days.map((entry) => [
    entry.date.toISOString().slice(0, 10),
    ...entry.tides.map(format),
    entry.kind === "mean" ? "" : entry.kind,
  ]);
}

/** The Monday of the next week, for the page's arrows. */
export function nextWeek(week: Week): Date {
  return new Date(week.days[0]!.date.getTime() + 7 * DAY);
}

/** The Monday of the previous week. */
export function previousWeek(week: Week): Date {
  return new Date(week.days[0]!.date.getTime() - 7 * DAY);
}
`;

const tides = `import { moonPhase } from "./moon";
import type { Station } from "./stations";

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
/** Spring ranges are about 20% above the mean, and neap ranges 20% below. */
const SPRING_SPREAD = 0.2;

/** How much of the mean range a tide has at a time: more at spring tides. */
export function rangeFactor(at: Date): number {
  const { age } = moonPhase(at);
  return 1 + SPRING_SPREAD * Math.cos(4 * Math.PI * age);
}

/** High and low waters for a station between two times: a single M2
 * constituent, with the range scaled for spring and neap tides. That is close
 * enough for a harbour table and far from a pilot's. */
export function predictRange(station: Station, from: Date, to: Date): Tide[] {
  const half = M2 / 2;
  const tides: Tide[] = [];
  let at = EPOCH + Math.ceil((from.getTime() - EPOCH) / half) * half;
  for (; at < to.getTime(); at += half) {
    const high = Math.abs(Math.round((at - EPOCH) / half)) % 2 === 0;
    const range = station.range * rangeFactor(new Date(at));
    const mean = station.range / 2;
    tides.push({
      kind: high ? "high" : "low",
      at: new Date(at),
      height: Math.round((high ? mean + range / 2 : mean - range / 2) * 100) / 100,
    });
  }
  return tides;
}

/** High and low waters for a station on one day. */
export function predict(station: Station, day: Date): Tide[] {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return predictRange(station, new Date(start), new Date(start + 24 * 60 * 60 * 1000));
}
`;

const cli = `import { parseArgs } from "node:util";
import { formatDay } from "./format/day";
import { formatHeight, heightBar } from "./format/height";
import { formatTime } from "./format/time";
import { moonGlyph } from "./moon";
import { findStations } from "./search";
import { predict } from "./tides";
import { buildWeek, springDays } from "./week";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    week: { type: "boolean", short: "w" },
    feet: { type: "boolean" },
    serve: { type: "boolean" },
    port: { type: "string", default: "4848" },
  },
});
const [query = "", date] = positionals;
const day = date ? new Date(date) : new Date();
const unit = values.feet ? "ft" : "m";

if (values.serve) {
  const { serve } = await import("./server");
  serve(Number(values.port));
} else {
  for (const station of findStations(query)) {
    console.log(station.name);
    if (values.week) {
      const week = buildWeek(station, day);
      for (const entry of week.days) {
        const times = entry.tides
          .map((tide) => \`\${tide.kind === "high" ? "▲" : "▼"} \${formatTime(tide.at, station.timeZone)}\`)
          .join("  ");
        const bar = heightBar(entry.range, week.biggest.range);
        console.log(
          \`  \${formatDay(entry.date, station.timeZone).padEnd(11)} \${moonGlyph(entry.moon)}  \${times}  \${bar} \${formatHeight(entry.range, unit)}\`,
        );
      }
      const springs = springDays(week).map((entry) => formatDay(entry.date, station.timeZone));
      if (springs.length) console.log(\`  Spring tides: \${springs.join(", ")}\`);
      continue;
    }
    for (const tide of predict(station, day))
      console.log(
        \`  \${tide.kind.padEnd(4)} \${formatTime(tide.at, station.timeZone)}  \${formatHeight(tide.height, unit)}\`,
      );
  }
}
`;

const formatTime = `const formatters = new Map<string, Intl.DateTimeFormat>();

/** A time of day at a station, such as 04:41, in the station's own zone and
 * with its daylight saving time. */
export function formatTime(at: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter.format(at);
}

/** The station's offset from UTC at a time, such as +02:00. */
export function formatOffset(at: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return !name || name === "GMT" ? "+00:00" : name.replace("GMT", "");
}
`;

const formatHeight = `export type Unit = "m" | "ft";

const FEET_PER_METRE = 3.28084;

/** A height with one decimal, such as 3.7 m or 12.1 ft. */
export function formatHeight(metres: number, unit: Unit = "m"): string {
  const value = unit === "ft" ? metres * FEET_PER_METRE : metres;
  return \`\${value.toFixed(1)} \${unit}\`;
}

/** A height as a bar of blocks for the terminal week table. */
export function heightBar(metres: number, max: number, width = 8): string {
  if (max <= 0) return "".padEnd(width, "·");
  const filled = Math.round((Math.max(0, metres) / max) * width);
  return "█".repeat(Math.min(width, filled)).padEnd(width, "·");
}
`;

const formatDay = `const parts = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let entry = parts.get(timeZone);
  if (!entry) {
    entry = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    parts.set(timeZone, entry);
  }
  return entry;
}

/** A day at a station, such as Mon 12 Oct. */
export function formatDay(day: Date, timeZone: string): string {
  const values = formatter(timeZone).formatToParts(day);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((part) => part.type === type)?.value ?? "";
  return \`\${get("weekday")} \${get("day")} \${get("month")}\`;
}

/** A week as a range, such as 12–18 Oct, or 28 Sep – 4 Oct across months. */
export function formatWeek(first: Date, last: Date, timeZone: string): string {
  const [, firstDay, firstMonth] = formatDay(first, timeZone).split(" ");
  const [, lastDay, lastMonth] = formatDay(last, timeZone).split(" ");
  return firstMonth === lastMonth
    ? \`\${firstDay}–\${lastDay} \${lastMonth}\`
    : \`\${firstDay} \${firstMonth} – \${lastDay} \${lastMonth}\`;
}
`;

const shareToken = `import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** What a share link grants: one station's week, until it expires. */
export interface ShareClaim {
  station: string;
  /** The Monday of the shared week, as YYYY-MM-DD. */
  week: string;
  /** Expiry, in seconds since the epoch. */
  expires: number;
}

/** Links last 30 days at most. */
const MAX_AGE = 30 * 24 * 60 * 60;

/** A new random secret for signing links, as base64url. Keep it out of Git. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** A token for a share link: the claim and its signature, both base64url. */
export function createShareToken(
  claim: Omit<ShareClaim, "expires">,
  secret: string,
  maxAge = MAX_AGE,
  now = Date.now(),
): string {
  if (secret.length < 32) throw new Error("The share secret is too short.");
  const full: ShareClaim = { ...claim, expires: Math.floor(now / 1000) + Math.min(maxAge, MAX_AGE) };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return \`\${payload}.\${sign(payload, secret)}\`;
}

/** The claim of a valid token, or null for a forged, damaged, or expired one. */
export function verifyShareToken(token: string, secret: string, now = Date.now()): ShareClaim | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ShareClaim;
    if (typeof claim.station !== "string" || typeof claim.week !== "string") return null;
    if (!Number.isInteger(claim.expires) || claim.expires * 1000 < now) return null;
    return claim;
  } catch {
    return null;
  }
}
`;

const server = `import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openCache } from "./cache/store";
import { verifyShareToken } from "./share/token";
import { stations } from "./stations";
import { buildWeek } from "./week";

const web = join(import.meta.dir, "web");
const secret = process.env.TIDE_SHARE_SECRET ?? "";

/** Serves the week page and its data on this computer. A share link carries
 * a token; without TIDE_SHARE_SECRET, share links do not open. */
export function serve(port: number) {
  const cache = openCache();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") return file("index.html", "text/html");
      if (url.pathname === "/week.css") return file("week.css", "text/css");
      if (url.pathname === "/week.js") return script();
      const match = /^\\/api\\/week\\/([a-z-]+)$/.exec(url.pathname);
      if (!match) return new Response("Not found", { status: 404 });
      const station = stations.find((entry) => entry.id === match[1]);
      if (!station) return new Response("No such station", { status: 404 });
      const from = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
      const token = url.searchParams.get("token");
      if (token) {
        const claim = secret ? verifyShareToken(token, secret) : null;
        if (!claim || claim.station !== station.id)
          return new Response("This link has expired", { status: 403 });
      }
      const key = \`\${station.id}:\${from}\`;
      const cached = cache.get(key);
      if (cached) return Response.json(cached);
      const week = buildWeek(station, new Date(from));
      cache.put(key, week);
      return Response.json(week);
    },
  });
  console.log(\`Week view: http://127.0.0.1:\${server.port}/\`);
  return server;
}

async function file(name: string, type: string) {
  return new Response(await readFile(join(web, name)), {
    headers: { "content-type": \`\${type}; charset=utf-8\` },
  });
}

async function script() {
  const built = await Bun.build({ entrypoints: [join(web, "week.ts")], target: "browser" });
  return new Response(built.outputs[0], {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  });
}
`;

const cacheStore = `import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Predictions do not change, so the cache keeps them for a year. */
const MAX_AGE = 365 * 24 * 60 * 60 * 1000;

export interface Cache {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  close(): void;
}

/** Opens the prediction cache in ~/.cache/tide and applies its migrations. */
export function openCache(folder = join(homedir(), ".cache", "tide")): Cache {
  mkdirSync(folder, { recursive: true });
  const db = new Database(join(folder, "predictions.db"));
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  const select = db.query<{ value: string; created: number }, [string]>(
    "SELECT value, created FROM predictions WHERE key = ?",
  );
  const insert = db.query("INSERT OR REPLACE INTO predictions (key, value, created) VALUES (?, ?, ?)");
  return {
    get(key) {
      const row = select.get(key);
      if (!row || Date.now() - row.created > MAX_AGE) return undefined;
      return JSON.parse(row.value);
    },
    put(key, value) {
      insert.run(key, JSON.stringify(value), Date.now());
    },
    close: () => db.close(),
  };
}

/** Applies each migration once, in name order, in its own transaction. */
function migrate(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)");
  const done = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM migrations")
      .all()
      .map((row) => row.name),
  );
  const folder = join(import.meta.dir, "migrations");
  for (const name of readdirSync(folder).filter((file) => file.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(folder, name), "utf8"));
      db.query("INSERT INTO migrations (name) VALUES (?)").run(name);
    })();
  }
}
`;

const migration = `-- Predictions by station and week, as JSON. A key is "<station>:<YYYY-MM-DD>".
CREATE TABLE predictions (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE INDEX predictions_created ON predictions (created);
`;

const generateStations = `// Writes src/web/stations.generated.ts from src/stations.ts, so the page
// does not bundle the CLI's modules. Run: bun scripts/generate-stations.ts
import { writeFile } from "node:fs/promises";
import { stations } from "../src/stations";

const lines = [
  "// Generated by scripts/generate-stations.ts. Do not edit.",
  "",
  "export interface PageStation {",
  "  id: string;",
  "  name: string;",
  "  region: string;",
  "  timeZone: string;",
  "  range: number;",
  "}",
  "",
  "export const pageStations: PageStation[] = [",
  ...stations.map((station) => \`  \${JSON.stringify(station)},\`),
  "];",
  "",
];
await writeFile(new URL("../src/web/stations.generated.ts", import.meta.url), lines.join("\\n"));
`;

// ------------------------------------------------------------------- web

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>tide · week</title>
    <link rel="stylesheet" href="/week.css" />
  </head>
  <body>
    <header class="bar">
      <select id="station" aria-label="Station"></select>
      <button id="previous" aria-label="Previous week">←</button>
      <h1 id="title">This week</h1>
      <button id="next" aria-label="Next week">→</button>
      <button id="share" class="quiet">Share</button>
    </header>
    <main>
      <svg id="chart" role="img" aria-label="Tide heights for the week"></svg>
      <table id="days">
        <thead>
          <tr><th>Day</th><th>Moon</th><th>High</th><th>Low</th><th>Range</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </main>
    <script type="module" src="/week.js"></script>
  </body>
</html>
`;

const webWeek = `import { drawChart } from "./chart";
import { pageStations } from "./stations.generated";

interface PageTide {
  kind: "high" | "low";
  at: string;
  height: number;
}
interface PageDay {
  date: string;
  tides: PageTide[];
  moon: { name: string; illumination: number };
  range: number;
  kind: "spring" | "neap" | "mean";
}
interface PageWeek {
  days: PageDay[];
  extremes: { high: number; low: number };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("station");
const title = $<HTMLHeadingElement>("title");
const body = $<HTMLTableElement>("days").tBodies[0]!;
const chart = document.getElementById("chart") as unknown as SVGSVGElement;

const params = new URLSearchParams(location.search);
let station = params.get("station") ?? pageStations[0]!.id;
let monday = params.get("from") ?? new Date().toISOString().slice(0, 10);
const token = params.get("token");

for (const entry of pageStations) {
  const option = new Option(entry.name, entry.id, false, entry.id === station);
  select.add(option);
}

const time = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(at),
  );
const dayName = (date: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric" }).format(
    new Date(date),
  );

async function load() {
  const query = new URLSearchParams({ from: monday, ...(token ? { token } : {}) });
  const response = await fetch(\`/api/week/\${station}?\${query}\`);
  if (!response.ok) {
    title.textContent = await response.text();
    body.replaceChildren();
    chart.replaceChildren();
    return;
  }
  render((await response.json()) as PageWeek);
  history.replaceState(null, "", \`?station=\${station}&from=\${monday}\`);
}

function render(week: PageWeek) {
  const zone = pageStations.find((entry) => entry.id === station)!.timeZone;
  const first = week.days[0]!;
  const last = week.days.at(-1)!;
  title.textContent = \`\${dayName(first.date, zone)} – \${dayName(last.date, zone)}\`;
  body.replaceChildren(
    ...week.days.map((day) => {
      const row = document.createElement("tr");
      row.className = day.kind;
      const highs = day.tides.filter((tide) => tide.kind === "high");
      const lows = day.tides.filter((tide) => tide.kind === "low");
      const cells = [
        dayName(day.date, zone),
        day.moon.name,
        highs.map((tide) => \`\${time(tide.at, zone)} \${tide.height.toFixed(1)}\`).join(" · "),
        lows.map((tide) => \`\${time(tide.at, zone)} \${tide.height.toFixed(1)}\`).join(" · "),
        \`\${day.range.toFixed(1)} m\`,
      ];
      for (const text of cells) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    }),
  );
  drawChart(
    chart,
    week.days.flatMap((day) => day.tides.map((tide) => ({ at: new Date(tide.at), height: tide.height }))),
    week.extremes,
  );
}

function move(days: number) {
  const date = new Date(monday);
  date.setUTCDate(date.getUTCDate() + days);
  monday = date.toISOString().slice(0, 10);
  void load();
}

select.addEventListener("change", () => {
  station = select.value;
  void load();
});
$("previous").addEventListener("click", () => move(-7));
$("next").addEventListener("click", () => move(7));
$("share").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("share").textContent = "Copied";
  setTimeout(() => ($("share").textContent = "Share"), 1500);
});
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  if (event.key === "ArrowLeft") move(-7);
  if (event.key === "ArrowRight") move(7);
});

void load();
`;

const webChart = `/** A tide as the chart draws it. */
export interface ChartPoint {
  at: Date;
  height: number;
}

const WIDTH = 720;
const HEIGHT = 180;
const PAD = 16;
const SVG = "http://www.w3.org/2000/svg";

/** The x and y of each tide in the chart's box. */
export function chartPoints(points: readonly ChartPoint[], extremes: { high: number; low: number }) {
  if (points.length === 0) return [];
  const from = points[0]!.at.getTime();
  const span = Math.max(1, points.at(-1)!.at.getTime() - from);
  const scale = Math.max(0.1, extremes.high - extremes.low);
  return points.map((point) => ({
    x: PAD + ((point.at.getTime() - from) / span) * (WIDTH - 2 * PAD),
    y: HEIGHT - PAD - ((point.height - extremes.low) / scale) * (HEIGHT - 2 * PAD),
  }));
}

/** A smooth path through the tides: a cosine between each high and low, as
 * the water moves between them. */
export function tidePath(xy: readonly { x: number; y: number }[]): string {
  if (xy.length === 0) return "";
  let path = \`M\${xy[0]!.x.toFixed(1)} \${xy[0]!.y.toFixed(1)}\`;
  for (let index = 1; index < xy.length; index++) {
    const a = xy[index - 1]!;
    const b = xy[index]!;
    const mid = (a.x + b.x) / 2;
    path += \` C\${mid.toFixed(1)} \${a.y.toFixed(1)} \${mid.toFixed(1)} \${b.y.toFixed(1)} \${b.x.toFixed(1)} \${b.y.toFixed(1)}\`;
  }
  return path;
}

/** Draws the week's tides into an SVG element, with a line at mean level. */
export function drawChart(svg: SVGSVGElement, points: readonly ChartPoint[], extremes: { high: number; low: number }) {
  svg.setAttribute("viewBox", \`0 0 \${WIDTH} \${HEIGHT}\`);
  const xy = chartPoints(points, extremes);
  const mean = document.createElementNS(SVG, "line");
  const middle = HEIGHT / 2;
  mean.setAttribute("x1", String(PAD));
  mean.setAttribute("x2", String(WIDTH - PAD));
  mean.setAttribute("y1", String(middle));
  mean.setAttribute("y2", String(middle));
  mean.setAttribute("class", "mean");
  const curve = document.createElementNS(SVG, "path");
  curve.setAttribute("d", tidePath(xy));
  curve.setAttribute("class", "curve");
  svg.replaceChildren(mean, curve);
}
`;

const webCss = `:root {
  color-scheme: light dark;
  --ink: #1d2430;
  --muted: #687385;
  --line: #dfe3ea;
  --sea: #2f6fb0;
  --spring: #e9f1fb;
  --paper: #fbfbfa;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8eaee;
    --muted: #9aa3b2;
    --line: #2b313b;
    --sea: #7fb2e5;
    --spring: #18273a;
    --paper: #121418;
  }
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
}

.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
}

.bar h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.bar button,
.bar select {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.bar .quiet {
  margin-left: auto;
  color: var(--muted);
}

main {
  max-width: 820px;
  margin: 0 auto;
  padding: 20px;
}

#chart {
  width: 100%;
  height: auto;
  margin-bottom: 20px;
}

#chart .mean {
  stroke: var(--line);
  stroke-dasharray: 4 4;
}

#chart .curve {
  fill: none;
  stroke: var(--sea);
  stroke-width: 2;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}

tr.spring td {
  background: var(--spring);
}

tr.neap td {
  color: var(--muted);
}
`;

/** The generated station list: what scripts/generate-stations.ts writes. */
function stationsGenerated() {
  const rows = [
    ["aberdeen", "Aberdeen", "North Sea", "Europe/London", 3.7],
    ["alesund", "Ålesund", "Atlantic", "Europe/Oslo", 1.9],
    ["brest", "Brest", "Atlantic", "Europe/Paris", 6.1],
    ["cadiz", "Cádiz", "Atlantic", "Europe/Madrid", 2.3],
    ["den-helder", "Den Helder", "North Sea", "Europe/Amsterdam", 1.4],
    ["gdansk", "Gdańsk", "Baltic", "Europe/Warsaw", 0.1],
    ["marseille", "Marseille", "Mediterranean", "Europe/Paris", 0.2],
    ["st-malo", "Saint-Malo", "Atlantic", "Europe/Paris", 8.0],
    ["tromso", "Tromsø", "Atlantic", "Europe/Oslo", 2.2],
  ];
  return [
    "// Generated by scripts/generate-stations.ts. Do not edit.",
    "",
    "export interface PageStation {",
    "  id: string;",
    "  name: string;",
    "  region: string;",
    "  timeZone: string;",
    "  range: number;",
    "}",
    "",
    "export const pageStations: PageStation[] = [",
    ...rows.flatMap(([id, name, region, timeZone, range]) => [
      "  {",
      `    "id": ${JSON.stringify(id)},`,
      `    "name": ${JSON.stringify(name)},`,
      `    "region": ${JSON.stringify(region)},`,
      `    "timeZone": ${JSON.stringify(timeZone)},`,
      `    "range": ${range}`,
      "  },",
    ]),
    "];",
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ tests

const weekTest = `import { describe, expect, test } from "bun:test";
import { stations } from "../src/stations";
import { buildWeek, dayRange, springDays, startOfWeek, tideKind } from "../src/week";

const brest = stations.find((station) => station.id === "brest")!;

describe("startOfWeek", () => {
  test("starts on Monday", () => {
    expect(startOfWeek(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  test("keeps a Monday", () => {
    expect(startOfWeek(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  test("moves a Sunday back six days", () => {
    expect(startOfWeek(new Date("2026-10-18T23:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});

describe("buildWeek", () => {
  const week = buildWeek(brest, new Date("2026-10-15"));

  test("has seven days with three or four tides each", () => {
    expect(week.days).toHaveLength(7);
    for (const day of week.days) expect(day.tides.length).toBeGreaterThanOrEqual(3);
    for (const day of week.days) expect(day.tides.length).toBeLessThanOrEqual(4);
  });

  test("names the day with the largest range", () => {
    const largest = Math.max(...week.days.map((day) => day.range));
    expect(week.biggest.range).toBe(largest);
  });

  test("has spring tides near the new moon", () => {
    expect(springDays(week).length).toBeGreaterThan(0);
  });

  test("refuses an empty week", () => {
    expect(() => buildWeek(brest, new Date("2026-10-15"), 0)).toThrow(RangeError);
  });
});

test("a day without a low water has no range", () => {
  expect(dayRange([{ kind: "high", at: new Date(), height: 6 }])).toBe(0);
});

test("a full moon brings spring tides a day and a half later", () => {
  expect(tideKind({ age: 0.5 + 1.5 / 29.53, name: "full", illumination: 1 })).toBe("spring");
  expect(tideKind({ age: 0.25 + 1.5 / 29.53, name: "first quarter", illumination: 0.5 })).toBe("neap");
});
`;

const moonTest = `import { expect, test } from "bun:test";
import { daysToSyzygy, moonGlyph, moonPhase } from "../src/moon";

test("knows a new moon", () => {
  const phase = moonPhase(new Date("2026-01-18T19:52:00Z"));
  expect(phase.name).toBe("new");
  expect(phase.illumination).toBeLessThan(0.01);
});

test("knows a full moon about 15 days later", () => {
  const phase = moonPhase(new Date("2026-02-02T08:00:00Z"));
  expect(phase.name).toBe("full");
  expect(phase.illumination).toBeGreaterThan(0.99);
});

test("counts the days to the next spring tide", () => {
  expect(daysToSyzygy(new Date("2026-01-25T00:00:00Z"))).toBeCloseTo(8.5, 0);
});

test("draws each phase", () => {
  expect(moonGlyph(moonPhase(new Date("2026-02-02T08:00:00Z")))).toBe("🌕");
});
`;

const formatTest = `import { expect, test } from "bun:test";
import { formatHeight } from "../../src/format/height";
import { formatTime } from "../../src/format/time";
import { formatDay } from "../../src/format/day";

test("formats a height with one decimal", () => {
  expect(formatHeight(3.75)).toBe("3.8 m");
});

test("formats a time in the station's zone", () => {
  expect(formatTime(new Date("2026-07-01T04:41:00Z"), "Europe/London")).toBe("05:41");
});

test("formats a day", () => {
  expect(formatDay(new Date("2026-10-12T12:00:00Z"), "Europe/Paris")).toBe("Mon 12 Oct");
});
`;

const chartTest = `import { expect, test } from "bun:test";
import { chartPoints, tidePath } from "../../src/web/chart";

const points = [
  { at: new Date("2026-10-12T04:00:00Z"), height: 6 },
  { at: new Date("2026-10-12T10:12:00Z"), height: 0.4 },
  { at: new Date("2026-10-12T16:24:00Z"), height: 5.8 },
];

test("puts the first tide on the left and the last on the right", () => {
  const xy = chartPoints(points, { high: 6, low: 0.4 });
  expect(xy[0]!.x).toBe(16);
  expect(xy.at(-1)!.x).toBe(704);
});

test("puts high water above low water", () => {
  const [high, low] = chartPoints(points, { high: 6, low: 0.4 });
  expect(high!.y).toBeLessThan(low!.y);
});

test("draws one curve for each change of tide", () => {
  const path = tidePath(chartPoints(points, { high: 6, low: 0.4 }));
  expect(path.match(/C/g)).toHaveLength(2);
});

test("draws nothing for no tides", () => {
  expect(tidePath([])).toBe("");
});
`;

// ------------------------------------------------------------------- docs

const weekDoc = `# Week view

\`tide <station> --week\` shows seven days of tides from Monday, one row for
each day, with the moon and the day's range. \`tide --serve\` opens the same
week as a page on this computer.

![The week page for Brest](week-view.png)

## Spring and neap tides

Ranges are larger near new and full moons (spring tides) and smaller near the
quarters (neap tides). tide scales each station's mean range by the moon's
phase, with a lag of a day and a half: the age of the tide. A spring day shows
"spring" in the table and a blue row on the page.

This is a model, not a prediction service. Do not navigate with it.

## Sharing a week

Set \`TIDE_SHARE_SECRET\` to a long random value, then use Share on the page.
A link opens one station's week for 30 days. Without the secret, links do not
open.

\`\`\`sh
export TIDE_SHARE_SECRET=$(bun -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')
tide --serve
\`\`\`

## Cache

Predictions for a week are kept in \`~/.cache/tide/predictions.db\` for a year.
Remove the file to clear it. Migrations in \`src/cache/migrations\` run once
each, in name order.

## Stations on the page

The page reads \`src/web/stations.generated.ts\`, which
\`scripts/generate-stations.ts\` writes from \`src/stations.ts\`. Run it after you
add a station.
`;

const changelog = `# Changelog

## 0.4.0

- A week view: \`tide brest --week\`, with the moon and spring and neap tides.
- A week page: \`tide --serve\`, with a chart and links to share a week.
- Ranges follow the moon: spring tides are about 20% larger than the mean.
- Heights in feet with \`--feet\`.
- Formatting moved to \`src/format/\`; times use the station's zone with
  daylight saving time.

## 0.3.0

- Heights with one decimal.
- The prediction model in the README.
`;

const readmeWeek = `
## A week at a time

\`\`\`sh
tide brest --week
\`\`\`

Brest
  Mon 12 Oct  🌑  ▲ 04:41  ▼ 10:53  ▲ 17:06  ▼ 23:18  ████████ 7.3 m
  Tue 13 Oct  🌒  ▲ 05:28  ▼ 11:40  ▲ 17:52        ███████· 7.0 m
  Spring tides: Mon 12 Oct, Tue 13 Oct

\`tide --serve\` shows the week as a page. See [the week view](docs/week-view.md).
`;

// ----------------------------------------------------------------- config

const packageJson = `{
  "name": "tide",
  "version": "0.4.0",
  "description": "Tide tables for harbours",
  "type": "module",
  "bin": { "tide": "src/cli.ts" },
  "scripts": {
    "test": "bun test",
    "serve": "bun src/cli.ts --serve",
    "stations": "bun scripts/generate-stations.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "1.3.5",
    "typescript": "5.9.3"
  }
}
`;

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src", "tests", "scripts"]
}
`;

const workflow = `name: test

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.5
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
`;

/** A Bun text lockfile for the two dev dependencies and theirs. */
function lockfile() {
  const integrity = (name) => `sha512-${createHash("sha512").update(name).digest("base64")}`;
  const packages = [
    ["@types/bun", "1.3.5", { dependencies: { "bun-types": "1.3.5" } }],
    ["@types/node", "24.9.1", { dependencies: { "undici-types": "~7.16.0" } }],
    ["@types/react", "19.2.2", { dependencies: { csstype: "^3.0.2" } }],
    [
      "bun-types",
      "1.3.5",
      { dependencies: { "@types/node": "*" }, peerDependencies: { "@types/react": "^19" } },
    ],
    ["csstype", "3.1.3", {}],
    ["typescript", "5.9.3", { bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" } }],
    ["undici-types", "7.16.0", {}],
  ];
  return [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "": {',
    '      "name": "tide",',
    '      "devDependencies": {',
    '        "@types/bun": "1.3.5",',
    '        "typescript": "5.9.3",',
    "      },",
    "    },",
    "  },",
    '  "packages": {',
    ...packages.flatMap(([name, version, meta]) => [
      `    "${name}": ["${name}@${version}", "", ${JSON.stringify(meta).replace(/,/g, ", ").replace(/:/g, ": ")}, "${integrity(`${name}@${version}`)}"],`,
      "",
    ]),
    "  }",
    "}",
    "",
  ].join("\n");
}

/** A small PNG: the week page's chart as a strip of blue bars. */
function screenshotPng() {
  const width = 96;
  const height = 48;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) {
      const level = height / 2 + Math.sin((x / width) * Math.PI * 6) * (height / 3);
      const water = y > level;
      row.push(...(water ? [47, 111, 176] : [251, 251, 250]));
    }
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Adds the week-view branch in a new worktree of `repo`, as one commit an
 * hour old. `helpers` are world.mjs's git, put, and dated.
 */
export async function buildWeekView({ repo, trees, now, helpers: { git, put, dated } }) {
  const path = join(trees, "week-view");
  git(repo, ["worktree", "add", "-q", "-b", "week-view", path, "main"]);
  const readme = await readFile(join(path, "README.md"), "utf8");
  const written = {
    "src/week.ts": week,
    "src/moon.ts": moon,
    "src/tides.ts": tides,
    "src/cli.ts": cli,
    "src/format/time.ts": formatTime,
    "src/format/height.ts": formatHeight,
    "src/format/day.ts": formatDay,
    "src/share/token.ts": shareToken,
    "src/server.ts": server,
    "src/cache/store.ts": cacheStore,
    "src/cache/migrations/001_predictions.sql": migration,
    "src/web/index.html": indexHtml,
    "src/web/week.ts": webWeek,
    "src/web/chart.ts": webChart,
    "src/web/week.css": webCss,
    "src/web/stations.generated.ts": stationsGenerated(),
    "scripts/generate-stations.ts": generateStations,
    "tests/week.test.ts": weekTest,
    "tests/moon.test.ts": moonTest,
    "tests/format/format.test.ts": formatTest,
    "tests/web/chart.test.ts": chartTest,
    "docs/week-view.md": weekDoc,
    "CHANGELOG.md": changelog,
    "README.md": readme.replace("\n## How it predicts", `${readmeWeek}\n## How it predicts`),
    "package.json": packageJson,
    "tsconfig.json": tsconfig,
    ".github/workflows/test.yml": workflow,
    "bun.lock": lockfile(),
  };
  for (const [file, text] of Object.entries(written)) await put(path, file, text);
  await put(path, "docs/week-view.png", screenshotPng());
  // The old single-file formatter moves to src/format/; its test moves too.
  await rm(join(path, "src/format.ts"));
  await rm(join(path, "tests/format.test.ts"));
  git(path, ["add", "-A"]);
  git(
    path,
    ["commit", "-qm", "feat: a week view with spring and neap tides, a page, and share links"],
    dated(now - 60 * 60 * 1000),
  );
  return path;
}

/** The thread for the week view: a saved review with no agent session. */
export function registerWeekView(cli, path) {
  cli([
    "review",
    "create",
    "--title",
    "Week view",
    "--repo",
    path,
    "--base",
    "main",
    "--head",
    "week-view",
    "--key",
    "week-view",
    "--no-pr",
  ]);
}
