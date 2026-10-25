import type { Kit } from "../../author";

/**
 * Alice's Adventures in Wonderland: a coloured plate set into a cloth
 * board. The plate is a window: the garden recedes behind its dark frame,
 * the Duchess and Alice stand nearest. The board carries the weave and the
 * title is printed into it. A glint at the Duchess's crown.
 */
export default function recipe(kit: Kit) {
  const plate = kit.svg("plate");
  const ink = kit.fx("ink", "min(1,max(0,(0.42-(r+g+b)/3)/0.15))");
  const outside = kit.math("outside", [plate], "u>0.97 ? 1 : 0");
  const type = kit.blur(
    "type",
    kit.math("type-raw", [ink, outside], "u*v"),
    0.6,
  );
  const relief = kit.math("relief", [plate, type], "0.3 + u*0.3 - v*0.12");
  kit.write({ depth: [plate, relief] });
}
