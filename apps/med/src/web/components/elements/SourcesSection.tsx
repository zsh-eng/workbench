import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { Discovery, SetupApi } from "../../data/setup";
import { tokens } from "../../theme.stylex";
import { useFoundSources, type FoundRow, type FoundSources } from "../found-sources";
import { SourcesView, type Source } from "../SourcesPage";
import { Section, Specimen } from "./Specimen";

const HOME = "/Users/sam";
const sources: Source[] = [
  { id: "r1", name: "trail-notes", path: `${HOME}/code/trail-notes`, kind: "repo" },
  { id: "r2", name: "med", path: `${HOME}/code/med`, kind: "repo" },
  { id: "r3", name: "reader", path: `${HOME}/code/reader`, kind: "repo" },
  { id: "r4", name: "dotfiles", path: `${HOME}/dotfiles`, kind: "repo" },
  {
    id: "v1",
    name: "Notes",
    path: `${HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes`,
    kind: "vault",
    index: { state: "ready", revision: 4, result: { notes: 2341 } },
  },
  {
    id: "v2",
    name: "Research",
    path: `${HOME}/Documents/Research`,
    kind: "vault",
    index: { state: "indexing", revision: 1 },
  },
  {
    id: "v3",
    name: "Archive",
    path: `${HOME}/Documents/Old/archive-2023`,
    kind: "vault",
    index: { state: "error", revision: 2, error: "The folder is not readable." },
  },
];

const HOUR = 3_600_000;
const NOW = Date.now();
const ago = (hours: number) => NOW - hours * HOUR;
/** What a search of the sample home finds. */
const discovery: Discovery = {
  home: HOME,
  repositories: [
    { path: `${HOME}/code/tide-tables`, name: "tide-tables", activity: ago(0.2), branch: "main" },
    {
      path: `${HOME}/code/station-archive`,
      name: "station-archive",
      activity: ago(5),
      branch: "feature/moon-phase",
    },
    { path: `${HOME}/Developer/spaced`, name: "spaced", activity: ago(72), branch: "main" },
    { path: `${HOME}/code/harbour-map`, name: "harbour-map", activity: ago(220), branch: "main" },
    { path: `${HOME}/Projects/old-blog`, name: "old-blog", activity: ago(9600), branch: "master" },
    { path: `${HOME}/Projects/almanac`, name: "almanac", activity: ago(14000), branch: "main" },
    { path: `${HOME}/Projects/kite`, name: "kite", activity: ago(21000), branch: "trunk" },
  ],
  vaults: [
    { path: `${HOME}/Notes`, name: "Notes", activity: ago(2) },
    {
      path: `${HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Field log`,
      name: "Field log",
      activity: ago(120),
    },
  ],
  skipped: ["Desktop", "Documents", "Downloads"],
  truncated: false,
};

/** The sample home's setup: a search finds the sample folders, and an add
 * registers one after a moment. It changes this specimen only. */
function sampleSetup(register: (source: Source) => void): SetupApi {
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  return {
    status: async () => ({ sources: [], login: { available: false, enabled: false } }),
    discover: async () => {
      await wait(400);
      return discovery;
    },
    add: async (path, kind = "repo") => {
      await wait(600);
      if (!path.startsWith(`${HOME}/`)) throw new Error("This folder does not exist.");
      register({ id: path, name: path.slice(path.lastIndexOf("/") + 1), path, kind });
    },
    login: async (enabled) => ({ available: true, enabled }),
  };
}

/** The Sources page on sample sources. Add and Remove change the sample only. */
function Sample({ initial, finding = false }: { initial: Source[]; finding?: boolean }) {
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(finding);
  const [api] = useState(() =>
    sampleSetup((source) =>
      setList((rows) => [...rows.filter((row) => row.path !== source.path), source]),
    ),
  );
  const found = useFoundSources({ api, registered: list, home: HOME, refresh: async () => {} });
  const { start } = found;
  useEffect(() => {
    if (open) start();
  }, [open, start]);
  return (
    <div {...stylex.props(styles.window)}>
      <SourcesView
        sources={list}
        home={HOME}
        loaded
        found={open ? found : null}
        onOpen={() => {}}
        onFinding={setOpen}
        onRequest={async (action, body) => {
          const id = (body as { source: string }).source;
          if (action === "remove") setList((rows) => rows.filter((row) => row.id !== id));
        }}
      />
    </div>
  );
}

const row = (at: number, state: FoundRow["state"], recent: boolean): FoundRow => ({
  ...discovery.repositories[at]!,
  kind: "repo",
  state,
  recent,
});
/** Each state of a found row at once, which the page shows only in passing. */
const states: FoundSources = {
  searched: true,
  searching: false,
  unavailable: false,
  rows: [
    row(0, "idle", true),
    row(1, "adding", true),
    { ...discovery.vaults[0]!, kind: "vault", state: "idle", recent: true },
    row(2, "failed", true),
    row(4, "idle", false),
  ],
  home: HOME,
  skipped: discovery.skipped,
  addingRecent: false,
  error: "spaced: This folder is not a Git repository.",
  start() {},
  searchAll() {},
  add() {},
  addRecent() {},
  addPath: async () => {},
};

export function SourcesSection() {
  return (
    <Section
      id="sources"
      title="Sources"
      lede="The folders that Med watches. The page takes the review's frame, and its first row is the card's tab when the title bar is hidden."
    >
      <Specimen
        title="Sources"
        note="One row per folder: its name, where it is, and a vault's index. Names share one column, so the locations line up. Actions show on hover. Add sources… shows what Med found on this computer."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <Sample initial={sources} />
      </Specimen>
      <Specimen
        title="Found on this computer"
        note="A found row is a registered row with Add at its end. Here are its states at once: ready, adding, and failed, with the failure under the list."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.window)}>
          <SourcesView
            sources={sources.slice(1, 3)}
            home={HOME}
            loaded
            found={states}
            onOpen={() => {}}
            onFinding={() => {}}
            onRequest={async () => {}}
          />
        </div>
      </Specimen>
      <Specimen
        title="First run"
        note="With nothing registered, the page opens on what Med found. Add moves a row to the list above; Add the recent takes those used lately."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <Sample initial={[]} finding />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  window: {
    display: "flex",
    flexDirection: "column",
    height: 520,
    backgroundColor: tokens.panel,
  },
});
