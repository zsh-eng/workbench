import { platform } from "./keys";

// The shortcut guide's content. Each entry documents what Med's dispatchers
// actually do in that context; keep it in step with App's keydown handler,
// vim-navigation.ts, and the editor overrides in FileEditor.tsx.

export type GuideContextId = "review" | "file" | "editor" | "pickers";

export interface GuideEntry {
  label: string;
  /** Alternative shortcuts in key notation (see data/keys.ts). */
  keys: string[];
  /** Query syntax rather than keys, such as `type:tests`. */
  syntax?: boolean;
  /** When the shortcut applies, or a short clarification. */
  note?: string;
  /** Palette command that performs the same action from the guide. */
  command?: string;
}

export interface GuideGroup {
  title: string;
  description?: string;
  entries: GuideEntry[];
}

export interface GuideContext {
  id: GuideContextId;
  label: string;
  description: string;
  groups: GuideGroup[];
}

const mac = platform === "mac";

export const guideContexts: GuideContext[] = [
  {
    id: "review",
    label: "Review",
    description: "The review shell and the Changes stream.",
    groups: [
      {
        title: "Go to",
        entries: [
          { label: "Open command palette", keys: ["Mod+K"], command: "commands" },
          {
            label: "Find file",
            keys: ["Mod+Shift+K"],
            note: "Type part of a repository name, then Tab to search it",
            command: "open-file",
          },
          {
            label: "Search file contents",
            keys: ["Mod+Shift+F"],
            note: "Committed content",
            command: "content-search",
          },
          {
            label: "Open a branch or worktree",
            keys: ["Mod+Shift+G"],
            note: "Enter opens it here; Mod+Enter opens a new workspace",
            command: "open-branch",
          },
          { label: "Show a workspace by its place in the list", keys: ["Mod+{1–9}"] },
          {
            label: "Switch to a recent workspace",
            keys: ["Ctrl+Tab"],
            note: "Hold Control and press Tab to step",
            command: "switch-workspace",
          },
          { label: "Symbols in this file", keys: ["Mod+O"], command: "file-symbols" },
          { label: "Symbols in the project", keys: ["Mod+Shift+O"], command: "project-symbols" },
          { label: "Resume the last file search", keys: ["Alt+R"], command: "resume-picker" },
          { label: "Shortcuts and commands", keys: ["?"], note: "Outside text fields and files" },
        ],
      },
      {
        title: "Changes",
        entries: [
          { label: "Find in changes", keys: ["/", "Mod+F"], command: "find" },
          { label: "Next / previous match", keys: ["n", "N"], note: "After a find" },
          { label: "Next / previous hunk", keys: ["]", "["] },
          { label: "Add a note to selected lines", keys: ["c"], command: "note" },
          { label: "Save the note", keys: ["Mod+Enter"], note: "In the note editor" },
          { label: "Close find and clear the selection", keys: ["Esc"] },
        ],
      },
      {
        title: "Brief",
        description: "An agent's explanation of the changes, with links to the cited lines.",
        entries: [
          {
            label: "Paste a brief",
            keys: ["Mod+V"],
            note: "Outside text fields; live changes are saved as a review first",
            command: "paste-brief",
          },
          { label: "Next / previous excerpt", keys: ["]", "["], note: "In the brief" },
          { label: "Add a note to selected excerpt lines", keys: ["c"], note: "In the brief" },
          { label: "Open the cited lines", keys: ["Enter"], note: "On a link or an excerpt" },
        ],
      },
      {
        title: "Commit",
        description: "Stage files, commit them, and push the branch, as in lazygit.",
        entries: [
          {
            label: "Open or close the Commit tab",
            keys: ["q"],
            note: "Live changes, outside text fields and files",
            command: "commit",
          },
          {
            label: "Next / previous file",
            keys: ["j", "k"],
            note: "In the Commit tab; the diffs scroll with it",
          },
          { label: "Filter the files", keys: ["/"], note: "Esc clears the filter" },
          { label: "Stage or unstage the file", keys: ["Space"], note: "Or click its mark" },
          { label: "Stage or unstage every file shown", keys: ["a"] },
          { label: "Write the commit message", keys: ["c"], note: "Esc returns to the files" },
          { label: "Commit the staged files", keys: ["Mod+Enter"] },
          {
            label: "Push the branch",
            keys: ["Shift+P"],
            note: "A branch without an upstream asks first",
          },
        ],
      },
      {
        title: "Layout",
        entries: [
          { label: "Toggle the sidebar", keys: ["Mod+B"], command: "sidebar" },
          { label: "Toggle the files sidebar", keys: ["Mod+Shift+B"], command: "browse-files" },
          {
            label: "Zen mode",
            keys: ["Alt+Z"],
            note: "Hides every bar; the sidebar keys still show panels",
            command: "zen",
          },
        ],
      },
      {
        title: "Files and tabs",
        entries: [
          { label: "Close the file", keys: ["Alt+W"], command: "close-file" },
          { label: "Close all files", keys: ["Alt+Shift+W"], command: "close-files" },
          { label: "Close other files", keys: ["Alt+Shift+O"], command: "close-others" },
          { label: "Keep a preview tab open", keys: ["Alt+P"], command: "pin-file" },
          { label: "Toggle Git blame", keys: ["Alt+B"], command: "blame" },
          { label: "Toggle Markdown preview", keys: ["Mod+Shift+V"], note: "Markdown files" },
          { label: "Save the file", keys: ["Mod+S"], note: "Editor" },
        ],
      },
      {
        title: "Lists and panels",
        entries: [
          { label: "Previous / next commit", keys: ["Up", "Down"], note: "In History" },
          { label: "Extend the commit range", keys: ["Shift+Up", "Shift+Down"] },
          { label: "Resize the sidebar", keys: ["Left", "Right"], note: "On the sidebar edge" },
          { label: "Close a branch tab", keys: ["Backspace"], note: "On a focused branch tab" },
        ],
      },
      {
        title: "Pointer",
        entries: [
          {
            label: "Open a file in the background",
            keys: ["Mod+Click"],
            note: "On a changed file name",
          },
          { label: "Extend a line selection", keys: ["Shift+Click"], note: "Line numbers" },
          { label: "Select a range of commits", keys: ["Shift+Click"], note: "In History" },
        ],
      },
    ],
  },
  {
    id: "file",
    label: "File",
    description: "Med's Vim navigation for read-only files. Turn it off in the palette.",
    groups: [
      {
        title: "Move",
        entries: [
          { label: "Left, down, up, right", keys: ["h", "j", "k", "l"] },
          { label: "Next word, previous word, word end", keys: ["w", "b", "e"] },
          { label: "Line start, first character, line end", keys: ["0", "^", "$"] },
          { label: "Line end, without inserting", keys: ["A"] },
          { label: "First / last line", keys: ["g g", "G"], note: "With a count: line number" },
          { label: "Go to a line", keys: [": {line} Enter"], command: "vim-line-jump" },
          { label: "Previous / next paragraph", keys: ["{", "}"] },
          { label: "Repeat a motion", keys: ["{count} {motion}"], note: "For example 5 j" },
        ],
      },
      {
        title: "Scroll",
        entries: [
          {
            label: "Half page down / up",
            keys: ["Ctrl+D", "Ctrl+U"],
            note: "Control on every platform",
          },
          { label: "Center the cursor line", keys: ["z z"], command: "vim-center" },
          { label: "Cursor line to top / bottom", keys: ["z t", "z b"] },
        ],
      },
      {
        title: "Search",
        entries: [
          { label: "Search forward / backward", keys: ["/", "?"], note: "Mod+F also searches" },
          { label: "Next / previous match", keys: ["n", "N"] },
          { label: "Search for the word at the cursor", keys: ["*", "#"] },
          { label: "Go to definition", keys: ["g d"], command: "vim-definition" },
        ],
      },
      {
        title: "Find in line",
        entries: [
          { label: "To a character", keys: ["f {char}", "F {char}"] },
          { label: "Before / after a character", keys: ["t {char}", "T {char}"] },
          { label: "Repeat / reverse", keys: [";", ","] },
        ],
      },
      {
        title: "Marks and jumps",
        entries: [
          { label: "Set a mark", keys: ["m {a–z}"] },
          { label: "Jump to a mark's line / position", keys: ["' {a–z}", "` {a–z}"] },
          { label: "Back to the previous jump", keys: ["' '", "` `"], note: "Repeat to swap" },
        ],
      },
      {
        title: "Select and copy",
        entries: [
          { label: "Select characters / lines", keys: ["v", "V"] },
          { label: "Move the other end", keys: ["o"], note: "In a selection" },
          { label: "Copy the selection", keys: ["y", "Mod+C"] },
          { label: "Clear the selection and highlights", keys: ["Esc"] },
        ],
      },
      {
        title: "Text objects",
        description: "After v: i selects inside, a includes the surroundings. Repeat to grow.",
        entries: [
          { label: "Word / WORD", keys: ["v i w", "v a W"] },
          { label: "Paragraph", keys: ["v i p"] },
          { label: "Quotes", keys: ['v i "', "v a '", "v i `"] },
          { label: "Parentheses, brackets, braces", keys: ["v i (", "v a [", "v i {"] },
          { label: "Two words around the cursor", keys: ["v 2 a w"] },
        ],
      },
    ],
  },
  {
    id: "editor",
    label: "Editor",
    description: "Writable files open in a Vim editor. Med adds saving and navigation.",
    groups: [
      {
        title: "Modes",
        entries: [
          { label: "Insert before / after the cursor", keys: ["i", "a"] },
          { label: "Insert at line start / end", keys: ["I", "A"] },
          { label: "Open a line below / above", keys: ["o", "O"] },
          { label: "Replace characters", keys: ["R"] },
          { label: "Select characters / lines / a block", keys: ["v", "V", "Ctrl+V"] },
          { label: "Back to Normal mode", keys: ["Esc"] },
        ],
      },
      {
        title: "Edit",
        entries: [
          {
            label: "Delete, change, copy",
            keys: ["d", "c", "y"],
            note: "Then a motion or text object: d w, c i w",
          },
          { label: "The whole line", keys: ["d d", "c c", "y y"] },
          { label: "Paste after / before", keys: ["p", "P"] },
          { label: "Delete a character", keys: ["x"] },
          { label: "Repeat the last change", keys: ["."] },
          { label: "Undo / redo", keys: ["u", "Ctrl+R"] },
          { label: "Indent / outdent the line", keys: ["> >", "< <"] },
          { label: "Change inside quotes", keys: ['c i "'], note: "Any text object works" },
        ],
      },
      {
        title: "Save and close",
        entries: [
          { label: "Save", keys: ["Mod+S", ": w Enter"], note: "Never stages or commits" },
          { label: "Close", keys: [": q Enter"], note: "Asks before discarding changes" },
          { label: "Save and close", keys: [": w q Enter"] },
        ],
      },
      {
        title: "Move and scroll",
        entries: [
          { label: "WORD motions", keys: ["W", "B", "E"] },
          { label: "Matching bracket", keys: ["%"] },
          { label: "Top / middle / bottom of the view", keys: ["H", "M", "L"] },
          {
            label: "Page down / up",
            keys: ["Ctrl+F", "Ctrl+B"],
            note: mac ? "⌘ shortcuts stay with Med" : "Ctrl+F and Ctrl+B run Med shortcuts",
          },
          { label: "Half page down / up", keys: ["Ctrl+D", "Ctrl+U"] },
          {
            label: "Jump back / forward",
            keys: ["Ctrl+O", "Ctrl+I"],
            note: mac ? undefined : "Ctrl+O opens symbols",
          },
          { label: "Cursor line to center / top / bottom", keys: ["z z", "z t", "z b"] },
        ],
      },
      {
        title: "Search",
        entries: [
          { label: "Search forward / backward", keys: ["/", "?"] },
          { label: "Next / previous match", keys: ["n", "N"] },
          { label: "Search for the word at the cursor", keys: ["*", "#"] },
          { label: "Go to definition", keys: ["g d"], note: "Med's declaration search" },
        ],
      },
    ],
  },
  {
    id: "pickers",
    label: "Pickers",
    description: "Command palette, file and content search, symbols, and themes.",
    groups: [
      {
        title: "Find file",
        entries: [
          { label: "Search a repository", keys: ["Tab"], note: "After typing part of its name" },
          { label: "Back to this repository", keys: ["Backspace"], note: "With an empty query" },
          { label: "Code, tests, or docs", keys: ["type:code", "type:tests"], syntax: true },
          { label: "File extensions", keys: ["ext:java,kt"], syntax: true },
          { label: "Open at a line", keys: ["App.tsx:42"], syntax: true },
          { label: "Open the file", keys: ["Enter"] },
        ],
      },
      {
        title: "Lists",
        entries: [
          { label: "Move and preview", keys: ["Up", "Down"] },
          { label: "Run or open", keys: ["Enter"] },
          {
            label: "Close and restore",
            keys: ["Esc"],
            note: "Symbols and themes undo the preview",
          },
        ],
      },
      {
        title: "Searches",
        entries: [
          {
            label: "Search file contents",
            keys: ["Mod+Shift+F"],
            note: "Committed text; Enter opens at the line",
            command: "content-search",
          },
          { label: "Resume the last search", keys: ["Alt+R"], command: "resume-picker" },
        ],
      },
    ],
  },
];
