/**
 * Damped springs, as UIKit and SwiftUI describe them, for the web. A spring
 * is a response (the period of one undamped swing, in seconds) and a
 * damping ratio (1 settles without overshoot). The same spring moves a
 * short and a long distance in the same time, and it can start with the
 * speed of a finger. See docs/MOTION.md for the measured references.
 */
export type Spring = {
  /** Seconds for one undamped oscillation, 2π/ω. UIKit's `perceptualDuration`. */
  response: number;
  /** 1 is critical: no overshoot. Below 1 the spring bounces. */
  dampingRatio: number;
};

/**
 * The springs that the apps share. The numbers come from the iOS 27
 * simulator and Telegram for iOS (docs/MOTION.md).
 */
export const SPRINGS = {
  /**
   * UIKit's sheet: presentation, dismissal and detent changes all run one
   * critically damped spring (mass 3, stiffness 1000, damping 500 with
   * overdamping off, so ω = 18.26 rad/s).
   */
  sheet: { response: 0.344, dampingRatio: 1 },
  /** Telegram's iOS 26 curve, a little quicker: stiffness 555, damping 47. */
  snappy: { response: 0.267, dampingRatio: 1 },
  /**
   * A thrown sheet that settles on a detent: Telegram's custom spring
   * (mass 5, stiffness 900, damping 124), which keeps a hint of give.
   */
  release: { response: 0.32, dampingRatio: 0.92 },
  /** Small feedback that pops: pills and counters. */
  pop: { response: 0.32, dampingRatio: 0.72 },
  /**
   * A surface that changes shape, as the Dynamic Island does: it lands with
   * a little give (1.5% overshoot).
   */
  morph: { response: 0.4, dampingRatio: 0.8 },
} as const satisfies Record<string, Spring>;

/**
 * The displacement left, as a share of the distance, `t` seconds after a
 * spring lets go at 1 and heads for 0. `velocity` is the start speed toward
 * the target, in distances per second (a finger at 900 px/s on a 300 px
 * move is 3).
 */
export function springDisplacement(
  { response, dampingRatio }: Spring,
  t: number,
  velocity = 0,
): number {
  const omega = (2 * Math.PI) / response;
  const zeta = dampingRatio;
  // Motion toward the target lowers the displacement.
  const v0 = -velocity;
  if (Math.abs(zeta - 1) < 1e-6) {
    return Math.exp(-omega * t) * (1 + (v0 + omega) * t);
  }
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return (
      Math.exp(-zeta * omega * t) *
      (Math.cos(damped * t) +
        ((v0 + zeta * omega) / damped) * Math.sin(damped * t))
    );
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const fast = -omega * (zeta + root);
  const slow = -omega * (zeta - root);
  const fastShare = (v0 - slow) / (fast - slow);
  return (1 - fastShare) * Math.exp(slow * t) + fastShare * Math.exp(fast * t);
}

/**
 * Seconds until a move of `distance` pixels stays within `threshold`
 * pixels of its target: when it looks still. A longer move takes a little
 * longer, by the logarithm of its length.
 */
export function settleTime(
  spring: Spring,
  distance: number,
  {
    velocity = 0,
    threshold = 0.5,
  }: { velocity?: number; threshold?: number } = {},
): number {
  const limit = threshold / Math.max(Math.abs(distance), threshold);
  const step = 1 / 240;
  let settled = 0;
  for (let t = 0; t < 4; t += step) {
    if (Math.abs(springDisplacement(spring, t, velocity)) > limit)
      settled = t + step;
  }
  return settled;
}

export type SpringCurve = {
  /** Milliseconds until the move looks still. */
  duration: number;
  /** A CSS `linear()` easing that follows the spring over `duration`. */
  easing: string;
  /** Progress from 0 to 1 at even steps of time: WAAPI keyframe offsets. */
  points: number[];
};

/**
 * The spring as a CSS easing for a move of `distance` pixels. Progress can
 * pass 1 when the spring bounces. Safari has `linear()` from 17.2.
 */
export function springCurve(
  spring: Spring,
  distance: number,
  { velocity = 0 }: { velocity?: number } = {},
): SpringCurve {
  const seconds = Math.max(settleTime(spring, distance, { velocity }), 1 / 60);
  // About one point per 120 Hz frame keeps the curve exact on ProMotion.
  const count = Math.max(8, Math.ceil(seconds * 120));
  const points: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * seconds;
    points.push(i === count ? 1 : 1 - springDisplacement(spring, t, velocity));
  }
  return {
    duration: seconds * 1000,
    easing: `linear(${points.map((p) => +p.toFixed(4)).join(", ")})`,
    points,
  };
}

/**
 * The spring as the `motion` library's transition, so a layout change in
 * React moves on the same curve.
 */
export function springTransition({ response, dampingRatio }: Spring) {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  return {
    type: "spring" as const,
    stiffness,
    damping: 2 * dampingRatio * Math.sqrt(stiffness),
    mass: 1,
  };
}
