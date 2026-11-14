import type {
  CommitApi,
  FileChanges,
  WorkingDiff,
  WorkingFile,
  WorkingStatus,
} from "../../data/commit";
import { hunkBody, splitPatch } from "../../../shared/patch-hunks";

/** Failures and branch states to try on the elements page. */
export interface CommitSwitches {
  hookFails: boolean;
  pushRejected: boolean;
  upstream: boolean;
  slow: boolean;
}

/** One change to a file: where it starts in HEAD's file, its lines (" ",
 * "-", "+"), and whether the index has it. */
interface FakeHunk {
  oldStart: number;
  heading?: string;
  lines: string[];
  staged: boolean;
}
interface FakeFile {
  path: string;
  /** Added and deleted files are one hunk, the whole file. */
  kind: "added" | "deleted" | "modified";
  hunks: FakeHunk[];
}

const hunk = (oldStart: number, lines: string[], staged = false, heading?: string): FakeHunk => ({
  oldStart,
  lines,
  staged,
  heading,
});

function initialFiles(): FakeFile[] {
  return [
    {
      path: "docs/USAGE.md",
      kind: "modified",
      hunks: [
        hunk(
          20,
          [
            " Run med in a checkout to open its changes.",
            "-Med reads the working files; it never writes them.",
            "+Med reads the working files. The Commit tab stages, commits, and discards.",
            " ",
          ],
          false,
          "## Open a review",
        ),
        hunk(
          146,
          [
            " Comments on earlier iterations stay.",
            "+",
            "+## Commit",
            "+",
            "+Press q to stage files or hunks, write a message, and commit. P pushes the branch.",
          ],
          false,
          "An agent that names its task with a key updates one review.",
        ),
      ],
    },
    {
      path: "scripts/obsolete-check.mjs",
      kind: "deleted",
      hunks: [
        hunk(
          1,
          [
            "-// Replaced by the Commit tab's own checks.",
            '-import { check } from "./lib.mjs";',
            "-await check();",
          ],
          true,
        ),
      ],
    },
    {
      path: "src/host/repository/commit-flow.ts",
      kind: "modified",
      hunks: [
        hunk(
          20,
          [
            " const MAX_FILE_PATCH = 2 * 1024 * 1024;",
            "-const LITERAL = {};",
            "+/** Every path is a literal file name, never a pattern. */",
            '+const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };',
            " const kinds: Record<string, ChangeKind> = {",
          ],
          true,
          "const MAX_FILES = 10_000;",
        ),
      ],
    },
    {
      path: "src/web/App.tsx",
      kind: "modified",
      hunks: [
        hunk(
          12,
          [
            ' import { readBrowserToken } from "./data/auth";',
            '+import { createCommitApi } from "./data/commit";',
            ' import { visibleElement } from "./data/palette-focus";',
            " ",
            ' const BriefView = lazy(() => import("./components/BriefView"));',
          ],
          true,
          'import { createFileWorkspace } from "./data/file-workspace";',
        ),
        hunk(
          240,
          [
            "   const [branchPickerOpen, setBranchPickerOpen] = useState(false);",
            "-  const workerPool = useWorkerPool();",
            "+  // Staging and commits need a live checkout, not a branch snapshot.",
            "+  const commitRepo = gitAvailable ? state.session?.repository.path : undefined;",
            "+  const workerPool = useWorkerPool();",
            "   const [diagnostics] = useState(createRenderDiagnostics);",
          ],
          false,
          "export function App({ controller }: AppProps) {",
        ),
      ],
    },
    {
      path: "src/web/components/CommitView.tsx",
      kind: "added",
      hunks: [
        hunk(0, [
          "+/**",
          "+ * Stage files, commit them, and push the branch.",
          "+ */",
          "+export default function CommitView() {",
          "+  return null;",
          "+}",
        ]),
      ],
    },
  ];
}

const counted = (lines: string[], sign: string) => lines.filter((line) => line[0] === sign).length;
const delta = (entry: FakeHunk) => counted(entry.lines, "+") - counted(entry.lines, "-");
const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);

