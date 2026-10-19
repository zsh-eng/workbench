import { useHoldSignals } from "./use-hold-at-page-edge";

/**
 * What the page hears while a selection is dragged, newest first, for
 * checking "Hold at the edge" on a phone (`?selectAcross=hold&selectAcrossLog=1`).
 */
export function HoldSignalLog() {
  const signals = useHoldSignals();
  const latest = signals.at(-1)?.at ?? 0;
  return (
    <div
      aria-hidden="true"
      data-reader-hold-log=""
      className="pointer-events-none fixed top-[max(env(safe-area-inset-top),8px)] right-2 z-50 w-44 rounded-lg bg-foreground/80 px-2 py-1.5 font-mono text-[10px] leading-[14px] text-background"
    >
      {signals
        .slice(-12)
        .reverse()
        .map((signal, index) => (
          <div key={`${signal.at}-${index}`} className="truncate">
            {String(signal.at - latest).padStart(6, " ")} {signal.name}
            {signal.detail ? ` · ${signal.detail}` : ""}
          </div>
        ))}
    </div>
  );
}
