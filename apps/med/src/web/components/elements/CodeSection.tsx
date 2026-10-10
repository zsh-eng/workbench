import { PatchDiff } from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs/react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import * as stylex from "@stylexjs/stylex";
import { useId, useMemo, type ReactNode } from "react";
import type { FileRead } from "../../../shared/local-file";
import { createEditorDrafts } from "../../data/editor-drafts";
import { useTheme } from "../../themes";
import { diffSurfaceStyle, EXPANSION_LINES } from "../diff-surface";
import { FullFileView } from "../FullFileView";
import { relativeTimePatch, sampleFile, themePatch } from "./fixtures";
import { Section, Specimen } from "./Specimen";

/** The visual options of the Changes view, without its review callbacks. */
function useDiffOptions<A>(diffStyle: "unified" | "split" = "unified") {
  const { active } = useTheme();
  return useMemo<FileDiffOptions<A, undefined>>(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      diffStyle,
      overflow: "scroll",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      hunkSeparators: "line-info",
      expansionLineCount: EXPANSION_LINES,
      enableLineSelection: true,
      enableGutterUtility: true,
      unsafeCSS: `[data-utility-button]::before { inset: 0; }
        [data-separator-content] { font-size: 11.5px; letter-spacing: 0.01em; }`,
    }),
    [active, diffStyle],
  );
}

export function Diff<A = undefined>({
  patch,
  selected,
  diffStyle,
  header = false,
  annotations,
  renderAnnotation,
}: {
  patch: string;
  selected?: SelectedLineRange;
  diffStyle?: "unified" | "split";
  header?: boolean;
  annotations?: DiffLineAnnotation<A>[];
  renderAnnotation?(annotation: DiffLineAnnotation<A>): ReactNode;
}) {
  const options = useDiffOptions<A>(diffStyle);
  return (
    <PatchDiff<A>
      patch={patch}
      options={{ ...options, disableFileHeader: !header }}
      selectedLines={selected ?? null}
      lineAnnotations={annotations}
      renderAnnotation={renderAnnotation}
      style={diffSurfaceStyle}
    />
  );
}

function FileSpecimen({ line, query, edit }: { line?: number; query?: string; edit?: boolean }) {
  const identity = `elements-${useId()}`;
  const file = useMemo(() => sampleFile(identity), [identity]);
  const drafts = useMemo(() => createEditorDrafts(), []);
  return (
    <div {...stylex.props(styles.file)}>
      <FullFileView
        file={file}
        loading={false}
        error={null}
        sourceLabel="Working tree"
        line={line}
        highlightQuery={query}
        vimEnabled
        onRefresh={() => {}}
        editor={
          edit
            ? {
                drafts,
                key: identity,
                autoEdit: true,
                write: async (current: FileRead, text: string) => ({ ...current, text }),
              }
            : undefined
        }
      />
    </div>
  );
}

export function CodeSection() {
  return (
    <Section
      id="code"
      title="Code colors"
      lede="Diff lines, word changes, line selection, find matches, and the editor. Each state uses the same Pierre and CodeMirror setup as the Changes and file views. Hover a line to see the hover tint."
    >
      <Specimen
        title="Changes"
        note="Removed and added lines with word-level emphasis"
        zoomable={false}
        padded={false}
      >
        <Diff patch={relativeTimePatch} header />
      </Specimen>
      <Specimen
        title="Selection on context and an addition"
        note="New lines 9–10"
        span="half"
        zoomable={false}
        padded={false}
      >
        <Diff patch={themePatch} selected={{ start: 9, end: 10, side: "additions" }} />
      </Specimen>
      <Specimen
        title="Selection on removals"
        note="Old lines 10–12, with context between"
        span="half"
        zoomable={false}
        padded={false}
      >
        <Diff patch={themePatch} selected={{ start: 10, end: 12, side: "deletions" }} />
      </Specimen>
      <Specimen
        title="Selection on additions"
        note="New lines 12–13"
        span="half"
        zoomable={false}
        padded={false}
      >
        <Diff patch={themePatch} selected={{ start: 12, end: 13, side: "additions" }} />
      </Specimen>
      <Specimen
        title="Split view selection"
        note="New lines 9–13"
        span="half"
        zoomable={false}
        padded={false}
      >
        <Diff
          patch={themePatch}
          diffStyle="split"
          selected={{ start: 9, end: 13, side: "additions" }}
        />
      </Specimen>
      <Specimen
        title="Find in file"
        note="Every match of “distance”. Press / and Enter in the view for the current match."
        span="half"
        zoomable={false}
        padded={false}
      >
        <FileSpecimen query="distance" />
      </Specimen>
      <Specimen
        title="Line selection in a file"
        note="Line 11, as a link to a line opens"
        span="half"
        zoomable={false}
        padded={false}
      >
        <FileSpecimen line={11} />
      </Specimen>
      <Specimen
        title="Editor"
        note="CodeMirror: active line, selection, and search"
        zoomable={false}
        padded={false}
      >
        <FileSpecimen edit />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  file: { display: "flex", flexDirection: "column", height: 360, minHeight: 0 },
});
