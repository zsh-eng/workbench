import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Maximize } from "lucide-react";
import { useId } from "react";
import {
  enterReadingFullscreen,
  readingFullscreenSupported,
  setReadingFullscreenPreference,
  useFullscreenCanEnter,
  useReadingFullscreenPreference,
} from "./reading-fullscreen";

/**
 * The quiet way back: a header button that shows only while Reader could
 * hide the system bars and has not, such as after the back gesture left full
 * screen on purpose.
 */
export function FullscreenButton({ className }: { className: string }) {
  if (!useFullscreenCanEnter()) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={enterReadingFullscreen}
      aria-label="Enter full screen"
      title="Full screen"
      className={className}
    >
      <Maximize className="size-4" />
    </Button>
  );
}

/**
 * Appearance → Layout row: Full screen while reading, where Reader can hide
 * the system bars (an installed app on Android). Hidden elsewhere.
 */
export function FullscreenRow() {
  const on = useReadingFullscreenPreference();
  const id = useId();
  if (!readingFullscreenSupported()) return null;
  return (
    <div className="flex items-center justify-between gap-4">
      <label
        htmlFor={id}
        className="cursor-pointer text-sm font-medium text-foreground"
      >
        Full screen while reading
      </label>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={setReadingFullscreenPreference}
      />
    </div>
  );
}
