# Limits and evidence

- **Highlighting.** JavaScript and TypeScript (with JSX), CSS, HTML, JSON and
  JSONC, Markdown, YAML, TOML, Bash, Go, Python, Rust, Swift, SQL, Svelte,
  diff, INI, HTTP, dotenv, shell sessions, Java, Gradle, C++, and XML. Markdown
  code fences use the matching grammar. C, Zig, and other languages show as
  plain text. Colors can differ from Shiki: most grammars give token kinds or
  short scope stacks, so theme rules that match parent scopes can miss them.
  Go, Rust, and Swift give Shiki's full scope stacks.
- **Files.** Other binary files and unknown encodings show metadata only. Med
  does not render text above 8 MiB, 200,000 lines, or 250,000 characters on one
  line, and renders large text plainly. File lists stop at 50,000 entries. See
  [file browsing](../FILE_BROWSING.md).
- **History.** History follows the selected worktree's HEAD. A shallow clone
  can lack the parent that a comparison or blame needs. Blame does not work for
  files that need Git's content conversion.
- **App.** Med is a browser app with a local server. Notes on branches last for
  the session; there is no shared, persistent review store.
- **Saved reviews.** Reviews are local to the computer that runs Med; a
  localhost link does not open the review on another computer. Med keeps a
  closed thread's Review versions and comments for 30 days, then a short
  record of it (title, repository, branch, sessions) for 180 days after the
  close.
  - A review starts with up to 16 targets and keeps up to 128 captures, including
    comparisons that got comments later.
  - Each target captures up to 500 changed files and 24 MiB of patch and source.
    A larger comparison is an error; narrow it.
  - Med stores up to 64 MiB for each review and 500 comments for each review.
    Over 512 MiB in total, Med first removes the captures of the threads that
    closed first, and keeps their short records; it refuses a new capture only
    when the tabs alone use more.
  - Copied comments are limited to 8 MiB. Med reports an error instead of cutting
    comments; narrow line ranges or remove comments first.
  - Binary and very large files keep their diff metadata but give no text
    context for comments.

Measurements: [Zoekt search](../validation/ZOEKT.md) and
[its integration](../validation/ZOEKT_INTEGRATION.md),
[highlighting](../validation/HIGHLIGHTER_INTEGRATION.md),
[everyday interactions](../validation/INTERACTIONS.md),
[symbol search](../validation/SYMBOL_SEARCH.md), and
[Vim navigation](../validation/VIM_NAVIGATION.md).
