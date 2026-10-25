import type { Kit } from "../../author";

/**
 * Pride and Prejudice, the 1894 Peacock edition: Hugh Thomson's design
 * blocked in gold on dark green cloth. The gold is keyed from its own colour
 * (yellow over the cloth's green, bright enough to be metal), pressed a
 * little into the cloth, and the board's edge is rounded. No life: gold on
 * cloth should only answer the light.
 */
export default function recipe(kit: Kit) {
  const region = kit.svg("region");
  const key = kit.fx(
    "gold-key",
    "ky=min(1,max(0,((r+g)/2-b-0.06)/0.2)); kl=min(1,max(0,((r+g+b)/3-0.17)/0.25)); kw=max(0,min(1,(r-g+0.06)/0.12)); ky*ky*(3-2*ky)*kl*kl*(3-2*kl)*(0.35+0.65*kw)",
  );
  const foil = kit.math("foil", [key, region], "pow(u,0.7)*v");
  const stamp = kit.blur("stamp", foil, 0.7);
  const board = kit.svg("board");
  // Gold sits a hair below the cloth; the cloth rounds over the board's edge.
  const relief = kit.math("relief", [board, stamp], "u*0.62 - v*0.2");
  const depth = kit.math("depth", [stamp, region], "1 - v*u*0.6");
  kit.write({ depth: [depth, relief], materials: [foil, 0, 0] });
}
