import type {
  CommitApi,
  FileChanges,
  WorkingDiff,
  WorkingFile,
  WorkingStatus,
} from "../../data/commit";

/** Failures and branch states to try on the elements page. */
export interface CommitSwitches {
  hookFails: boolean;
  pushRejected: boolean;
  upstream: boolean;
  slow: boolean;
}

type Kind = NonNullable<WorkingFile["staged"]>;
interface FakeFile {
  path: string;
  kind: Kind;
  /** The whole change; a partly staged file also has its two halves. */
  patch: string;
  partial?: { staged: string; unstaged: string };
  state: "none" | "partial" | "all";
}

const modified = (path: string, hunks: string) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks}`;
const appHunkA = [
  `@@ -12,4 +12,5 @@ import { createFileWorkspace } from "./data/file-workspace";`,
  ` import { readBrowserToken } from "./data/auth";`,
  `+import { createCommitApi } from "./data/commit";`,
  ` import { visibleElement } from "./data/palette-focus";`,
  ` `,
  ` const BriefView = lazy(() => import("./components/BriefView"));`,
  ``,
].join("\n");
const appHunkB = `@@ -240,3 +241,5 @@ export function App({ controller }: AppProps) {
   const [branchPickerOpen, setBranchPickerOpen] = useState(false);
-  const workerPool = useWorkerPool();
+  // Staging and commits need a live checkout, not a branch snapshot.
+  const commitRepo = gitAvailable ? state.session?.repository.path : undefined;
+  const workerPool = useWorkerPool();
   const [diagnostics] = useState(createRenderDiagnostics);
`;

function initialFiles(): FakeFile[] {
  return [
    {
      path: "docs/USAGE.md",
      kind: "modified",
      patch: modified(
        "docs/USAGE.md",
        `@@ -146,1 +146,5 @@ An agent that names its task with a key updates one review.
 Comments on earlier iterations stay.
+
+## Commit
+
+Press q to stage files, write a message, and commit. P pushes the branch.
`,
      ),
      state: "none",
    },
    {
      path: "scripts/obsolete-check.mjs",
      kind: "deleted",
      patch: `diff --git a/scripts/obsolete-check.mjs b/scripts/obsolete-check.mjs\ndeleted file mode 100644\nindex 3333333..0000000\n--- a/scripts/obsolete-check.mjs\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-// Replaced by the Commit tab's own checks.\n-import { check } from "./lib.mjs";\n-await check();\n`,
      state: "all",
    },
    {
      path: "src/host/repository/commit-flow.ts",
      kind: "modified",
      patch: modified(
        "src/host/repository/commit-flow.ts",
        `@@ -20,3 +20,4 @@ const MAX_FILES = 10_000;
 const MAX_FILE_PATCH = 2 * 1024 * 1024;
-const LITERAL = {};
+/** Every path is a literal file name, never a pattern. */
+const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };
 const kinds: Record<string, ChangeKind> = {
`,
      ),
      state: "all",
    },
    {
      path: "src/web/App.tsx",
      kind: "modified",
      patch: modified("src/web/App.tsx", appHunkA + appHunkB),
      partial: {
        staged: modified("src/web/App.tsx", appHunkA),
        unstaged: modified(
          "src/web/App.tsx",
          appHunkB.replace("@@ -240,3 +241,5 @@", "@@ -241,3 +241,5 @@"),
        ),
      },
      state: "partial",
    },
    {
      path: "src/web/components/CommitView.tsx",
      kind: "added",
      patch: `diff --git a/src/web/components/CommitView.tsx b/src/web/components/CommitView.tsx\nnew file mode 100644\n--- /dev/null\n+++ b/src/web/components/CommitView.tsx\n@@ -0,0 +1,6 @@\n+/**\n+ * Stage files, commit them, and push the branch.\n+ */\n+export default function CommitView() {\n+  return null;\n+}\n`,
      state: "none",
    },
  ];
}

const count = (patch: string, sign: "+" | "-") =>
  patch.split("\n").filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .length;

const hex = (seed: number) =>
  Array.from({ length: 40 }, (_, index) => "0123456789abcdef"[(seed * 7 + index * 13) % 16]).join(
    "",
  );

/**
 * An in-memory checkout behind the Commit tab's API. Nothing here runs Git:
 * staging moves whole files, and a commit keeps what was not staged.
 */
export function createFakeRepository(initial: CommitSwitches) {
  let current = initial;
  const switches = () => current;
  let files = initialFiles();
  let commits = 0;
  let ahead = 1;
  let pushedTracking = false;
  let version = 0;
  // Names the working files' content; only commits and resets change it.
  let content = 0;
  const wait = () => new Promise((resolve) => setTimeout(resolve, switches().slow ? 1400 : 180));
  const tracked = () => switches().upstream || pushedTracking;
  const row = (file: FakeFile): WorkingFile => ({
    path: file.path,
    staged: file.state === "none" ? null : file.kind,
    unstaged:
      file.state === "all" ? null : file.state === "partial" ? "modified" : unstagedKind(file),
  });
  const unstagedKind = (file: FakeFile): Kind => (file.kind === "added" ? "untracked" : file.kind);
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
  const api: CommitApi = {
    async status() {
      return status();
    },
    async changes(file): Promise<FileChanges> {
      const fake = files.find((entry) => entry.path === file.path);
      const parts =
        !fake || fake.state === "none"
          ? { staged: "", unstaged: fake?.patch ?? "" }
          : fake.state === "all"
            ? { staged: fake.patch, unstaged: "" }
            : fake.partial!;
      return { path: file.path, ...parts, binary: false, tooLarge: false };
    },
    async diff(): Promise<WorkingDiff> {
      return {
        id: `fake-${content}`,
        files: files.map((file) => ({
          path: file.path,
          status: file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : "M",
          additions: count(file.patch, "+"),
          deletions: count(file.patch, "-"),
          binary: false,
          untracked: file.kind === "added" && file.state === "none",
        })),
        patch: files.map((file) => file.patch).join(""),
      };
    },
    async stage(paths, stage) {
      // The view shows a stage at once; a slow answer makes that visible.
      if (switches().slow) await wait();
      for (const file of files)
        if (!paths || paths.includes(file.path)) file.state = stage ? "all" : "none";
      version += 1;
      return status();
    },
    async commit(message, indexKey) {
      await wait();
      if (indexKey !== String(version))
        throw new Error("The staged files or the branch changed since this view loaded.");
      if (switches().hookFails)
        throw new Error(
          "The commit did not complete.\n\nlint-staged: src/web/App.tsx\n  12:3  error  Missing semicolon  semi",
        );
      files = files.flatMap((file) =>
        file.state === "all"
          ? []
          : file.state === "partial"
            ? [
                {
                  ...file,
                  patch: file.partial!.unstaged,
                  partial: undefined,
                  state: "none" as const,
                },
              ]
            : [file],
      );
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
