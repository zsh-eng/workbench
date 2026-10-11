import { Rating, State, type ReviewLog } from "ts-fsrs";

export type SampleReviewLog = ReviewLog & { duration: number };

/** A small seeded generator, so each state draws the same charts. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(
  random: () => number,
  weighted: readonly (readonly [T, number])[],
) {
  let roll = random();
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

const RATINGS = [
  [Rating.Again, 0.1],
  [Rating.Hard, 0.14],
  [Rating.Good, 0.62],
  [Rating.Easy, 0.14],
] as const;

const STATES = [
  [State.New, 0.18],
  [State.Learning, 0.14],
  [State.Review, 0.62],
  [State.Relearning, 0.06],
] as const;

// Most reviews happen on the way to work and in the evening.
const HOURS = [
  [7, 0.12],
  [8, 0.16],
  [12, 0.1],
  [18, 0.1],
  [20, 0.18],
  [21, 0.2],
  [22, 0.14],
] as const;

/**
 * Review history for the last `days` days, ending now: some rest days, more
 * reviews on weekends, and today's reviews in the past.
 */
export function sampleReviewLogs(days: number, now = Date.now()) {
  const random = seeded(days * 7919);
  const logs: SampleReviewLog[] = [];
  for (let back = days - 1; back >= 0; back--) {
    if (back > 0 && random() < 0.16) continue;
    const day = new Date(now);
    day.setDate(day.getDate() - back);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const count = 4 + Math.floor(random() * (weekend ? 34 : 22));
    for (let index = 0; index < count; index++) {
      const review = new Date(day);
      review.setHours(pick(random, HOURS), Math.floor(random() * 60), 0, 0);
      if (review.getTime() > now) review.setTime(now - (index + 1) * 90 * 1000);
      logs.push({
        rating: pick(random, RATINGS),
        state: pick(random, STATES),
        due: review,
        stability: 1 + random() * 30,
        difficulty: 3 + random() * 5,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
        review,
        duration: 3000 + Math.floor(random() * 30000),
      });
    }
  }
  return logs;
}
