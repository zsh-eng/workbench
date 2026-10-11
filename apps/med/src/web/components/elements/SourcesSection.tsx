import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { tokens } from "../../theme.stylex";
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

/** The Sources page on sample sources. Remove takes the source out here only. */
function Sample({ initial }: { initial: Source[] }) {
  const [list, setList] = useState(initial);
  return (
    <div {...stylex.props(styles.window)}>
      <SourcesView
        sources={list}
        home={HOME}
        loaded
        onBack={() => {}}
        onOpen={() => {}}
        onAdd={() => {}}
        onCommands={() => {}}
        onRequest={async (action, body) => {
          const id = (body as { source: string }).source;
          if (action === "remove") setList((rows) => rows.filter((row) => row.id !== id));
        }}
      />
    </div>
  );
}

export function SourcesSection() {
  return (
    <Section
      id="sources"
      title="Sources"
      lede="The folders that Med watches. The page takes the review's frame, and its first row is the card's tab when the title bar is hidden."
    >
      <Specimen
        title="Sources"
        note="One row per folder: its name, where it is, and a vault's index. Names share one column, so the locations line up. Actions show on hover."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <Sample initial={sources} />
      </Specimen>
      <Specimen
        title="No sources"
        note="The empty page asks for the first folder."
        surface="panel"
        padded={false}
        zoomable={false}
        span="half"
      >
        <Sample initial={[]} />
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
