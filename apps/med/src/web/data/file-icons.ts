import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import { medIconColor, medSprite, treeIcons, type IconColor } from "../components/tree-icons";

// The file tree's own icon for a file, outside the tree: a tab's language
// icon, in the tree's colours (Pierre's icon palette, by its tokens).
const resolver = createFileTreeIconResolver(treeIcons);
const PALETTE: Record<IconColor, string> = {
  blue: "light-dark(#1a85d4, #69b1ff)",
  cyan: "light-dark(#1ca1c7, #68cdf2)",
  gray: "light-dark(#84848a, #adadb1)",
  green: "light-dark(#199f43, #5ecc71)",
  indigo: "light-dark(#693acf, #9d6afb)",
  mauve: "light-dark(#594c5b, #79697b)",
  orange: "light-dark(#d47628, #ffa359)",
  pink: "light-dark(#d32a61, #ff678d)",
  purple: "light-dark(#a631be, #d568ea)",
  red: "light-dark(#d52c36, #ff6762)",
  teal: "light-dark(#17a5af, #64d1db)",
  vermilion: "light-dark(#ff8c5b, #d5512f)",
  yellow: "light-dark(#d5a910, #ffd452)",
};
const TOKENS: Record<IconColor, string> = {
  blue: "biome c cpp docker python typescript vscode webpack",
  cyan: "go oxc react tailwind",
  gray: "default text",
  green: "bash markdown svgo vue",
  indigo: "bootstrap css eslint terraform wasm",
  mauve: "bun",
  orange: "claude html json rust svg swift zig zip",
  pink: "graphql image sass",
  purple: "astro database vite",
  red: "npm postcss ruby svelte yml",
  teal: "mcp prettier table",
  vermilion: "git",
  yellow: "babel browserslist javascript",
};
const COLOR = new Map(
  Object.entries(TOKENS).flatMap(([color, tokens]) =>
    tokens.split(" ").map((token) => [token, PALETTE[color as IconColor]] as const),
  ),
);

// The sprites, once, for the icons' <use>; the tree has its own copy inside it.
let sprites = false;
export function addFileIconSprites() {
  if (sprites || typeof document === "undefined") return;
  sprites = true;
  const box = document.createElement("div");
  box.hidden = true;
  box.dataset.fileIcons = "";
  box.innerHTML = getBuiltInSpriteSheet("complete") + medSprite;
  document.body.append(box);
}

/** A file's icon as the tree draws it: its symbol, and its colour. */
export function fileIcon(path: string) {
  addFileIconSprites();
  const icon = resolver.resolveIcon("file-tree-icon-file", path.split("/").at(-1));
  const own = medIconColor.get(icon.name);
  const color = own ? PALETTE[own] : (COLOR.get(icon.token ?? "") ?? PALETTE.gray);
  return { name: icon.name, viewBox: icon.viewBox ?? "0 0 16 16", color };
}

/** The icon as HTML, for links that rendered Markdown holds. */
export function fileIconHtml(path: string, className: string) {
  const { name, viewBox, color } = fileIcon(path);
  return (
    `<svg class="${className}" aria-hidden="true" viewBox="${viewBox}"` +
    ` style="color:${color};--trees-file-icon-color:${color}"><use href="#${name}"></use></svg>`
  );
}
