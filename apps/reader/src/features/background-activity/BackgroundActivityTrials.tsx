import { Switch } from "@/components/ui/switch";
import {
  calmUpdates,
  useDebugSwitch,
  type DebugSwitch,
} from "@/lib/debug-switch";

const TRIALS: {
  id: string;
  title: string;
  description: string;
  switch: DebugSwitch;
}[] = [
  {
    id: "calm-updates",
    title: "Calm updates",
    description:
      "A new version waits instead of reloading the page. The Library shows Restart to update, and it switches when you come back after two minutes away, never on a book.",
    switch: calmUpdates,
  },
];

function TrialRow({ trial }: { trial: (typeof TRIALS)[number] }) {
  const checked = useDebugSwitch(trial.switch);
  return (
    <li className="flex items-center gap-4 px-4 py-3.5">
      <span className="min-w-0 flex-1">
        <label
          htmlFor={trial.id}
          className="block text-sm font-medium text-foreground"
        >
          {trial.title}
        </label>
        <span
          id={`${trial.id}-description`}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {trial.description}
        </span>
      </span>
      <Switch
        id={trial.id}
        aria-describedby={`${trial.id}-description`}
        checked={checked}
        onCheckedChange={trial.switch.set}
      />
    </li>
  );
}

/** Background activity trials, off until you turn them on here. */
export function BackgroundActivityTrials() {
  return (
    <section className="mb-8">
      <h2 className="mb-2 ml-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Try on this device
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {TRIALS.map((trial) => (
          <TrialRow key={trial.id} trial={trial} />
        ))}
      </ul>
    </section>
  );
}
