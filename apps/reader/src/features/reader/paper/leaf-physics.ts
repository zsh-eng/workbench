/**
 * A turning leaf, simulated: book paper you can hold, let go of and catch.
 *
 * The leaf is seen from the foot of the book, as a strip of short segments
 * hinged at the spine (node 0). Like paper it bends but does not stretch:
 * bending is an explicit force from each joint's turning angle, and length
 * is kept by projecting the segments back to their rest length. Gravity,
 * air drag and the stacks on either side of the spine do the rest, so a
 * released page falls back or falls over and lands softly on an air
 * cushion, and a finger can catch it wherever it is.
 *
 * Units are metres and seconds, for a 12 cm page of 70 g/m² paper. x runs
 * from the spine towards the fore-edge (the right-hand stack is x > 0, the
 * left-hand one x < 0) and z up from the page.
 *
 * On a phone the spine is the screen's left edge, which a thumb rarely
 * reaches, so the hill a released page must cross is moved towards the
 * thumb by leaning gravity: `tilt` leans it towards the left-hand stack.
 */

export const LEAF_NODES = 24;
export const LEAF_WIDTH = 0.12;
export const LEAF_SEGMENT = LEAF_WIDTH / LEAF_NODES;
/** Simulation step: bending this stiff needs a short one. */
const STEP = 1.6e-4;
/** Bending stiffness of book paper, N·m per metre of page height. */
const BENDING = 3e-4;
/** 70 g/m². */
const DENSITY = 0.07;
const GRAVITY = 9.81;
const AIR = 0.5 * 1.2 * 1.2;
const DAMPING = 1.2;
/**
 * Paper is not a spring: held in a curl, its fibres take a set, so a
 * released curl relaxes rather than snapping open. Each joint's rest angle
 * creeps towards its bend while the page is held, and back to flat once it
 * is let go; seconds.
 */
const SET_WHILE_HELD = 0.08;
const SET_RELEASED = 0.15;
/** How far a turned-over part rides above the page it lies on. */
export const LEAF_SELF_GAP = 0.0004;
/** The air cushion that softens a landing works within this height. */
const CUSHION = 0.004;
/** Below this the leaf counts as lying on a stack. */
const LANDED = 0.0007;

export type LeafSide = "right" | "left";

interface Hold {
  node: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** The leaf's direction at the held node; NaN leaves it free to turn. */
  fromAngle: number;
  toAngle: number;
}

export class Leaf {
  readonly x = new Float64Array(LEAF_NODES + 1);
  readonly z = new Float64Array(LEAF_NODES + 1);
  readonly vx = new Float64Array(LEAF_NODES + 1);
  readonly vz = new Float64Array(LEAF_NODES + 1);
  private readonly fx = new Float64Array(LEAF_NODES + 1);
  private readonly fz = new Float64Array(LEAF_NODES + 1);
  private readonly px = new Float64Array(LEAF_NODES + 1);
  private readonly pz = new Float64Array(LEAF_NODES + 1);
  private readonly mass = new Float64Array(LEAF_NODES + 1);
  /** Each joint's rest angle: the set the paper has taken. */
  private readonly rest = new Float64Array(LEAF_NODES + 1);
  private readonly setHeld = 1 - Math.exp(-STEP / SET_WHILE_HELD);
  private readonly setReleased = 1 - Math.exp(-STEP / SET_RELEASED);
  /** Radians; positive leans gravity towards the left-hand stack. */
  tilt = 0;
  private hold: Hold | null = null;

  constructor(side: LeafSide) {
    for (let index = 0; index <= LEAF_NODES; index++) {
      this.mass[index] =
        DENSITY * LEAF_SEGMENT * (index === LEAF_NODES ? 0.5 : 1);
    }
    this.lay(side);
  }

  /** Lays the leaf flat on one stack, at rest. */
  lay(side: LeafSide): void {
    const sign = side === "right" ? 1 : -1;
    for (let index = 0; index <= LEAF_NODES; index++) {
      this.x[index] = sign * index * LEAF_SEGMENT;
      this.z[index] = 0;
      this.vx[index] = 0;
      this.vz[index] = 0;
      this.rest[index] = 0;
    }
    this.hold = null;
  }

  copyFrom(other: Leaf): void {
    this.x.set(other.x);
    this.z.set(other.z);
    this.vx.set(other.vx);
    this.vz.set(other.vz);
    this.rest.set(other.rest);
    this.tilt = other.tilt;
    this.hold = other.hold ? { ...other.hold } : null;
  }

