import type { Kit } from "../../author";

/**
 * The Time Machine, Heinemann, 1895: buckram cloth stamped in purple-grey
 * with the title, the sphinx and the author. The stamping is pressed into
 * the cloth, so the light finds its edges; the weave covers everything and
 * the board's edges are worn round. Nothing moves: it is cloth and ink.
 */
export default function recipe(kit: Kit) {
  // The stamp is darker than the cloth around it; the weave's own speckle
  // stays under the threshold.
  kit.run([
    kit.cover,
    "-colorspace",
    "Gray",
    "(",
    "+clone",
    "-blur",
    "0x6",
    ")",
    "+swap",
    "-compose",
    "Minus_Src",
    "-composite",
    "-blur",
    "0x0.8",
    "-level",
    "3%,9%",
    kit.work + "/darker.png",
  ]);
  const stamp = kit.blur("stamp", kit.work + "/darker.png", 0.6);
  const board = kit.svg("board");
  const relief = kit.math("relief", [board, stamp], "u*0.6 - v*0.22");
  const depth = kit.math("depth", [stamp], "1 - u*0.5");
  kit.write({ depth: [depth, relief] });
}
