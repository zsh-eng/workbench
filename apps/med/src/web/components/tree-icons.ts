import type { FileTreeIcons } from "@pierre/trees";

// File icons that Pierre's built-in set lacks, drawn on its 16-pixel grid with
// the same filled shapes. Colors use Pierre's icon palette, as built-in icons do.
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="med-java" viewBox="0 0 16 16">
    <g style="color: var(--trees-file-icon-color, var(--trees-icon-orange))">
      <path fill="currentColor" d="M2.6 7.5h8.8a.4.4 0 0 1 .4.4v2.35A3.75 3.75 0 0 1 8.05 14h-2.1A3.75 3.75 0 0 1 2.2 10.25V7.9a.4.4 0 0 1 .4-.4" opacity=".85"/>
      <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" d="M12 8.6h.6a1.55 1.55 0 0 1 0 3.1h-1.1"/>
      <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" d="M5.6 5.9c-.85-.8.85-1.5 0-2.5M8.4 5.9c-.85-.8.85-1.5 0-2.5" opacity=".7"/>
    </g>
  </symbol>
</svg>`;

/** Pierre's complete colored set, plus Med's additions. */
export const treeIcons: FileTreeIcons = {
  set: "complete",
  colored: true,
  spriteSheet: sprite,
  byFileExtension: { java: "med-java" },
};
