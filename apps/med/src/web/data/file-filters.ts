/** Conservative source conventions; do not classify names merely containing "test". */
export function isTestFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(name))
    return (
      /\.(?:test|spec)\.[^.]+$/.test(name) || /(?:^|\/)(?:__tests__|tests?|specs?)\//.test(path)
    );
  if (/\.go$/.test(name)) return /_test\.go$/.test(name);
  if (/\.py$/.test(name)) return /^(?:test_.+|.+_test)\.py$/.test(name);
  if (/\.(?:java|kt|kts|scala)$/.test(name))
    return (
      /(?:Test|Tests|TestCase|Spec)\.(?:java|kt|kts|scala)$/.test(name) ||
      /(?:^|\/)src\/(?:test|androidTest)\//.test(path)
    );
  if (/\.rs$/.test(name)) return /(?:^|\/)tests\//.test(path);
  if (/\.rb$/.test(name)) return /_(?:test|spec)\.rb$/.test(name);
  if (/\.(?:c|cc|cpp|cxx|h|hpp|swift|cs)$/.test(name))
    return /(?:^test_|_test\.|_tests\.|Tests?\.)/.test(name) || /(?:^|\/)tests?\//.test(path);
  return false;
}
const code =
  /\.(?:[cm]?[jt]sx?|vue|svelte|java|kt|kts|scala|go|rs|py|rb|php|c|cc|cpp|cxx|h|hpp|swift|cs|m|mm|zig|sh|bash|zsh|sql|css|scss|sass|less|html|xml|lua|ex|exs|erl|hs)$/i;
const docs = /\.(?:md|mdx|markdown|rst|adoc|txt)$/i;
export type FileKindFilter = "code" | "tests" | "docs";
export function parsePickerFilters(query: string) {
  const kinds: FileKindFilter[] = [];
  const extensions: string[] = [];
  const text = query
    .replace(
      /(?:^|\s)(type:(code|tests|docs)|ext:([a-z0-9,+.-]+))(?=\s|$)/gi,
      (_, _token, kind, ext) => {
        if (kind) kinds.push(kind.toLowerCase());
        else
          extensions.push(
            ...ext
              .toLowerCase()
              .split(",")
              .map((value: string) => value.replace(/^\./, ""))
              .filter(Boolean),
          );
        return " ";
      },
    )
    .trim();
  return { text, kinds: [...new Set(kinds)], extensions: [...new Set(extensions)] };
}
export function matchesFileFilters(path: string, filters: ReturnType<typeof parsePickerFilters>) {
  if (!filters.kinds.length && !filters.extensions.length) return true;
  const test = filters.kinds.length > 0 && isTestFile(path);
  const kind = test ? "tests" : docs.test(path) ? "docs" : code.test(path) ? "code" : null;
  return (
    (!filters.kinds.length || (kind && filters.kinds.includes(kind))) &&
    (!filters.extensions.length ||
      filters.extensions.some((ext) => path.toLowerCase().endsWith(`.${ext}`)))
  );
}

// Package manager lockfiles have no shared format, so they are known by name:
// the common ones, plus the `*.lock` and `*-lock.json|yaml` conventions.
const lockfiles = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "go.sum",
  "Package.resolved",
  "gradle.lockfile",
  "packages.lock.json",
  ".terraform.lock.hcl",
  "conda-lock.yml",
]);
export function isLockfile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return lockfiles.has(name) || /\.lockb?$|-lock\.(?:json|ya?ml)$/i.test(name);
}

export type ChangeKind = "code" | "tests" | "docs" | "lockfiles" | "other";
/** The kind of change a file makes, for the totals breakdown. */
export function changeKind(path: string): ChangeKind {
  if (isLockfile(path)) return "lockfiles";
  if (isTestFile(path)) return "tests";
  if (docs.test(path)) return "docs";
  return code.test(path) ? "code" : "other";
}