  get held(): boolean {
    return this.hold !== null;
  }

  /**
   * Holds one node and carries it to a target over the next `advance`. With
   * `angle`, the leaf is pinched there and points that way. A target out of
   * the leaf's reach is brought within it.
   */
  holdAt(node: number, targetX: number, targetZ: number, angle = NaN): void {
    const reach = node * LEAF_SEGMENT * 0.995;
    const distance = Math.hypot(targetX, targetZ);
    const scale = distance > reach ? reach / distance : 1;
    const toX = targetX * scale;
    const toZ = Math.max(0, targetZ * scale);
    const hold = this.hold;
    if (hold && hold.node === node) {
      hold.toX = toX;
      hold.toZ = toZ;
      if (Number.isNaN(hold.toAngle)) hold.fromAngle = this.direction(node);
      hold.toAngle = angle;
      return;
    }
    this.hold = {
      node,
      fromX: this.x[node]!,
      fromZ: this.z[node]!,
      toX,
      toZ,
      fromAngle: this.direction(node),
      toAngle: angle,
    };
  }

  /** Lets go; the leaf keeps the speed it had. */
  release(): void {
    this.hold = null;
  }

  /** Spins the leaf about the spine, as a flick does; radians a second. */
  spin(angularVelocity: number): void {
    for (let index = 1; index <= LEAF_NODES; index++) {
      this.vx[index]! -= angularVelocity * this.z[index]!;
      this.vz[index]! += angularVelocity * this.x[index]!;
    }
  }

  /** Runs the simulation forward; a held node follows its target smoothly. */
  advance(seconds: number): void {
    const steps = Math.max(1, Math.round(seconds / STEP));
    const hold = this.hold;
    for (let step = 1; step <= steps; step++) {
      if (!hold) {
        this.step(-1, 0, 0, NaN);
        continue;
      }
      const t = step / steps;
      this.step(
        hold.node,
        hold.fromX + (hold.toX - hold.fromX) * t,
        hold.fromZ + (hold.toZ - hold.fromZ) * t,
        Number.isNaN(hold.toAngle)
          ? NaN
          : hold.fromAngle + (hold.toAngle - hold.fromAngle) * t,
      );
    }
    if (hold) {
      hold.fromX = hold.toX;
      hold.fromZ = hold.toZ;
      hold.fromAngle = hold.toAngle;
    }
  }

  private direction(node: number): number {
    return Math.atan2(
      this.z[node]! - this.z[node - 1]!,
      this.x[node]! - this.x[node - 1]!,
    );
  }

  private forces(): void {
    const { x, z, fx, fz, vx, vz, mass } = this;
    fx.fill(0);
    fz.fill(0);
    const gravityX = -GRAVITY * Math.sin(this.tilt);
    const gravityZ = -GRAVITY * Math.cos(this.tilt);
    for (let index = 1; index <= LEAF_NODES; index++) {
      fx[index]! += mass[index]! * gravityX;
      fz[index]! += mass[index]! * gravityZ;
    }
    // Bending: each joint resists its turning angle.
    const stiffness = BENDING / LEAF_SEGMENT;
    for (let index = 1; index < LEAF_NODES; index++) {
      const e1x = x[index]! - x[index - 1]!;
      const e1z = z[index]! - z[index - 1]!;
      const e2x = x[index + 1]! - x[index]!;
      const e2z = z[index + 1]! - z[index]!;
      const angle = Math.atan2(e1x * e2z - e1z * e2x, e1x * e2x + e1z * e2z);
      const l1 = e1x * e1x + e1z * e1z;
      const l2 = e2x * e2x + e2z * e2z;
      const ax = -e1z / l1;
      const az = e1x / l1;
      const cx = -e2z / l2;
      const cz = e2x / l2;
      const settle = this.held ? this.setHeld : this.setReleased;
      const rest = this.rest[index]!;
      this.rest[index] = rest + ((this.held ? angle : 0) - rest) * settle;
      const torque = -stiffness * (angle - rest);
      fx[index - 1]! += torque * ax;
      fz[index - 1]! += torque * az;
      fx[index + 1]! += torque * cx;
      fz[index + 1]! += torque * cz;
      fx[index]! -= torque * (ax + cx);
      fz[index]! -= torque * (az + cz);
    }
    // Air resists the leaf's motion across itself.
    const air = AIR * LEAF_SEGMENT;
    for (let index = 1; index <= LEAF_NODES; index++) {
      const after = Math.min(LEAF_NODES, index + 1);
      let tx = x[after]! - x[index - 1]!;
      let tz = z[after]! - z[index - 1]!;
      const length = Math.hypot(tx, tz) || 1;
      tx /= length;
      tz /= length;
      const across = -vx[index]! * tz + vz[index]! * tx;
      const force =
        -air * Math.abs(across) * across * (index === LEAF_NODES ? 0.5 : 1);
      fx[index]! -= force * tz;
      fz[index]! += force * tx;
    }
  }

