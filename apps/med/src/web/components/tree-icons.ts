import type { FileTreeIcons } from "@pierre/trees";

/** Pierre's icon palette, by name; each is light-dark for the theme. */
export type IconColor =
  | "blue"
  | "cyan"
  | "gray"
  | "green"
  | "indigo"
  | "mauve"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "teal"
  | "vermilion"
  | "yellow";

// File icons that Pierre's built-in set lacks, on its 16-pixel grid. Java has
// a drawn mark; the other languages Pierre's highlighter reads have its
// TypeScript badge's shape with their letters. Colors use Pierre's icon
// palette, as built-in icons do.
const JAVA = `
      <path fill="currentColor" d="M2.6 7.5h8.8a.4.4 0 0 1 .4.4v2.35A3.75 3.75 0 0 1 8.05 14h-2.1A3.75 3.75 0 0 1 2.2 10.25V7.9a.4.4 0 0 1 .4-.4" opacity=".85"/>
      <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" d="M12 8.6h.6a1.55 1.55 0 0 1 0 3.1h-1.1"/>
      <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" d="M5.6 5.9c-.85-.8.85-1.5 0-2.5M8.4 5.9c-.85-.8.85-1.5 0-2.5" opacity=".7"/>`;

/** Med's file icons: the extensions or names each covers, its color, and
 * its letters (none for a drawn mark). */
const MED_ICONS: {
  id: string;
  color: IconColor;
  letters?: string;
  extensions?: string[];
  names?: string[];
}[] = [
  { id: "java", color: "orange", extensions: ["java", "jar", "class"] },
  { id: "kotlin", color: "purple", letters: "KT", extensions: ["kt", "kts"] },
  { id: "scala", color: "red", letters: "SC", extensions: ["scala", "sc", "sbt"] },
  { id: "groovy", color: "teal", letters: "GR", extensions: ["groovy", "gradle"] },
  { id: "csharp", color: "indigo", letters: "C#", extensions: ["cs", "csx"] },
  { id: "fsharp", color: "blue", letters: "F#", extensions: ["fs", "fsx", "fsi"] },
  { id: "vb", color: "blue", letters: "VB", extensions: ["vb"] },
  { id: "php", color: "indigo", letters: "PHP", extensions: ["php"] },
  { id: "lua", color: "blue", letters: "LUA", extensions: ["lua"] },
  { id: "r", color: "blue", letters: "R", extensions: ["r", "rmd"] },
  { id: "julia", color: "purple", letters: "JL", extensions: ["jl"] },
  { id: "dart", color: "cyan", letters: "DA", extensions: ["dart"] },
  { id: "elixir", color: "purple", letters: "EX", extensions: ["ex", "exs", "heex"] },
  { id: "erlang", color: "red", letters: "ERL", extensions: ["erl", "hrl"] },
  { id: "gleam", color: "pink", letters: "GL", extensions: ["gleam"] },
  { id: "haskell", color: "indigo", letters: "HS", extensions: ["hs", "lhs"] },
  { id: "ocaml", color: "orange", letters: "ML", extensions: ["ml", "mli"] },
  { id: "elm", color: "cyan", letters: "ELM", extensions: ["elm"] },
  { id: "clojure", color: "green", letters: "CLJ", extensions: ["clj", "cljs", "cljc", "edn"] },
  { id: "perl", color: "indigo", letters: "PL", extensions: ["pl", "pm"] },
  { id: "powershell", color: "blue", letters: "PS", extensions: ["ps1", "psm1"] },
  { id: "nim", color: "yellow", letters: "NIM", extensions: ["nim"] },
  { id: "crystal", color: "gray", letters: "CR", extensions: ["cr"] },
  { id: "solidity", color: "gray", letters: "SOL", extensions: ["sol"] },
  { id: "verilog", color: "teal", letters: "V", extensions: ["sv", "svh"] },
  { id: "asm", color: "red", letters: "ASM", extensions: ["asm", "s"] },
  { id: "toml", color: "gray", letters: "TML", extensions: ["toml"] },
  { id: "xml", color: "orange", letters: "XML", extensions: ["xml", "xsd", "plist"] },
  { id: "proto", color: "teal", letters: "PB", extensions: ["proto"] },
  { id: "prisma", color: "indigo", letters: "PR", extensions: ["prisma"] },
  { id: "hcl", color: "indigo", letters: "HCL", extensions: ["hcl"] },
  { id: "nix", color: "blue", letters: "NIX", extensions: ["nix"] },
  { id: "tex", color: "teal", letters: "TEX", extensions: ["tex", "bib"] },
  { id: "diff", color: "green", letters: "±", extensions: ["diff", "patch"] },
  { id: "pdf", color: "red", letters: "PDF", extensions: ["pdf"] },
  { id: "notebook", color: "orange", letters: "NB", extensions: ["ipynb"] },
  {
    id: "make",
    color: "orange",
    letters: "MK",
    extensions: ["mk"],
    names: ["Makefile", "makefile", "GNUmakefile"],
  },
  { id: "cmake", color: "green", letters: "CM", extensions: ["cmake"], names: ["CMakeLists.txt"] },
  {
    id: "bazel",
    color: "green",
    letters: "BZ",
    extensions: ["bzl", "bazel"],
    names: ["BUILD", "WORKSPACE"],
  },
];

/** The badge's letters, sized so up to three fit its width. */
function letters(text: string) {
  const size = text.length >= 3 ? 4.6 : text.length === 2 ? 5.6 : 7;
  return `
      <path fill="currentColor" d="M8 1C2.24 1 1 2.24 1 8s1.24 7 7 7 7-1.24 7-7-1.24-7-7-7" opacity=".2"/>
      <text x="8" y="8.1" fill="currentColor" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${size}" font-weight="700" letter-spacing="-.2" text-anchor="middle" dominant-baseline="central">${text}</text>`;
}

export const medSprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${MED_ICONS.map(
  (icon) => `
  <symbol id="med-${icon.id}" viewBox="0 0 16 16">
    <g style="color: var(--trees-file-icon-color, var(--trees-icon-${icon.color}))">${icon.letters ? letters(icon.letters) : JAVA}
    </g>
  </symbol>`,
).join("")}
</svg>`;

/** The color of Med's own icon by its symbol's id, as the tree draws it. */
export const medIconColor = new Map(MED_ICONS.map((icon) => [`med-${icon.id}`, icon.color]));

/** Pierre's complete colored set, plus Med's additions. */
export const treeIcons: FileTreeIcons = {
  set: "complete",
  colored: true,
  spriteSheet: medSprite,
  byFileExtension: Object.fromEntries(
    MED_ICONS.flatMap((icon) =>
      (icon.extensions ?? []).map((extension) => [extension, `med-${icon.id}`]),
    ),
  ),
  byFileName: Object.fromEntries(
    MED_ICONS.flatMap((icon) => (icon.names ?? []).map((name) => [name, `med-${icon.id}`])),
  ),
};
