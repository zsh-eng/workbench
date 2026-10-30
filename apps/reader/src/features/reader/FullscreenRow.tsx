import { Switch } from "@/components/ui/switch";
import { useId } from "react";
import {
  readingFullscreenSupported,
  setReadingFullscreenPreference,
  useReadingFullscreenPreference,
} from "./reading-fullscreen";

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