/**
 * One file's patch, as Git writes it: from HEAD to the working file
 * ("all"), from HEAD to the index ("staged"), or from the index to the
 * working file ("unstaged"). A hunk's numbers move with the hunks before it
 * that each side has.
 */
function patchOf(file: FakeFile, side: "all" | "staged" | "unstaged") {
  const { path, kind } = file;
  const shown = file.hunks.filter((entry) =>
    side === "all" ? true : side === "staged" ? entry.staged : !entry.staged,
  );
  if (!shown.length) return "";
  if (kind === "added") {
    const lines = shown[0]!.lines;
    return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +${range(1, lines.length)} @@\n${lines.join("\n")}\n`;
  }
  if (kind === "deleted") {
    const lines = shown[0]!.lines;
    return `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 3333333..0000000\n--- a/${path}\n+++ /dev/null\n@@ -${range(1, lines.length)} +0,0 @@\n${lines.join("\n")}\n`;
  }
  let patch = `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n`;
  for (const entry of shown) {
    const before = file.hunks.filter((other) => other.oldStart < entry.oldStart);
    const shift = (hunks: FakeHunk[]) => hunks.reduce((sum, other) => sum + delta(other), 0);
    const staged = shift(before.filter((other) => other.staged));
    const oldStart = entry.oldStart + (side === "unstaged" ? staged : 0);
    const newStart = entry.oldStart + (side === "staged" ? staged : shift(before));
    const oldCount = entry.lines.length - counted(entry.lines, "+");
    const newCount = entry.lines.length - counted(entry.lines, "-");
    patch += `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@${entry.heading ? ` ${entry.heading}` : ""}\n${entry.lines.join("\n")}\n`;
  }
  return patch;
}

/** Names a file's changes, as the host's stamp does. */
const stampOf = (file: FakeFile) =>
  JSON.stringify([patchOf(file, "staged"), patchOf(file, "unstaged")]);

/** The hunk of a file that a patch's hunk text names, on one side. */
function findHunk(file: FakeFile, text: string, staged: boolean) {
  const side = file.hunks.filter((entry) => entry.staged === staged);
  const texts = splitPatch(patchOf(file, staged ? "staged" : "unstaged")).hunks;
  const index = texts.findIndex(
    (entry) => entry.text === text || hunkBody(entry.text) === hunkBody(text),
  );
  if (index < 0) throw new Error("The hunk changed since the tab showed it.");
  return side[index]!;
}

const hex = (seed: number) =>
  Array.from({ length: 40 }, (_, index) => "0123456789abcdef"[(seed * 7 + index * 13) % 16]).join(
    "",
  );

/**
 * An in-memory checkout behind the Commit tab's API. Nothing here runs Git:
 * staging moves whole files or hunks, a discard drops them, and a commit
 * keeps what was not staged.
 */
export function createFakeRepository(initial: CommitSwitches) {
  let current = initial;
  const switches = () => current;
  let files = initialFiles();
  let commits = 0;
  let ahead = 1;
  let pushedTracking = false;
  let version = 0;
  // Names the working files' content; commits, discards, and resets change it.
  let content = 0;
  const wait = () => new Promise((resolve) => setTimeout(resolve, switches().slow ? 1400 : 180));
  const tracked = () => switches().upstream || pushedTracking;
  const row = (file: FakeFile): WorkingFile => {
    const staged = file.hunks.some((entry) => entry.staged);
    const unstaged = file.hunks.some((entry) => !entry.staged);
    return {
      path: file.path,
      staged: staged ? file.kind : null,
      unstaged: !unstaged
        ? null
        : staged
          ? "modified"
          : file.kind === "added"
            ? "untracked"
            : file.kind,
    };
  };
  const status = (): WorkingStatus => ({
    repo: "/demo/med",
    branch: "feature/commit-tab",
    head: hex(commits + 1),
    upstream: tracked() ? { remote: "origin", branch: "feature/commit-tab" } : null,
    ahead: tracked() ? ahead : 0,
    behind: 0,
    pushRemote: "origin",
    indexKey: String(version),
    files: files.map(row),
  });
  const named = (path: string) => {
    const file = files.find((entry) => entry.path === path);
    if (!file) throw new Error(`${path} has no changes.`);
    return file;
  };
  /** Drop hunks, and a file left without any. */
  const drop = (file: FakeFile, gone: (entry: FakeHunk) => boolean) => {
    file.hunks = file.hunks.filter((entry) => !gone(entry));
    files = files.filter((entry) => entry.hunks.length);
    version += 1;
    content += 1;
  };
  const api: CommitApi = {
    async status() {
      return status();
    },
    async changes(file): Promise<FileChanges> {
      const fake = files.find((entry) => entry.path === file.path);
      return {
        path: file.path,
        staged: fake ? patchOf(fake, "staged") : "",
        unstaged: fake ? patchOf(fake, "unstaged") : "",
        binary: false,
        tooLarge: false,
        stamp: fake ? stampOf(fake) : "",
      };
    },
    async diff(): Promise<WorkingDiff> {
      return {
        id: `fake-${content}`,
        files: files.map((file) => {
          const lines = file.hunks.flatMap((entry) => entry.lines);
          return {
            path: file.path,
            status: file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : "M",
            additions: counted(lines, "+"),
            deletions: counted(lines, "-"),
            binary: false,
            untracked: file.kind === "added" && !file.hunks.some((entry) => entry.staged),
          };
        }),
        patch: files.map((file) => patchOf(file, "all")).join(""),
      };
    },
    async stage(paths, stage) {
      // The view shows a stage at once; a slow answer makes that visible.
      if (switches().slow) await wait();
      for (const file of files)
        if (!paths || paths.includes(file.path))
          for (const entry of file.hunks) entry.staged = stage;
      version += 1;
      return status();
    },
    async stageHunk(file, text, stage) {
      if (switches().slow) await wait();
      findHunk(named(file.path), text, !stage).staged = stage;
      version += 1;
      return status();
    },
    async discard(file, { staged, hunk: text, stamp }) {
      const fake = named(file.path);
      if (text !== undefined) {
        const gone = findHunk(fake, text, staged);
        drop(fake, (entry) => entry === gone);
      } else {
        if (stamp !== stampOf(fake)) throw new Error("The file changed after the tab showed it.");
        drop(fake, (entry) => staged || !entry.staged);
      }
      return status();
    },
    async commit({ message, indexKey, files: shown, all }) {
      await wait();
      if (indexKey !== String(version))
        throw new Error("The staged files or the branch changed since this view loaded.");
      if (switches().hookFails)
        throw new Error(
          "The commit did not complete.\n\nlint-staged: src/web/App.tsx\n  12:3  error  Missing semicolon  semi",
        );
      // Commit all stages its files only for the commit, as git commit -a does.
      const committed = (file: FakeFile, entry: FakeHunk) =>
        entry.staged || (!!all && !!shown?.some((named) => named.path === file.path));
      files = files.flatMap((file) => {
        const left = file.hunks.filter((entry) => !committed(file, entry));
        if (!left.length) return [];
        // What stays moves with the committed lines above it.
        for (const entry of left)
          entry.oldStart += file.hunks
            .filter((other) => committed(file, other) && other.oldStart < entry.oldStart)
            .reduce((sum, other) => sum + delta(other), 0);
        return [{ ...file, hunks: left }];
      });
      commits += 1;
      ahead += 1;
      version += 1;
      content += 1;
      return { head: hex(commits + 1), summary: message.trim().split("\n", 1)[0]! };
    },
    async push(head, track) {
      await wait();
      if (switches().pushRejected)
        throw new Error(
          "The remote branch has changes that this commit does not contain. Fetch and merge or rebase, or push to a new branch.",
        );
      if (!tracked() && !track) throw new Error("feature/commit-tab has no upstream.");
      pushedTracking = true;
      ahead = 0;
      version += 1;
      return { head, remote: "origin", branch: "feature/commit-tab" };
    },
  };
  return {
    api,
    configure(next: CommitSwitches) {
      current = next;
    },
    reset() {
      files = initialFiles();
      commits = 0;
      ahead = 1;
      pushedTracking = false;
      version += 1;
      content += 1;
    },
  };
}