  private step(
    heldNode: number,
    holdX: number,
    holdZ: number,
    holdAngle: number,
  ): void {
    const { x, z, vx, vz, px, pz, fx, fz, mass } = this;
    this.forces();
    const keep = Math.exp(-DAMPING * STEP);
    for (let index = 1; index <= LEAF_NODES; index++) {
      vx[index] = (vx[index]! + (STEP * fx[index]!) / mass[index]!) * keep;
      vz[index] = (vz[index]! + (STEP * fz[index]!) / mass[index]!) * keep;
      px[index] = x[index]! + STEP * vx[index]!;
      pz[index] = z[index]! + STEP * vz[index]!;
    }
    px[0] = 0;
    pz[0] = 0;
    if (heldNode > 0) {
      px[heldNode]! += (holdX - px[heldNode]!) * 0.35;
      pz[heldNode]! += (holdZ - pz[heldNode]!) * 0.35;
      if (heldNode > 1 && !Number.isNaN(holdAngle)) {
        const before = heldNode - 1;
        const bx = holdX - LEAF_SEGMENT * Math.cos(holdAngle);
        const bz = holdZ - LEAF_SEGMENT * Math.sin(holdAngle);
        px[before]! += (bx - px[before]!) * 0.35;
        pz[before]! += (bz - pz[before]!) * 0.35;
      }
    }
    // Where the leaf has turned back over itself, it rides on its own page.
    let over = LEAF_NODES + 1;
    for (let index = 1; index < LEAF_NODES; index++) {
      if (x[index + 1]! < x[index]! && x[index]! > 0) {
        over = index + 1;
        break;
      }
    }
    for (let iteration = 0; iteration < 6; iteration++) {
      for (let index = 0; index < LEAF_NODES; index++) {
        const dx = px[index + 1]! - px[index]!;
        const dz = pz[index + 1]! - pz[index]!;
        const distance = Math.hypot(dx, dz) || 1e-9;
        const wa = index === 0 ? 0 : 1;
        const wb = index + 1 === heldNode ? 0.25 : 1;
        const c = (distance - LEAF_SEGMENT) / distance / (wa + wb);
        px[index]! += wa * c * dx;
        pz[index]! += wa * c * dz;
        px[index + 1]! -= wb * c * dx;
        pz[index + 1]! -= wb * c * dz;
      }
      for (let index = 1; index <= LEAF_NODES; index++) {
        const floor = index >= over && px[index]! > 0 ? LEAF_SELF_GAP : 0;
        if (pz[index]! < floor) pz[index] = floor;
      }
    }
    for (let index = 1; index <= LEAF_NODES; index++) {
      vx[index] = (px[index]! - x[index]!) / STEP;
      vz[index] = (pz[index]! - z[index]!) / STEP;
    }
    for (let index = 1; index <= LEAF_NODES; index++) {
      if (pz[index]! < CUSHION && vz[index]! < 0) {
        vz[index]! *= Math.exp(-STEP * 40 * (1 - pz[index]! / CUSHION));
      }
      x[index] = px[index]!;
      z[index] = pz[index]!;
    }
  }

  maxSpeed(): number {
    let fastest = 0;
    for (let index = 1; index <= LEAF_NODES; index++) {
      fastest = Math.max(fastest, Math.hypot(this.vx[index]!, this.vz[index]!));
    }
    return fastest;
  }

  /** The furthest the leaf reaches over the right-hand stack. */
  reach(): number {
    let furthest = 0;
    for (let index = 1; index <= LEAF_NODES; index++) {
      furthest = Math.max(furthest, this.x[index]!);
    }
    return furthest;
  }

  /** Angle of the leaf's centre from the right-hand stack, 0 to π. */
  angle(): number {
    let sx = 0;
    let sz = 0;
    for (let index = 1; index <= LEAF_NODES; index++) {
      sx += this.x[index]!;
      sz += this.z[index]!;
    }
    return Math.atan2(sz, sx);
  }

