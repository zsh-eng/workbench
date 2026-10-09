/**
 * One motion vocabulary for the app's floating surfaces and the Reader's
 * chrome. Surfaces animate only opacity and transform; they leave faster than
 * they arrive, so the page stays primary. Use these instead of local durations
 * and curves.
 */

/** Settles quickly; for anything that appears. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** The reading chrome's slide: a long, soft landing. */
const EASE_CHROME = [0.16, 1, 0.3, 1] as const;
/** Accelerates away; for the chrome leaving. */
const EASE_CHROME_EXIT = [0.32, 0, 0.67, 0] as const;

export const MOTION = {
  /** Floating surfaces appear: the Notes Island, notebook, composer, toolbars. */
  enter: { duration: 0.18, ease: EASE_OUT },
  /** Floating surfaces leave. */
  exit: { duration: 0.14, ease: "easeIn" },
  /** The Notes Island changes shape in place. */
  shape: { duration: 0.26, ease: EASE_OUT },
  /** Phone header and footer slide with the reading chrome. */
  chromeEnter: { duration: 0.26, ease: EASE_CHROME },
  chromeExit: { duration: 0.18, ease: EASE_CHROME_EXIT },
  chromeFadeIn: { duration: 0.18, ease: "easeOut" },
  chromeFadeOut: { duration: 0.14, ease: "easeIn" },
  /** Desktop chrome fades in place. */
  desktopChromeFade: { duration: 0.16, ease: EASE_OUT },
} as const;

/** Durations for surfaces that transition with CSS. */
export const MOTION_MS = {
  enter: MOTION.enter.duration * 1000,
  exit: MOTION.exit.duration * 1000,
} as const;
