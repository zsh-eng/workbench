/**
 * FSRS-6 weights refitted locally on 9 November 2026 with fsrs-optimizer 6.5.0.
 * Grades are used as recorded (Hard = recalled with effort, per the user);
 * see docs/FSRS_OPTIMIZATION.md for the held-out check.
 * Active defaults for ts-fsrs 5.4.2.
 */
export const FSRS6_PERSONAL_PARAMETERS = {
  w: [
    0.9811, 36.0372, 34.1467, 36.2352, 6.2087, 1.0955, 3.0722, 0.1613, 2.1501,
    0.4327, 1.0978, 1.5664, 0.0524, 0.441, 1.7096, 0.8456, 1.0, 0.5288,
    0.0643, 0.1047, 0.1001,
  ],
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
} as const;