  /**
   * How fast the leaf swings about the spine, radians a second, positive
   * towards the left-hand stack.
   */
  swing(): number {
    let moment = 0;
    let inertia = 0;
    for (let index = 1; index <= LEAF_NODES; index++) {
      const x = this.x[index]!;
      const z = this.z[index]!;
      moment += x * this.vz[index]! - z * this.vx[index]!;
      inertia += x * x + z * z;
    }
    return inertia > 0 ? moment / inertia : 0;
  }

  /** Whether the leaf has gone over to the left and is not coming back. */
  goneLeft(): boolean {
    return this.reach() <= 0 && this.swing() > -0.5;
  }

  /** Whether the leaf has come down flat on the right-hand stack. */
  landedRight(): boolean {
    if (this.hold || this.maxSpeed() > 0.05) return false;
    for (let index = 1; index <= LEAF_NODES; index++) {
      if (this.z[index]! > LANDED || this.x[index]! < 0) return false;
    }
    return true;
  }

  /**
   * Arc length from the spine to where the leaf leaves the right-hand
   * stack; before it, the leaf lies flat.
   */
  liftLine(): number {
    for (let index = 1; index <= LEAF_NODES; index++) {
      if (this.z[index]! > 0.0002 || this.x[index]! < this.x[index - 1]!) {
        return (index - 1) * LEAF_SEGMENT;
      }
    }
    return LEAF_WIDTH;
  }

  /**
   * Where the leaf will come down if nothing touches it, found by running
   * a copy forward; `lean` sets the copy's tilt each step, as the caller's
   * gravity would.
   */
  predict(lean?: (leaf: Leaf) => void): LeafSide {
    const copy = new Leaf("right");
    copy.copyFrom(this);
    copy.release();
    for (let elapsed = 0; elapsed < 1.2; elapsed += 1 / 30) {
      lean?.(copy);
      copy.advance(1 / 30);
      if (copy.goneLeft()) return "left";
      if (copy.landedRight()) return "right";
    }
    return copy.angle() > Math.PI / 2 ? "left" : "right";
  }
}

/** Cross-section point at arc length `s`, extrapolating past either end. */
export function sampleLeaf(
  x: ArrayLike<number>,
  z: ArrayLike<number>,
  s: number,
): [number, number] {
  if (s <= 0) return [s, 0];
  const f = s / LEAF_SEGMENT;
  if (f >= LEAF_NODES) {
    const tx = x[LEAF_NODES]! - x[LEAF_NODES - 1]!;
    const tz = z[LEAF_NODES]! - z[LEAF_NODES - 1]!;
    const beyond = f - LEAF_NODES;
    return [x[LEAF_NODES]! + tx * beyond, z[LEAF_NODES]! + tz * beyond];
  }
  const index = Math.floor(f);
  const t = f - index;
  return [
    x[index]! + (x[index + 1]! - x[index]!) * t,
    z[index]! + (z[index + 1]! - z[index]!) * t,
  ];
}

/**
 * Where a hand carries a point of a page it turns, `arc` from the spine
 * (the edge, by default): up round a roll of `radius` whose crease is at
 * `crease`, then over and down towards the page, edge first, as a
 * turned-over leaf settles onto the one below. Returns the point's x, z and
 * the direction the leaf points there.
 */
export function carriedEdge(
  crease: number,
  radius: number,
  arc = LEAF_WIDTH,
): [number, number, number] {
  const past = arc - crease;
  if (past <= 0) return [arc, 0, 0];
  if (past < Math.PI * radius) {
    const turned = past / radius;
    return [
      crease + radius * Math.sin(turned),
      radius * (1 - Math.cos(turned)),
      turned,
    ];
  }
  const over = past - Math.PI * radius;
  const settle = Math.exp(-over / (2 * radius));
  return [
    crease - over,
    2 * radius * (0.12 + 0.88 * settle),
    Math.PI + 0.6 * (1 - settle) * settle,
  ];
}

/** The crease that carries the point `arc` from the spine to `x`, from above. */
export function creaseUnder(
  x: number,
  radius: number,
  arc = LEAF_WIDTH,
): number {
  let low = -2 * LEAF_WIDTH;
  let high = arc;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (carriedEdge(middle, radius, arc)[0] > x) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}
